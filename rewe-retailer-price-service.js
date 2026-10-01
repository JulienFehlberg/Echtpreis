"use strict";

const crypto=require("crypto"),Identity=require("./product-identity"),Inventory=require("./canonical-inventory-import");
const {matchesProductQuery}=require("./published-price-service");
const SOURCE="REWE Berlin pickup",MERCHANT="REWE",DAY_MS=86400000,TABLE="rewe_retailer_published_prices";
const MARKET=Object.freeze({nativeMarketId:"8321066",nativeStoreId:"7ae33841-fa98-3b7e-9ee5-8132f39c189c",name:"REWE Steven Horn oHG",address:"Hallesches Ufer 40",postalCode:"10963",city:"Berlin",country:"DE",serviceType:"PICKUP"});
const text=(value,max=200)=>typeof value==="string"?value.trim().slice(0,max):"";
function fail(code){return Object.assign(new Error(code),{code});}
function clock(options={}){const time=options.now===undefined?Date.now():new Date(options.now).getTime();if(!Number.isFinite(time))throw fail("invalid-time");return time;}
function timestamp(value){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return null;const time=Date.parse(value);return Number.isFinite(time)&&new Date(time).toISOString().slice(0,19)===value.slice(0,19)?time:null;}
function nativeDeadline(value){
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const local=value.replace(/(?:Z|[+-]\d{2}:\d{2})$/,"Z"),time=Date.parse(value);
 return timestamp(local)!==null&&Number.isFinite(time)?time:null;
}
const cents=value=>typeof value==="number"&&Number.isFinite(value)&&Math.abs(value*100-Math.round(value*100))<.000001?Math.round(value*100):null;
const normalize=value=>value.normalize("NFKC").toLowerCase().replace(/ß/g,"ss").replace(/[^a-z0-9]/g,"");
function nativeUrl(value,{response=false,retailerProductId}={}){
 try{
  if(typeof value!=="string")return null;
  const url=new URL(value);if(url.protocol!=="https:"||url.hostname!=="www.rewe.de"||url.username||url.password||url.port||url.hash)return null;
  if(!response)return !url.search&&/^\/shop\/p\/[a-z0-9-]+\/[1-9]\d{0,11}\/?$/.test(url.pathname)&&url.pathname.replace(/\/$/,"").split("/").at(-1)===retailerProductId?url.href:null;
  if(url.pathname!=="/shop/api/products")return null;
  const allowed=new Set(["marketId","serviceTypes","page","objectsPerPage","categorySlug"]);
  if([...url.searchParams].some(([key])=>!allowed.has(key))||[...allowed].some(key=>url.searchParams.getAll(key).length>1))return null;
  if(url.searchParams.get("marketId")!==MARKET.nativeMarketId||url.searchParams.get("serviceTypes")!=="PICKUP"||url.searchParams.get("objectsPerPage")!=="40"||!/^[1-9]\d{0,5}$/.test(url.searchParams.get("page")||""))return null;
  if(url.searchParams.has("categorySlug")&&!/^[a-z0-9-]{1,150}$/.test(url.searchParams.get("categorySlug")))return null;
  return url.href;
 }catch{return null;}
}
function validateOffer(raw={},options={}){
 const now=clock(options),reasons=[];
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return{ok:false,reasons:["offer-required"]};
 const nativeMarketId=String(raw.nativeMarketId??""),nativeStoreId=text(raw.nativeStoreId,80),retailerSku=text(raw.retailerSku,150),retailerProductId=String(raw.retailerProductId??""),nativeArticleId=raw.nativeArticleId==null?null:String(raw.nativeArticleId),name=text(raw.name),brand=text(raw.brand,120)||null,description=text(raw.description,2000)||null,pack=text(raw.pack,80);
 if(raw.sourceId!==SOURCE||raw.merchant!==MERCHANT)reasons.push("retailer-source-not-approved");
 if(nativeMarketId!==MARKET.nativeMarketId||nativeStoreId!==MARKET.nativeStoreId)reasons.push("native-market-not-approved");
 const listing=/^([1-9]\d{0,4})-([A-Za-z0-9]{1,40})-(7ae33841-fa98-3b7e-9ee5-8132f39c189c)$/.exec(retailerSku);
 if(!listing||retailerSku!==raw.retailerSku||nativeArticleId!==null&&(!listing||nativeArticleId!==listing[2]))reasons.push("native-listing-id-required");
 if(!/^[1-9]\d{0,11}$/.test(retailerProductId))reasons.push("native-product-id-required");
 if(raw.serviceType!=null&&raw.serviceType!=="PICKUP"||raw.fulfillmentChannel!=null&&raw.fulfillmentChannel!=="pickup")reasons.push("pickup-service-required");
 if(!name)reasons.push("product-name-required");
 const gtin=raw.gtin==null||raw.gtin===""?null:String(raw.gtin).trim();
 if(gtin!==null&&(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)||!Identity.gtinValid(gtin)))reasons.push("invalid-native-gtin");
 const parsed=Inventory.productPack({quantity:pack}).parsed;
 if(!parsed||/(?:\bca\.?\s|circa|approx|ungefähr|~|€|\/\s*(?:kg|g|l|ml)\b)/i.test(pack)||raw.variableWeight===true)reasons.push("known-pack-required");
 else if(raw.packAmount!=null||raw.packUnit!=null||raw.packCount!=null){
  const amount=Number(raw.packAmount),count=Number(raw.packCount??1),supplied=Identity.base(amount*count,text(raw.packUnit,20));
  if(typeof raw.packAmount==="boolean"||typeof raw.packCount==="boolean"||!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(count)||count<1||count!==parsed.count||supplied.unit!==parsed.total.unit||Math.abs(supplied.amount-parsed.total.amount)/Math.max(parsed.total.amount,1)>.001)reasons.push("pack-metadata-conflict");
 }
 const price=raw.price,displayedPrice=raw.displayedPrice??raw.nativePriceEUR,deposit=raw.deposit==null?null:raw.deposit;
 if(typeof price!=="number"||!Number.isFinite(price)||price<=0)reasons.push("positive-finite-price-required");
 if(typeof displayedPrice!=="number"||!Number.isFinite(displayedPrice)||displayedPrice<=0)reasons.push("native-displayed-price-required");
 if(deposit!==null&&(typeof deposit!=="number"||!Number.isFinite(deposit)||deposit<0))reasons.push("invalid-deposit");
 if(cents(price)===null||cents(displayedPrice)===null||cents(price)!==cents(displayedPrice)||deposit!==null&&cents(deposit)===null)reasons.push("native-price-deposit-conflict");
 const payablePackPrice=deposit===null?null:cents(price)===null||cents(deposit)===null?null:(cents(price)+cents(deposit))/100;
 if(raw.nativePriceEUR!=null&&raw.nativePriceEUR!==displayedPrice||raw.nativePriceIncludesDeposit!=null&&raw.nativePriceIncludesDeposit!==false||raw.depositIncludedInDisplayedPrice!=null&&raw.depositIncludedInDisplayedPrice!==false||raw.payablePackPrice!=null&&(payablePackPrice===null||raw.payablePackPrice!==payablePackPrice))reasons.push("native-price-deposit-conflict");
 if(["personalizedPrice","loyaltyPrice","personalPrice"].some(key=>raw[key]!=null&&raw[key]!==false)||["requiresMembership","requiresCoupon"].some(key=>raw[key]===true)||raw.priceAudience!=null&&raw.priceAudience!=="public")reasons.push("non-public-price-unsupported");
 const originalPrice=raw.originalPrice==null?null:raw.originalPrice;
 if(originalPrice!==null&&(typeof originalPrice!=="number"||!Number.isFinite(originalPrice)||originalPrice<=0||cents(originalPrice)===null))reasons.push("invalid-original-price");
 const priceType=raw.priceType??"unknown",promotionStatus=raw.promotionStatus??"unknown",promotion=typeof originalPrice==="number"&&originalPrice>price;
 if(!["unknown","promotion"].includes(priceType)||priceType==="promotion"&&!promotion)reasons.push("unattested-price-type");
 if(!["unknown","promotion"].includes(promotionStatus)||promotionStatus==="promotion"&&!promotion)reasons.push("unattested-promotion-status");
 const availability=raw.availability??"unknown";if(!["available","unavailable","unknown"].includes(availability))reasons.push("invalid-availability");
 if(raw.currency!=="EUR")reasons.push("currency-outside-EUR");
 if(raw.scopeCountry!=="DE"||raw.scopeChannel!=="pickup")reasons.push("pickup-DE-scope-required");
 if(raw.storeId!=null||raw.store_id!=null||raw.productId!=null||raw.canonicalProductId!=null)reasons.push("physical-identity-scope-unsupported");
 if(raw.priceBasis!=null&&raw.priceBasis!=="pack")reasons.push("pack-price-required");
 const captured=timestamp(raw.capturedAt);if(captured===null)reasons.push("capture-time-required");else if(captured>now)reasons.push("capture-time-future");
 const promotionDeadline=raw.nativePromotionValidTo==null?null:nativeDeadline(raw.nativePromotionValidTo);
 if(raw.nativePromotionValidTo!=null&&promotionDeadline===null)reasons.push("invalid-native-price-validity");
 else if(promotionDeadline!==null&&(promotionDeadline<=now||captured!==null&&promotionDeadline<=captured))reasons.push("native-price-validity-expired");
 const sourceUrl=nativeUrl(raw.sourceUrl,{retailerProductId}),sourceResponseUrl=nativeUrl(raw.sourceResponseUrl,{response:true});
 if(!sourceUrl)reasons.push("exact-native-product-url-required");if(!sourceResponseUrl)reasons.push("exact-native-response-url-required");
 const proofHash=text(raw.proofHash,128).toLowerCase(),sourceResponseHash=text(raw.sourceResponseHash??raw.proofHash,128).toLowerCase();
 if(!/^[a-f0-9]{64}$/.test(proofHash)||!/^[a-f0-9]{64}$/.test(sourceResponseHash)||proofHash!==sourceResponseHash)reasons.push("source-proof-hash-required");
 const inputShop=raw.shop&&typeof raw.shop==="object"&&!Array.isArray(raw.shop)?raw.shop:{};
 const shop={nativeMarketId:String(inputShop.nativeMarketId??""),nativeStoreId:text(inputShop.nativeStoreId,80),name:text(inputShop.name,160),address:text(inputShop.address,200),postalCode:text(inputShop.postalCode,10),city:text(inputShop.city,80),country:text(inputShop.country,8),serviceType:text(inputShop.serviceType||"PICKUP",20)};
 if(shop.nativeMarketId!==MARKET.nativeMarketId||shop.nativeStoreId!==MARKET.nativeStoreId||normalize(shop.name)!==normalize(MARKET.name)||normalize(shop.address)!==normalize(MARKET.address)||shop.postalCode!==MARKET.postalCode||shop.city!==MARKET.city||shop.country!==MARKET.country||shop.serviceType!=="PICKUP")reasons.push("native-Berlin-shop-scope-required");
 if(reasons.length)return{ok:false,reasons};
 const single=Identity.base(parsed.amount,parsed.unit);
 return{ok:true,reasons:[],offer:{sourceId:SOURCE,merchant:MERCHANT,nativeMarketId,nativeStoreId,retailerSku,retailerProductId,nativeArticleId:nativeArticleId??listing[2],gtin,name,brand,description,pack,packAmount:single.amount,packUnit:single.unit,packCount:parsed.count,price,deposit,depositLabel:text(raw.depositLabel,120)||null,displayedPrice,nativePriceEUR:displayedPrice,nativePriceIncludesDeposit:false,depositIncludedInDisplayedPrice:deposit===null?null:false,payablePackPrice,originalPrice,currency:"EUR",priceType,promotionStatus,availability,capturedAt:new Date(captured).toISOString(),nativePromotionValidTo:promotionDeadline===null?null:new Date(promotionDeadline).toISOString(),expiresAt:new Date(Math.min(captured+DAY_MS,promotionDeadline??Infinity)).toISOString(),sourceUrl,sourceResponseUrl,proofHash,sourceResponseHash,shop,scopeCountry:"DE",scopeChannel:"pickup",fulfillmentChannel:"pickup",serviceType:"PICKUP",state:"published",priceBasis:"pack",shippingIncluded:false,serviceFeesIncluded:false,truthEligible:false,identityStatus:gtin?"native-gtin":"native-retailer-sku"}};
}
async function ensure(pool){
 if(!pool)throw fail("database-required");
 await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(
 source_id text NOT NULL CHECK(source_id='REWE Berlin pickup'),merchant text NOT NULL CHECK(merchant='REWE'),native_market_id text NOT NULL CHECK(native_market_id='8321066'),native_store_id text NOT NULL CHECK(native_store_id='7ae33841-fa98-3b7e-9ee5-8132f39c189c'),retailer_sku text NOT NULL CHECK(retailer_sku~'^[1-9][0-9]{0,4}-[A-Za-z0-9]{1,40}-7ae33841-fa98-3b7e-9ee5-8132f39c189c$'),retailer_product_id text NOT NULL CHECK(retailer_product_id~'^[1-9][0-9]{0,11}$'),native_article_id text NOT NULL,gtin text CHECK(gtin IS NULL OR gtin~'^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'),name text NOT NULL CHECK(length(name)>0),brand text,description text,pack text NOT NULL,
 pack_amount numeric NOT NULL CHECK(pack_amount>0 AND pack_amount NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),pack_unit text NOT NULL CHECK(pack_unit IN ('g','ml','piece')),pack_count int NOT NULL CHECK(pack_count>0),
 price numeric NOT NULL CHECK(price>0 AND price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND price*100=trunc(price*100)),deposit numeric CHECK(deposit>=0 AND deposit NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND deposit*100=trunc(deposit*100)),deposit_label text,displayed_price numeric NOT NULL CHECK(displayed_price>0 AND displayed_price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),original_price numeric CHECK(original_price>0 AND original_price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),currency text NOT NULL CHECK(currency='EUR'),
 price_type text NOT NULL CHECK(price_type IN ('unknown','promotion')),promotion_status text NOT NULL CHECK(promotion_status IN ('unknown','promotion')),availability text NOT NULL CHECK(availability IN ('available','unavailable','unknown')),
 captured_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,native_promotion_valid_to timestamptz,source_url text NOT NULL,source_response_url text NOT NULL,proof_hash text NOT NULL CHECK(proof_hash~'^[a-f0-9]{64}$'),source_response_hash text NOT NULL CHECK(source_response_hash=proof_hash),shop jsonb NOT NULL,
 scope_country text NOT NULL CHECK(scope_country='DE'),scope_channel text NOT NULL CHECK(scope_channel='pickup'),offer_hash text NOT NULL CHECK(offer_hash~'^[a-f0-9]{64}$'),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_id,native_market_id,retailer_sku),CHECK(displayed_price=price),CHECK(native_article_id=split_part(retailer_sku,'-',2)),CHECK(price_type<>'promotion' OR (original_price IS NOT NULL AND original_price>price)),CHECK(promotion_status<>'promotion' OR (original_price IS NOT NULL AND original_price>price)),CHECK(shop @> '{"nativeMarketId":"8321066","nativeStoreId":"7ae33841-fa98-3b7e-9ee5-8132f39c189c","postalCode":"10963","city":"Berlin","country":"DE","serviceType":"PICKUP"}'::jsonb),CONSTRAINT rewe_retailer_published_expiry_scope CHECK(expires_at>captured_at AND expires_at<=captured_at+interval '24 hours' AND (native_promotion_valid_to IS NULL OR expires_at<=native_promotion_valid_to)));
 ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS native_promotion_valid_to timestamptz;
 DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='${TABLE}'::regclass AND conname='rewe_retailer_published_expiry_scope') THEN
   IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='${TABLE}'::regclass AND conname='rewe_retailer_published_prices_check1' AND pg_get_constraintdef(oid) LIKE '%expires_at%' AND pg_get_constraintdef(oid) LIKE '%captured_at%') THEN
    ALTER TABLE ${TABLE} DROP CONSTRAINT rewe_retailer_published_prices_check1;
   END IF;
   ALTER TABLE ${TABLE} ADD CONSTRAINT rewe_retailer_published_expiry_scope CHECK(expires_at>captured_at AND expires_at<=captured_at+interval '24 hours' AND (native_promotion_valid_to IS NULL OR expires_at<=native_promotion_valid_to));
  END IF;
 END $$;
 CREATE INDEX IF NOT EXISTS rewe_retailer_published_gtin_idx ON ${TABLE}(gtin,captured_at DESC);
 CREATE INDEX IF NOT EXISTS rewe_retailer_published_capture_idx ON ${TABLE}(native_market_id,captured_at DESC);`);
}
const columns=["source_id","merchant","native_market_id","native_store_id","retailer_sku","retailer_product_id","native_article_id","gtin","name","brand","description","pack","pack_amount","pack_unit","pack_count","price","deposit","deposit_label","displayed_price","original_price","currency","price_type","promotion_status","availability","captured_at","expires_at","native_promotion_valid_to","source_url","source_response_url","proof_hash","source_response_hash","shop","scope_country","scope_channel","offer_hash"];
function row(offer){
 const result={source_id:offer.sourceId,merchant:offer.merchant,native_market_id:offer.nativeMarketId,native_store_id:offer.nativeStoreId,retailer_sku:offer.retailerSku,retailer_product_id:offer.retailerProductId,native_article_id:offer.nativeArticleId,gtin:offer.gtin,name:offer.name,brand:offer.brand,description:offer.description,pack:offer.pack,pack_amount:offer.packAmount,pack_unit:offer.packUnit,pack_count:offer.packCount,price:offer.price,deposit:offer.deposit,deposit_label:offer.depositLabel,displayed_price:offer.displayedPrice,original_price:offer.originalPrice,currency:offer.currency,price_type:offer.priceType,promotion_status:offer.promotionStatus,availability:offer.availability,captured_at:offer.capturedAt,expires_at:offer.expiresAt,native_promotion_valid_to:offer.nativePromotionValidTo,source_url:offer.sourceUrl,source_response_url:offer.sourceResponseUrl,proof_hash:offer.proofHash,source_response_hash:offer.sourceResponseHash,shop:offer.shop,scope_country:offer.scopeCountry,scope_channel:offer.scopeChannel};
 result.offer_hash=crypto.createHash("sha256").update(JSON.stringify(result)).digest("hex");return result;
}
const TYPES="source_id text,merchant text,native_market_id text,native_store_id text,retailer_sku text,retailer_product_id text,native_article_id text,gtin text,name text,brand text,description text,pack text,pack_amount numeric,pack_unit text,pack_count int,price numeric,deposit numeric,deposit_label text,displayed_price numeric,original_price numeric,currency text,price_type text,promotion_status text,availability text,captured_at timestamptz,expires_at timestamptz,native_promotion_valid_to timestamptz,source_url text,source_response_url text,proof_hash text,source_response_hash text,shop jsonb,scope_country text,scope_channel text,offer_hash text";
const key=offer=>[offer.source_id,offer.native_market_id,offer.retailer_sku].join("|");
async function persist(pool,inputs=[],options={}){
 if(!pool)throw fail("database-required");if(!Array.isArray(inputs)||inputs.length>50000)throw fail("invalid-published-offers");
 const now=clock(options),groups=new Map(),reasons={};let rejected=0,duplicates=0;
 const reject=(reason,count=1)=>{rejected+=count;reasons[reason]=(reasons[reason]||0)+count;};
 for(const raw of inputs){
  const checked=validateOffer(raw,{now});if(!checked.ok){rejected++;for(const reason of checked.reasons)reasons[reason]=(reasons[reason]||0)+1;continue;}
  const candidate=row(checked.offer),id=key(candidate);if(!groups.has(id))groups.set(id,new Map());else duplicates++;const captures=groups.get(id),existing=captures.get(candidate.captured_at);
  if(existing){existing.count++;if(existing.row.offer_hash!==candidate.offer_hash)existing.conflict=true;}else captures.set(candidate.captured_at,{row:candidate,count:1,conflict:false});
 }
 const accepted=[];
 for(const captures of groups.values()){const clean=[];for(const capture of captures.values())if(capture.conflict)reject("same-capture-conflict",capture.count);else clean.push(capture.row);clean.sort((a,b)=>b.captured_at.localeCompare(a.captured_at));if(clean.length)accepted.push(clean[0]);}
 await ensure(pool);let upserted=0,acceptedCount=0;
 const updated=columns.filter(column=>!["source_id","native_market_id","retailer_sku"].includes(column)).map(column=>column+"=EXCLUDED."+column).join(",");
 for(let offset=0;offset<accepted.length;offset+=500){
  let rows=accepted.slice(offset,offset+500);
  const existing=await pool.query(`SELECT p.source_id,p.native_market_id,p.retailer_sku,p.captured_at,p.offer_hash FROM ${TABLE} p JOIN jsonb_to_recordset($1::jsonb) AS x(source_id text,native_market_id text,retailer_sku text) ON p.source_id=x.source_id AND p.native_market_id=x.native_market_id AND p.retailer_sku=x.retailer_sku`,[JSON.stringify(rows.map(r=>({source_id:r.source_id,native_market_id:r.native_market_id,retailer_sku:r.retailer_sku})))]);
  const stored=new Map(existing.rows.map(r=>[key(r),r]));
  rows=rows.filter(candidate=>{const previous=stored.get(key(candidate));if(previous&&new Date(previous.captured_at).toISOString()===candidate.captured_at&&previous.offer_hash!==candidate.offer_hash){reject("same-capture-conflict");return false;}return true;});
  acceptedCount+=rows.length;if(!rows.length)continue;
  const saved=await pool.query(`INSERT INTO ${TABLE}(${columns.join(",")}) SELECT ${columns.join(",")} FROM jsonb_to_recordset($1::jsonb) AS x(${TYPES}) WHERE true ON CONFLICT(source_id,native_market_id,retailer_sku) DO UPDATE SET ${updated},updated_at=now() WHERE EXCLUDED.captured_at>${TABLE}.captured_at`,[JSON.stringify(rows)]);upserted+=saved.rowCount;
 }
 return{received:inputs.length,accepted:acceptedCount,rejected,duplicates,upserted,unchanged:acceptedCount-upserted,reasons,scopeCountry:"DE",scopeChannel:"pickup",fulfillmentChannel:"pickup",truthEligible:false};
}
const FIELDS=`source_id AS "sourceId",merchant,native_market_id AS "nativeMarketId",native_store_id AS "nativeStoreId",retailer_sku AS "retailerSku",retailer_product_id AS "retailerProductId",native_article_id AS "nativeArticleId",gtin,name,brand,description,pack,pack_amount::float AS "packAmount",pack_unit AS "packUnit",pack_count AS "packCount",price::float,deposit::float,deposit_label AS "depositLabel",displayed_price::float AS "displayedPrice",original_price::float AS "originalPrice",currency,price_type AS "priceType",promotion_status AS "promotionStatus",availability,captured_at AS "capturedAt",expires_at AS "expiresAt",native_promotion_valid_to AS "nativePromotionValidTo",source_url AS "sourceUrl",source_response_url AS "sourceResponseUrl",proof_hash AS "proofHash",source_response_hash AS "sourceResponseHash",shop,scope_country AS "scopeCountry",scope_channel AS "scopeChannel"`;
const fresh="captured_at<=$1::timestamptz AND captured_at>=$1::timestamptz-interval '24 hours' AND expires_at>$1::timestamptz";
function querySpec(options={}){
 const params=[new Date(clock(options)).toISOString()],where=["source_id='REWE Berlin pickup'","scope_country='DE'","scope_channel='pickup'",fresh],param=value=>{params.push(value);return"$"+params.length;};
 if(options.merchant!=null){const merchant=text(options.merchant,80);if(!merchant)throw fail("invalid-merchant");where.push("lower(merchant)=lower("+param(merchant)+")");}
 if(options.nativeMarketId!=null){const market=String(options.nativeMarketId).trim();if(!/^\d{1,12}$/.test(market))throw fail("invalid-native-market-id");where.push("native_market_id="+param(market));}
 if(options.nativeStoreId!=null){const store=text(options.nativeStoreId,80);if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(store))throw fail("invalid-native-store-id");where.push("native_store_id="+param(store));}
 if(options.gtin!=null){const gtin=String(options.gtin).trim();if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)||!Identity.gtinValid(gtin))throw fail("invalid-gtin");where.push("gtin="+param(gtin));}
 if(options.search!=null){const search=text(options.search);if(search){const p=param("%"+search.replace(/[\\%_]/g,"\\$&")+"%");where.push("(name ILIKE "+p+" ESCAPE '\\' OR brand ILIKE "+p+" ESCAPE '\\')");}}
 if(options.today!=null){const today=String(options.today);if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Number.isFinite(Date.parse(today))||new Date(today).toISOString().slice(0,10)!==today)throw fail("invalid-date");where.push("(captured_at AT TIME ZONE 'Europe/Berlin')::date<="+param(today)+"::date");}
 const requested=Number(options.limit??50),limit=Number.isFinite(requested)?Math.max(1,Math.min(200,Math.floor(requested))):50;
 return{sql:"SELECT "+FIELDS+" FROM "+TABLE+" WHERE "+where.join(" AND ")+" ORDER BY captured_at DESC,native_market_id,retailer_sku LIMIT "+param(limit),params};
}
function gtinQuerySpec(options={}){return{sql:`SELECT gtin FROM ${TABLE} WHERE source_id='REWE Berlin pickup' AND scope_country='DE' AND scope_channel='pickup' AND ${fresh} AND gtin IS NOT NULL`,params:[new Date(clock(options)).toISOString()]};}
function published(record){
 const deposit=record.deposit==null?null:Number(record.deposit),price=Number(record.price),displayedPrice=Number(record.displayedPrice);
 return{...record,price,deposit,displayedPrice,capturedAt:new Date(record.capturedAt).toISOString(),expiresAt:new Date(record.expiresAt).toISOString(),nativePromotionValidTo:record.nativePromotionValidTo==null?null:new Date(record.nativePromotionValidTo).toISOString(),nativePriceEUR:displayedPrice,nativePriceIncludesDeposit:false,depositIncludedInDisplayedPrice:deposit===null?null:false,payablePackPrice:deposit===null?null:(Math.round(price*100)+Math.round(deposit*100))/100,fulfillmentChannel:"pickup",serviceType:"PICKUP",state:"published",current:true,priceBasis:"pack",shippingIncluded:false,serviceFeesIncluded:false,truthEligible:false,identityStatus:record.gtin?"native-gtin":"native-retailer-sku"};
}
async function search(pool,options={}){if(!pool)throw fail("database-required");const query=querySpec(options);await ensure(pool);const result=await pool.query(query.sql,query.params);return{items:result.rows.map(published),scopeCountry:"DE",scopeChannel:"pickup",fulfillmentChannel:"pickup",maxAgeHours:24,truthEligible:false};}
async function status(pool,options={}){
 if(!pool)throw fail("database-required");const now=new Date(clock(options)).toISOString();await ensure(pool);
 const result=await pool.query(`SELECT count(*)::int AS "storedPrices",count(*) FILTER(WHERE ${fresh})::int AS "currentPrices",count(DISTINCT gtin) FILTER(WHERE ${fresh})::int AS "productsWithCurrentPublishedPrices",count(DISTINCT native_market_id) FILTER(WHERE ${fresh})::int AS "marketsWithCurrentPublishedPrices",count(*) FILTER(WHERE ${fresh} AND availability='available')::int AS "availableCurrentPrices",MAX(captured_at) AS "lastCapturedAt" FROM ${TABLE} WHERE source_id=$2 AND scope_country='DE' AND scope_channel='pickup'`,[now,SOURCE]);
 const markets=await pool.query(`SELECT merchant,source_id AS "sourceId",native_market_id AS "nativeMarketId",native_store_id AS "nativeStoreId",(array_agg(shop ORDER BY captured_at DESC,retailer_sku))[1] AS shop,count(*)::int AS "storedPrices",count(*) FILTER(WHERE ${fresh})::int AS "currentPrices",count(DISTINCT gtin) FILTER(WHERE ${fresh})::int AS "productsWithCurrentPublishedPrices",MAX(captured_at) AS "lastCapturedAt" FROM ${TABLE} WHERE source_id=$2 AND scope_country='DE' AND scope_channel='pickup' GROUP BY merchant,source_id,native_market_id,native_store_id ORDER BY native_market_id`,[now,SOURCE]);
 return{ok:true,...result.rows[0],markets:markets.rows,scopeCountry:"DE",scopeChannel:"pickup",fulfillmentChannel:"pickup",maxAgeHours:24,state:"published",truthEligible:false,shippingIncluded:false,serviceFeesIncluded:false,independentOfUserReceipts:true,note:"Öffentlich veröffentlichte REWE-Abholpreise für den Berliner Markt Hallesches Ufer 40; Filialkassenpreise und Servicegebühren sind nicht bestätigt. Unbelegte Normalpreis-/Aktionszuordnung bleibt unbekannt."};
}
module.exports={SOURCE,MERCHANT,DAY_MS,MARKET,TABLE,ensure,validateOffer,persist,querySpec,gtinQuerySpec,search,query:search,status,matchesProductQuery};
