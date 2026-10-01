"use strict";

const crypto = require("crypto");
const Identity = require("./product-identity");
const Inventory = require("./canonical-inventory-import");
const {matchesProductQuery} = require("./published-price-service");

const SOURCE = "Wolt EDEKA Berlin", MERCHANT = "EDEKA", DAY_MS = 86400000;
const VENUE = Object.freeze({nativeVenueId:"67ebb70ed3581534a525c522",slug:"edeka-hilbrecht",nativeMarketId:"800401",name:"EDEKA Hilbrecht",postalCode:"10969",city:"Berlin",country:"DE"});
const TABLE = "wolt_retailer_published_prices";
const text = (value,max=200) => typeof value === "string" ? value.trim().slice(0,max) : "";
function fail(code) { const error = new Error(code); error.code = code; return error; }
function clock(options={}) { const value=options.now===undefined?Date.now():new Date(options.now).getTime(); if(!Number.isFinite(value))throw fail("invalid-time"); return value; }
function timestamp(value) { if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return null; const time=Date.parse(value); return Number.isFinite(time)&&new Date(time).toISOString().slice(0,19)===value.slice(0,19)?time:null; }
function nativeUrl(value,response=false) {
 try {
  const url=new URL(value); if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash)return null;
  if(!response)return !url.search&&url.hostname==="wolt.com"&&/^\/de\/deu\/berlin\/venue\/edeka-hilbrecht\/?$/.test(url.pathname)?url.href:null;
  if([...url.searchParams].some(([key,value])=>key!=="page_token"||!value||value.length>4000)||url.searchParams.getAll("page_token").length>1)return null;
  return url.hostname==="consumer-api.wolt.com"&&/^\/consumer-api\/consumer-assortment\/v1\/venues\/slug\/edeka-hilbrecht\/assortment(?:\/categories\/slug\/[a-z0-9-]+)?$/.test(url.pathname)?url.href:null;
 } catch { return null; }
}
function validateOffer(raw={},options={}) {
 const now=clock(options),reasons=[];
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return{ok:false,reasons:["offer-required"]};
 const sourceId=text(raw.sourceId,80),merchant=text(raw.merchant,80),nativeVenueId=text(raw.nativeVenueId,80),retailerSku=text(raw.retailerSku,80),name=text(raw.name),brand=text(raw.brand,120)||null,description=text(raw.description,2000)||null,pack=text(raw.pack,80);
 if(sourceId!==SOURCE||merchant!==MERCHANT)reasons.push("retailer-source-not-approved");
 if(nativeVenueId!==VENUE.nativeVenueId)reasons.push("native-venue-not-approved");
 if(!/^[a-f0-9]{24}$/.test(retailerSku))reasons.push("native-article-id-required");
 if(!name)reasons.push("product-name-required");
 const gtin=raw.gtin==null||raw.gtin===""?null:String(raw.gtin).trim();
 if(gtin!==null&&(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)||!Identity.gtinValid(gtin)))reasons.push("invalid-native-gtin");
 const parsed=Inventory.productPack({quantity:pack}).parsed;
 if(!parsed||/(?:\bca\.?\s|circa|approx|ungefähr|~|€|\/\s*(?:kg|g|l|ml)\b)/i.test(pack)||raw.variableWeight===true)reasons.push("known-pack-required");
 else if(raw.packAmount!=null||raw.packUnit!=null||raw.packCount!=null) {
  const amount=Number(raw.packAmount),count=Number(raw.packCount??1),unit=text(raw.packUnit,20),supplied=Identity.base(amount*count,unit);
  if(typeof raw.packAmount==="boolean"||typeof raw.packCount==="boolean"||!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(count)||count<1||count!==parsed.count||supplied.unit!==parsed.total.unit||Math.abs(supplied.amount-parsed.total.amount)/Math.max(parsed.total.amount,1)>.001)reasons.push("pack-metadata-conflict");
 }
 const price=typeof raw.price==="number"?raw.price:NaN;
 if(!Number.isFinite(price)||price<=0)reasons.push("positive-finite-price-required");
 const deposit=raw.deposit==null?null:raw.deposit;
 if(deposit!==null&&(typeof deposit!=="number"||!Number.isFinite(deposit)||deposit<0))reasons.push("invalid-deposit");
 const displayedPrice=raw.displayedPrice??raw.nativePriceEUR;
 if(typeof displayedPrice!=="number"||!Number.isFinite(displayedPrice)||displayedPrice<=0)reasons.push("native-displayed-price-required");
 const cents=value=>Number.isFinite(value)&&Math.abs(value*100-Math.round(value*100))<.000001?Math.round(value*100):null;
 const depositIncludedInDisplayedPrice=deposit!==null;
 if(cents(price)===null||cents(displayedPrice)===null||deposit!==null&&cents(deposit)===null||cents(displayedPrice)!==cents(price)+(deposit===null?0:cents(deposit)))reasons.push("native-price-deposit-conflict");
 if(raw.displayedPrice!=null&&raw.nativePriceEUR!=null&&raw.displayedPrice!==raw.nativePriceEUR||raw.nativePriceIncludesDeposit!=null&&raw.nativePriceIncludesDeposit!==true||raw.depositIncludedInDisplayedPrice!=null&&raw.depositIncludedInDisplayedPrice!==depositIncludedInDisplayedPrice||raw.payablePackPrice!=null&&(deposit===null||raw.payablePackPrice!==displayedPrice))reasons.push("native-price-deposit-conflict");
 const depositLabel=text(raw.depositLabel,120)||null;
 const originalPrice=raw.originalPrice==null?null:raw.originalPrice;
 if(originalPrice!==null&&(typeof originalPrice!=="number"||!Number.isFinite(originalPrice)||originalPrice<=0))reasons.push("invalid-original-price");
 const promotion=originalPrice!==null&&originalPrice>price;
 const priceType=raw.priceType??"unknown",promotionStatus=raw.promotionStatus??"unknown";
 if(!["unknown","promotion"].includes(priceType)||priceType==="promotion"&&!promotion)reasons.push("unattested-price-type");
 if(!["unknown","promotion"].includes(promotionStatus)||promotionStatus==="promotion"&&!promotion)reasons.push("unattested-promotion-status");
 if(raw.currency!=="EUR")reasons.push("currency-outside-EUR");
 if(raw.scopeCountry!=="DE"||raw.scopeChannel!=="online")reasons.push("online-DE-scope-required");
 if(raw.storeId!=null||raw.store_id!=null||raw.canonicalProductId!=null||raw.productId!=null)reasons.push("physical-identity-scope-unsupported");
 if(raw.priceBasis!=null&&raw.priceBasis!=="pack")reasons.push("pack-price-required");
 const captured=timestamp(raw.capturedAt);if(captured===null)reasons.push("capture-time-required");else if(captured>now)reasons.push("capture-time-future");
 const sourceUrl=nativeUrl(raw.sourceUrl),sourceResponseUrl=nativeUrl(raw.sourceResponseUrl,true);
 if(!sourceUrl)reasons.push("exact-native-venue-url-required");
 if(!sourceResponseUrl)reasons.push("exact-native-response-url-required");
 const proofHash=text(raw.proofHash,128).toLowerCase(),sourceResponseHash=text(raw.sourceResponseHash??raw.proofHash,128).toLowerCase();
 if(!/^[a-f0-9]{64}$/.test(proofHash)||! /^[a-f0-9]{64}$/.test(sourceResponseHash)||proofHash!==sourceResponseHash)reasons.push("source-proof-hash-required");
 const availability=raw.availability??"unknown";if(!["available","unavailable","unknown"].includes(availability))reasons.push("invalid-availability");
 const shopRaw=raw.shop&&typeof raw.shop==="object"&&!Array.isArray(raw.shop)?raw.shop:{};
 const shop={nativeVenueId:text(shopRaw.nativeVenueId,80),slug:text(shopRaw.slug,100),name:text(shopRaw.name,160),address:text(shopRaw.address,200),postalCode:text(shopRaw.postalCode,10),city:text(shopRaw.city,80),country:text(shopRaw.country,8),nativeMarketId:text(shopRaw.nativeMarketId,80)||null};
 const normalized=value=>value.normalize("NFKC").toLowerCase().replace(/ß/g,"ss").replace(/[^a-z0-9]/g,"");
 if(shop.nativeVenueId!==nativeVenueId||shop.slug!==VENUE.slug||!normalized(shop.name).includes("edekahilbrecht")||!["ritterstr3840","ritterstrasse3840"].includes(normalized(shop.address))||shop.postalCode!==VENUE.postalCode||shop.city!==VENUE.city||shop.country!==VENUE.country||shop.nativeMarketId!==null&&shop.nativeMarketId!==VENUE.nativeMarketId)reasons.push("native-Berlin-shop-scope-required");
 if(raw.nativeMarketId!=null&&String(raw.nativeMarketId)!==VENUE.nativeMarketId)reasons.push("native-market-scope-conflict");
 if(reasons.length)return{ok:false,reasons};
 const single=Identity.base(parsed.amount,parsed.unit);
 return{ok:true,reasons:[],offer:{sourceId:SOURCE,merchant:MERCHANT,nativeVenueId,retailerSku,gtin,name,brand,description,pack,packAmount:single.amount,packUnit:single.unit,packCount:parsed.count,price,deposit,depositLabel,displayedPrice,nativePriceEUR:displayedPrice,nativePriceIncludesDeposit:true,depositIncludedInDisplayedPrice:depositIncludedInDisplayedPrice?true:null,payablePackPrice:deposit!==null?displayedPrice:null,originalPrice,currency:"EUR",priceType,promotionStatus,availability,capturedAt:new Date(captured).toISOString(),expiresAt:new Date(captured+DAY_MS).toISOString(),sourceUrl,sourceResponseUrl,proofHash,sourceResponseHash,shop,scopeCountry:"DE",scopeChannel:"online",state:"published",priceBasis:"pack",shippingIncluded:false,serviceFeesIncluded:false,truthEligible:false,identityStatus:gtin?"native-gtin":"native-retailer-sku"}};
}
async function ensure(pool) {
 if(!pool)throw fail("database-required");
 await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(
 source_id text NOT NULL CHECK(source_id='Wolt EDEKA Berlin'),merchant text NOT NULL CHECK(merchant='EDEKA'),native_venue_id text NOT NULL CHECK(native_venue_id='67ebb70ed3581534a525c522'),retailer_sku text NOT NULL CHECK(retailer_sku~'^[a-f0-9]{24}$'),gtin text,name text NOT NULL,brand text,description text,pack text NOT NULL,
 pack_amount numeric NOT NULL CHECK(pack_amount>0 AND pack_amount NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),pack_unit text NOT NULL CHECK(pack_unit IN ('g','ml','piece')),pack_count int NOT NULL CHECK(pack_count>0),
 price numeric NOT NULL CHECK(price>0 AND price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),deposit numeric CHECK(deposit>=0 AND deposit NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),deposit_label text,displayed_price numeric NOT NULL CHECK(displayed_price>0 AND displayed_price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),original_price numeric CHECK(original_price>0 AND original_price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),currency text NOT NULL CHECK(currency='EUR'),
 price_type text NOT NULL CHECK(price_type IN ('unknown','promotion')),promotion_status text NOT NULL CHECK(promotion_status IN ('unknown','promotion')),availability text NOT NULL CHECK(availability IN ('available','unavailable','unknown')),
 captured_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,source_url text NOT NULL,source_response_url text NOT NULL,proof_hash text NOT NULL,source_response_hash text NOT NULL,shop jsonb NOT NULL,
 scope_country text NOT NULL CHECK(scope_country='DE'),scope_channel text NOT NULL CHECK(scope_channel='online'),offer_hash text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_id,native_venue_id,retailer_sku),CHECK(displayed_price=price+COALESCE(deposit,0)),CHECK(expires_at=captured_at+interval '24 hours'));
 CREATE INDEX IF NOT EXISTS wolt_retailer_published_gtin_idx ON ${TABLE}(gtin,captured_at DESC);
 CREATE INDEX IF NOT EXISTS wolt_retailer_published_capture_idx ON ${TABLE}(native_venue_id,captured_at DESC);`);
}
const columns=["source_id","merchant","native_venue_id","retailer_sku","gtin","name","brand","description","pack","pack_amount","pack_unit","pack_count","price","deposit","deposit_label","displayed_price","original_price","currency","price_type","promotion_status","availability","captured_at","expires_at","source_url","source_response_url","proof_hash","source_response_hash","shop","scope_country","scope_channel","offer_hash"];
function row(offer) {
 const result={source_id:offer.sourceId,merchant:offer.merchant,native_venue_id:offer.nativeVenueId,retailer_sku:offer.retailerSku,gtin:offer.gtin,name:offer.name,brand:offer.brand,description:offer.description,pack:offer.pack,pack_amount:offer.packAmount,pack_unit:offer.packUnit,pack_count:offer.packCount,price:offer.price,deposit:offer.deposit,deposit_label:offer.depositLabel,displayed_price:offer.displayedPrice,original_price:offer.originalPrice,currency:offer.currency,price_type:offer.priceType,promotion_status:offer.promotionStatus,availability:offer.availability,captured_at:offer.capturedAt,expires_at:offer.expiresAt,source_url:offer.sourceUrl,source_response_url:offer.sourceResponseUrl,proof_hash:offer.proofHash,source_response_hash:offer.sourceResponseHash,shop:offer.shop,scope_country:offer.scopeCountry,scope_channel:offer.scopeChannel};
 result.offer_hash=crypto.createHash("sha256").update(JSON.stringify(result)).digest("hex");return result;
}
const TYPES="source_id text,merchant text,native_venue_id text,retailer_sku text,gtin text,name text,brand text,description text,pack text,pack_amount numeric,pack_unit text,pack_count int,price numeric,deposit numeric,deposit_label text,displayed_price numeric,original_price numeric,currency text,price_type text,promotion_status text,availability text,captured_at timestamptz,expires_at timestamptz,source_url text,source_response_url text,proof_hash text,source_response_hash text,shop jsonb,scope_country text,scope_channel text,offer_hash text";
const key = offer => [offer.source_id,offer.native_venue_id,offer.retailer_sku].join("|");
async function persist(pool,inputs=[],options={}) {
 if(!pool)throw fail("database-required");if(!Array.isArray(inputs)||inputs.length>50000)throw fail("invalid-published-offers");
 const now=clock(options),groups=new Map(),reasons={};let rejected=0,duplicates=0;
 function reject(reason,count=1){rejected+=count;reasons[reason]=(reasons[reason]||0)+count;}
 for(const raw of inputs) {
  const checked=validateOffer(raw,{now});if(!checked.ok){rejected++;for(const reason of checked.reasons)reasons[reason]=(reasons[reason]||0)+1;continue;}
  const candidate=row(checked.offer),id=key(candidate);if(!groups.has(id))groups.set(id,new Map());else duplicates++;const captures=groups.get(id),existing=captures.get(candidate.captured_at);
  if(existing){existing.count++;if(existing.row.offer_hash!==candidate.offer_hash)existing.conflict=true;}else captures.set(candidate.captured_at,{row:candidate,count:1,conflict:false});
 }
 let accepted=[];
 for(const captures of groups.values()) {
  const clean=[];for(const capture of captures.values()){if(capture.conflict)reject("same-capture-conflict",capture.count);else clean.push(capture.row);}
  clean.sort((a,b)=>b.captured_at.localeCompare(a.captured_at));if(clean.length)accepted.push(clean[0]);
 }
 await ensure(pool);let upserted=0,acceptedCount=0;
 const updated=columns.filter(column=>!["source_id","native_venue_id","retailer_sku"].includes(column)).map(column=>column+"=EXCLUDED."+column).join(",");
 for(let offset=0;offset<accepted.length;offset+=500) {
  let rows=accepted.slice(offset,offset+500);
  const existing=await pool.query(`SELECT p.source_id,p.native_venue_id,p.retailer_sku,p.captured_at,p.offer_hash FROM ${TABLE} p JOIN jsonb_to_recordset($1::jsonb) AS x(source_id text,native_venue_id text,retailer_sku text) ON p.source_id=x.source_id AND p.native_venue_id=x.native_venue_id AND p.retailer_sku=x.retailer_sku`,[JSON.stringify(rows.map(r=>({source_id:r.source_id,native_venue_id:r.native_venue_id,retailer_sku:r.retailer_sku})))]);
  const stored=new Map(existing.rows.map(r=>[key(r),r]));
  rows=rows.filter(candidate=>{const previous=stored.get(key(candidate));if(previous&&new Date(previous.captured_at).toISOString()===candidate.captured_at&&previous.offer_hash!==candidate.offer_hash){reject("same-capture-conflict");return false;}return true;});
  acceptedCount+=rows.length;if(!rows.length)continue;
  const saved=await pool.query(`INSERT INTO ${TABLE}(${columns.join(",")}) SELECT ${columns.join(",")} FROM jsonb_to_recordset($1::jsonb) AS x(${TYPES}) WHERE true ON CONFLICT(source_id,native_venue_id,retailer_sku) DO UPDATE SET ${updated},updated_at=now() WHERE EXCLUDED.captured_at>${TABLE}.captured_at`,[JSON.stringify(rows)]);upserted+=saved.rowCount;
 }
 return{received:inputs.length,accepted:acceptedCount,rejected,duplicates,upserted,unchanged:acceptedCount-upserted,reasons,scopeCountry:"DE",scopeChannel:"online",truthEligible:false};
}
const FIELDS=`source_id AS "sourceId",merchant,native_venue_id AS "nativeVenueId",retailer_sku AS "retailerSku",gtin,name,brand,description,pack,pack_amount::float AS "packAmount",pack_unit AS "packUnit",pack_count AS "packCount",price::float,deposit::float,deposit_label AS "depositLabel",displayed_price::float AS "displayedPrice",original_price::float AS "originalPrice",currency,price_type AS "priceType",promotion_status AS "promotionStatus",availability,captured_at AS "capturedAt",expires_at AS "expiresAt",source_url AS "sourceUrl",source_response_url AS "sourceResponseUrl",proof_hash AS "proofHash",source_response_hash AS "sourceResponseHash",shop,scope_country AS "scopeCountry",scope_channel AS "scopeChannel"`;
function querySpec(options={}) {
 const now=clock(options),params=[new Date(now).toISOString()],where=["source_id='Wolt EDEKA Berlin'","scope_country='DE'","scope_channel='online'","captured_at<=$1::timestamptz","captured_at>=$1::timestamptz-interval '24 hours'","expires_at>$1::timestamptz"],param=value=>{params.push(value);return"$"+params.length;};
 if(options.merchant!=null){const merchant=text(options.merchant,80);if(!merchant)throw fail("invalid-merchant");where.push("lower(merchant)=lower("+param(merchant)+")");}
 if(options.nativeVenueId!=null){const venue=text(options.nativeVenueId,80);if(!/^[a-f0-9]{24}$/.test(venue))throw fail("invalid-native-venue-id");where.push("native_venue_id="+param(venue));}
 if(options.gtin!=null){const gtin=String(options.gtin).trim();if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)||!Identity.gtinValid(gtin))throw fail("invalid-gtin");where.push("gtin="+param(gtin));}
 if(options.search!=null){const search=text(options.search);if(search){const p=param("%"+search.replace(/[\\%_]/g,"\\$&")+"%");where.push("(name ILIKE "+p+" ESCAPE '\\' OR brand ILIKE "+p+" ESCAPE '\\')");}}
 if(options.today!=null){const today=String(options.today);if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Number.isFinite(Date.parse(today))||new Date(today).toISOString().slice(0,10)!==today)throw fail("invalid-date");where.push("(captured_at AT TIME ZONE 'Europe/Berlin')::date<="+param(today)+"::date");}
 const requested=Number(options.limit??50),limit=Number.isFinite(requested)?Math.max(1,Math.min(200,Math.floor(requested))):50;
 return{sql:"SELECT "+FIELDS+" FROM "+TABLE+" WHERE "+where.join(" AND ")+" ORDER BY captured_at DESC,native_venue_id,retailer_sku LIMIT "+param(limit),params};
}
function published(record) { return{...record,capturedAt:new Date(record.capturedAt).toISOString(),expiresAt:new Date(record.expiresAt).toISOString(),nativePriceEUR:record.displayedPrice,nativePriceIncludesDeposit:true,depositIncludedInDisplayedPrice:record.deposit!==null?true:null,payablePackPrice:record.deposit!==null?record.displayedPrice:null,state:"published",current:true,priceBasis:"pack",shippingIncluded:false,serviceFeesIncluded:false,truthEligible:false,identityStatus:record.gtin?"native-gtin":"native-retailer-sku"}; }
async function search(pool,options={}) { if(!pool)throw fail("database-required");const query=querySpec(options);await ensure(pool);const result=await pool.query(query.sql,query.params);return{items:result.rows.map(published),scopeCountry:"DE",scopeChannel:"online",maxAgeHours:24,truthEligible:false}; }
async function status(pool,options={}) {
 if(!pool)throw fail("database-required");const now=new Date(clock(options)).toISOString();await ensure(pool);
 const fresh="captured_at<=$1::timestamptz AND captured_at>=$1::timestamptz-interval '24 hours' AND expires_at>$1::timestamptz";
 const result=await pool.query(`SELECT count(*)::int AS "storedPrices",count(*) FILTER(WHERE ${fresh})::int AS "currentPrices",count(DISTINCT gtin) FILTER(WHERE ${fresh})::int AS "productsWithCurrentPublishedPrices",count(DISTINCT native_venue_id) FILTER(WHERE ${fresh})::int AS "marketsWithCurrentPublishedPrices",count(*) FILTER(WHERE ${fresh} AND availability='available')::int AS "availableCurrentPrices",MAX(captured_at) AS "lastCapturedAt" FROM ${TABLE} WHERE source_id=$2 AND scope_country='DE' AND scope_channel='online'`,[now,SOURCE]);
 const markets=await pool.query(`SELECT merchant,source_id AS "sourceId",native_venue_id AS "nativeVenueId",(array_agg(shop ORDER BY captured_at DESC,retailer_sku))[1] AS shop,count(*)::int AS "storedPrices",count(*) FILTER(WHERE ${fresh})::int AS "currentPrices",count(DISTINCT gtin) FILTER(WHERE ${fresh})::int AS "productsWithCurrentPublishedPrices",MAX(captured_at) AS "lastCapturedAt" FROM ${TABLE} WHERE source_id=$2 AND scope_country='DE' AND scope_channel='online' GROUP BY merchant,source_id,native_venue_id ORDER BY native_venue_id`,[now,SOURCE]);
 return{ok:true,...result.rows[0],markets:markets.rows,scopeCountry:"DE",scopeChannel:"online",maxAgeHours:24,state:"published",truthEligible:false,shippingIncluded:false,serviceFeesIncluded:false,independentOfUserReceipts:true,note:"Veröffentlichte Berliner Wolt-Marktpreise; Lieferkanal und Filialpreise werden getrennt ausgewiesen. Unbelegte Normalpreis-/Aktionszuordnung bleibt unbekannt."};
}
module.exports={SOURCE,MERCHANT,DAY_MS,VENUE,ensure,validateOffer,persist,querySpec,search,status,matchesProductQuery};
