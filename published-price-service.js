"use strict";
const Identity=require("./product-identity"),Inventory=require("./canonical-inventory-import");
const DAY_MS=86400000,SOURCE="dm online",MERCHANT="dm";
function fail(code){const error=new Error(code);error.code=code;return error}
function clock(options={}){const value=options.now===undefined?Date.now():new Date(options.now).getTime();if(!Number.isFinite(value))throw fail("invalid-time");return value}
const text=(value,max=200)=>typeof value==="string"?value.trim().slice(0,max):"";
function timestamp(value){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return null;const time=Date.parse(value);return Number.isFinite(time)&&new Date(time).toISOString().slice(0,19)===value.slice(0,19)?time:null}
function sourceUrl(value,sku,gtin){try{const url=new URL(value);if(url.protocol!=="https:"||!["www.dm.de","dm.de"].includes(url.hostname)||url.username||url.password||url.port)return null;const exactSku=new RegExp("^/p/d/"+sku+"/[^/]+/?$").test(url.pathname),exactGtin=url.pathname.endsWith("-p"+gtin+".html");return exactSku||exactGtin?url.href:null}catch{return null}}
function validateOffer(raw={},options={}){
 const now=clock(options),reasons=[];if(!raw||typeof raw!=="object"||Array.isArray(raw))return{ok:false,reasons:["offer-required"]};
 const merchant=text(raw.merchant,80).toLowerCase(),sourceId=text(raw.sourceId,80),retailerSku=String(raw.retailerSku??"").trim(),gtin=String(raw.gtin??"").trim(),name=text(raw.name),brand=text(raw.brand,120)||null,pack=text(raw.pack,80);
 if(merchant!==MERCHANT||sourceId!==SOURCE)reasons.push("retailer-source-not-approved");if(!/^[1-9]\d{0,11}$/.test(retailerSku))reasons.push("retailer-sku-required");
 if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)||!Identity.gtinValid(gtin))reasons.push("valid-gtin-required");if(!name)reasons.push("product-name-required");
 const parsed=Inventory.productPack({quantity:pack}).parsed;
 if(!parsed)reasons.push("known-pack-required");
 else if(raw.packAmount!=null||raw.packUnit!=null||raw.packCount!=null){
  const amount=Number(raw.packAmount),count=Number(raw.packCount??1),unit=text(raw.packUnit,20);
  const supplied=Identity.base(amount*count,unit),actual=parsed.total;
  if(typeof raw.packAmount==="boolean"||typeof raw.packCount==="boolean"||!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(count)||count<1||supplied.unit!==actual.unit||Math.abs(supplied.amount-actual.amount)/Math.max(actual.amount,1)>.001)reasons.push("pack-metadata-conflict");
 }
 const price=!["number","string"].includes(typeof raw.price)||raw.price===""?NaN:Number(raw.price);if(!Number.isFinite(price)||price<=0)reasons.push("positive-finite-price-required");if(raw.currency!=="EUR")reasons.push("currency-outside-EUR");
 if(raw.scopeCountry!=="DE"||raw.scopeChannel!=="online")reasons.push("online-DE-scope-required");if(raw.storeId!=null||raw.store_id!=null)reasons.push("physical-store-scope-unsupported");
 const captured=timestamp(raw.capturedAt);if(captured===null)reasons.push("capture-time-required");else if(captured>now)reasons.push("capture-time-future");
 const url=sourceUrl(raw.sourceUrl,retailerSku,gtin);if(!url)reasons.push("exact-first-party-source-url-required");
 const proofHash=text(raw.proofHash,128).toLowerCase();if(!/^[a-f0-9]{64}$/.test(proofHash))reasons.push("source-proof-hash-required");
 const availability=raw.availability??"unknown";if(!["available","unavailable","unknown"].includes(availability))reasons.push("invalid-availability");
 if(reasons.length)return{ok:false,reasons};
 const single=Identity.base(parsed.amount,parsed.unit);
 return{ok:true,reasons:[],offer:{merchant,sourceId,retailerSku,gtin,name,brand,pack,packAmount:single.amount,packUnit:single.unit,packCount:parsed.count,price,currency:"EUR",capturedAt:new Date(captured).toISOString(),expiresAt:new Date(captured+DAY_MS).toISOString(),sourceUrl:url,proofHash,scopeCountry:"DE",scopeChannel:"online",availability,state:"published",priceBasis:"pack",shippingIncluded:false}};
}
async function ensure(pool){
 if(!pool)throw fail("database-required");
 await pool.query(`CREATE TABLE IF NOT EXISTS retailer_published_prices(
 merchant text NOT NULL,source_id text NOT NULL,retailer_sku text NOT NULL,gtin text NOT NULL,name text NOT NULL,brand text,pack text NOT NULL,
 pack_amount numeric NOT NULL CHECK(pack_amount>0 AND pack_amount NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),pack_unit text NOT NULL CHECK(pack_unit IN ('g','ml','piece')),pack_count int NOT NULL CHECK(pack_count>0),
 price numeric NOT NULL CHECK(price>0 AND price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),currency text NOT NULL CHECK(currency='EUR'),captured_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 source_url text NOT NULL,proof_hash text NOT NULL,scope_country text NOT NULL CHECK(scope_country='DE'),scope_channel text NOT NULL CHECK(scope_channel='online'),availability text NOT NULL CHECK(availability IN ('available','unavailable','unknown')),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(merchant,retailer_sku,scope_country,scope_channel));
 CREATE INDEX IF NOT EXISTS retailer_published_gtin_idx ON retailer_published_prices(gtin,captured_at DESC);
 CREATE INDEX IF NOT EXISTS retailer_published_capture_idx ON retailer_published_prices(merchant,captured_at DESC);`);
}
const columns=["merchant","source_id","retailer_sku","gtin","name","brand","pack","pack_amount","pack_unit","pack_count","price","currency","captured_at","expires_at","source_url","proof_hash","scope_country","scope_channel","availability"];
const row=offer=>({merchant:offer.merchant,source_id:offer.sourceId,retailer_sku:offer.retailerSku,gtin:offer.gtin,name:offer.name,brand:offer.brand,pack:offer.pack,pack_amount:offer.packAmount,pack_unit:offer.packUnit,pack_count:offer.packCount,price:offer.price,currency:offer.currency,captured_at:offer.capturedAt,expires_at:offer.expiresAt,source_url:offer.sourceUrl,proof_hash:offer.proofHash,scope_country:offer.scopeCountry,scope_channel:offer.scopeChannel,availability:offer.availability});
const TYPES="merchant text,source_id text,retailer_sku text,gtin text,name text,brand text,pack text,pack_amount numeric,pack_unit text,pack_count int,price numeric,currency text,captured_at timestamptz,expires_at timestamptz,source_url text,proof_hash text,scope_country text,scope_channel text,availability text";
async function persist(pool,validatedOffers=[],options={}){
 if(!pool)throw fail("database-required");if(!Array.isArray(validatedOffers)||validatedOffers.length>10000)throw fail("invalid-published-offers");
 const now=clock(options),offers=new Map(),reasons={};let rejected=0,duplicates=0;
 for(const raw of validatedOffers){const checked=validateOffer(raw,{now});if(!checked.ok){rejected++;for(const reason of checked.reasons)reasons[reason]=(reasons[reason]||0)+1;continue}const current=offers.get(checked.offer.retailerSku);if(current){duplicates++;if(current.capturedAt>=checked.offer.capturedAt)continue}offers.set(checked.offer.retailerSku,checked.offer)}
 await ensure(pool);let upserted=0;const accepted=[...offers.values()];
 for(let offset=0;offset<accepted.length;offset+=500){const rows=accepted.slice(offset,offset+500).map(row),updated=columns.filter(column=>!["merchant","retailer_sku","scope_country","scope_channel"].includes(column)).map(column=>column+"=EXCLUDED."+column).join(",");
  const saved=await pool.query(`INSERT INTO retailer_published_prices(${columns.join(",")}) SELECT ${columns.join(",")} FROM jsonb_to_recordset($1::jsonb) AS x(${TYPES}) WHERE true ON CONFLICT(merchant,retailer_sku,scope_country,scope_channel) DO UPDATE SET ${updated},updated_at=now() WHERE EXCLUDED.captured_at>retailer_published_prices.captured_at`,[JSON.stringify(rows)]);upserted+=saved.rowCount;
 }
 return{received:validatedOffers.length,accepted:accepted.length,rejected,duplicates,upserted,unchanged:accepted.length-upserted,reasons,scopeCountry:"DE",scopeChannel:"online"};
}
const FIELDS=`merchant,source_id AS "sourceId",retailer_sku AS "retailerSku",gtin,name,brand,pack,pack_amount::float AS "packAmount",pack_unit AS "packUnit",pack_count AS "packCount",price::float,currency,captured_at AS "capturedAt",expires_at AS "expiresAt",source_url AS "sourceUrl",proof_hash AS "proofHash",scope_country AS "scopeCountry",scope_channel AS "scopeChannel",availability`;
function querySpec(options={}){
 const now=clock(options),params=[new Date(now).toISOString()],where=["scope_country='DE'","scope_channel='online'","captured_at<=$1::timestamptz","captured_at>=$1::timestamptz-interval '24 hours'","expires_at>$1::timestamptz"],param=value=>{params.push(value);return"$"+params.length};
 if(options.merchant!=null){const merchant=text(options.merchant,80).toLowerCase();if(!merchant)throw fail("invalid-merchant");where.push("merchant="+param(merchant))}
 if(options.gtin!=null){const gtin=String(options.gtin).trim();if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)||!Identity.gtinValid(gtin))throw fail("invalid-gtin");where.push("gtin="+param(gtin))}
 if(options.search!=null){const search=text(options.search);if(search){const pattern="%"+search.replace(/[\\%_]/g,"\\$&")+"%",p=param(pattern);where.push("(name ILIKE "+p+" ESCAPE '\\' OR brand ILIKE "+p+" ESCAPE '\\')")}}
 if(options.today!=null){const today=String(options.today);if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Number.isFinite(Date.parse(today))||new Date(today).toISOString().slice(0,10)!==today)throw fail("invalid-date");where.push("(captured_at AT TIME ZONE 'Europe/Berlin')::date<="+param(today)+"::date")}
 const requested=Number(options.limit??50),limit=Number.isFinite(requested)?Math.max(1,Math.min(200,Math.floor(requested))):50;
 return{sql:"SELECT "+FIELDS+" FROM retailer_published_prices WHERE "+where.join(" AND ")+" ORDER BY captured_at DESC,merchant,retailer_sku LIMIT "+param(limit),params};
}
function published(row){return{...row,capturedAt:new Date(row.capturedAt).toISOString(),expiresAt:new Date(row.expiresAt).toISOString(),state:"published",current:true,priceBasis:"pack",shippingIncluded:false}}
function matchesProductQuery(offer,query={}){
 if(!offer||!query.gtin||String(offer.gtin)!==String(query.gtin).trim())return false;
 if(query.brand){const normalize=value=>String(value||"").normalize("NFKC").toLowerCase().replace(/\s+/g,"").trim();if(normalize(offer.brand)!==normalize(query.brand))return false;}
 if(query.pack){const expected=Inventory.productPack({quantity:query.pack}).parsed,actual=Inventory.productPack({quantity:offer.pack}).parsed;if(!expected||!actual||expected.count!==actual.count||expected.total.unit!==actual.total.unit||Math.abs(expected.total.amount-actual.total.amount)/Math.max(expected.total.amount,1)>.001)return false;}
 return true;
}
async function search(pool,options={}){if(!pool)throw fail("database-required");const query=querySpec(options);await ensure(pool);const result=await pool.query(query.sql,query.params);return{items:result.rows.map(published),scopeCountry:"DE",scopeChannel:"online",maxAgeHours:24}}
async function status(pool,options={}){
 if(!pool)throw fail("database-required");const now=new Date(clock(options)).toISOString();await ensure(pool);
 const fresh="captured_at<=$1::timestamptz AND captured_at>=$1::timestamptz-interval '24 hours' AND expires_at>$1::timestamptz";
 const result=await pool.query(`SELECT count(*)::int AS "storedPrices",count(*) FILTER(WHERE ${fresh})::int AS "currentPrices",count(DISTINCT gtin) FILTER(WHERE ${fresh})::int AS "productsWithCurrentPublishedPrices",count(*) FILTER(WHERE ${fresh} AND availability='available')::int AS "availableCurrentPrices",MAX(captured_at) AS "lastCapturedAt" FROM retailer_published_prices WHERE scope_country='DE' AND scope_channel='online'`,[now]);
 const merchants=await pool.query(`SELECT merchant,source_id AS "sourceId",count(*)::int AS "storedPrices",count(*) FILTER(WHERE ${fresh})::int AS "currentPrices",MAX(captured_at) AS "lastCapturedAt" FROM retailer_published_prices WHERE scope_country='DE' AND scope_channel='online' GROUP BY merchant,source_id ORDER BY merchant`,[now]);
 return{ok:true,...result.rows[0],merchants:merchants.rows,scopeCountry:"DE",scopeChannel:"online",maxAgeHours:24,state:"published",note:"Veröffentlichte Onlinepreise für Deutschland mit eigener Verfügbarkeit und Abrufzeit."};
}
module.exports={SOURCE,MERCHANT,DAY_MS,ensure,validateOffer,persist,querySpec,search,status,matchesProductQuery};
