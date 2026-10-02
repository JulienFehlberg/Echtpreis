"use strict";
const SearchFilters=require("./retailer-product-search-filters");
const Schema=require("./retailer-schema-lifecycle");

const crypto=require("node:crypto"),Client=require("./aldi-assortment-client"),Identity=require("./product-identity"),DepositProof=require("./aldi-deposit-proof");
const SOURCE=Client.SOURCE,MERCHANT="ALDI Nord",TABLE="aldi_assortment_published_prices",DAY_MS=86400000,CHANNEL="assortment-publication";
const fail=code=>Object.assign(new Error(code),{code}),text=(v,max=300)=>typeof v==="string"?v.trim().slice(0,max):"";
function clock(options={}){const n=options.now===undefined?Date.now():new Date(options.now).getTime();if(!Number.isFinite(n))throw fail("invalid-time");return n;}
function timestamp(v){if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v))return null;const n=Date.parse(v);return Number.isFinite(n)&&new Date(n).toISOString().slice(0,19)===v.slice(0,19)?n:null;}
const cents=v=>typeof v==="number"&&Number.isFinite(v)&&Math.abs(v*100-Math.round(v*100))<.000001;
// JSONB reads may reorder keys. Preserve one proof representation for capture
// idempotency without changing the hashes of historical zero/unknown-pfand rows.
const PROOF_FIELDS=["version","contractId","buildId","rendererManifestHash","depositPriceBasis","depositAmountBasis","depositLabel","retailerSku","sourceUrl","sourceResponseHash","capturedAt","pack","priceCents","depositCents","proofHash"];
function validateOffer(raw={},options={}){
 const now=clock(options),reasons=[];if(!raw||typeof raw!=="object"||Array.isArray(raw))return{ok:false,reasons:["offer-required"]};
 const retailerSku=text(raw.retailerSku,15),name=text(raw.name),brand=text(raw.brand,120)||null,variant=text(raw.variant,400)||null,pack=text(raw.pack,100);let target;
 try{target=Client.targetForUrl(raw.sourceUrl);}catch{reasons.push("exact-native-product-url-required");}
 if(raw.sourceId!==SOURCE||raw.merchant!==MERCHANT)reasons.push("retailer-source-not-approved");
 if(!/^[1-9]\d{0,14}$/.test(retailerSku)||!Number.isSafeInteger(Number(retailerSku))||target&&target.retailerSku!==retailerSku)reasons.push("native-article-id-required");
 if(!name)reasons.push("product-name-required");
 if(raw.gtin!=null&&raw.gtin!=="")reasons.push("native-gtin-unattested");
 if(raw.storeId||raw.productId||raw.canonicalProductId||raw.canonicalStoreId||raw.nativeMarketId||raw.nativeVenueId)reasons.push("physical-identity-scope-unsupported");
 if(raw.scopeCountry!=="DE"||raw.scopeChannel!==CHANNEL||raw.locationScope!=="unknown")reasons.push("assortment-DE-scope-required");
 const parsed=pack?Client.exactPack(pack):null;
 if(!parsed||raw.variableWeight===true||raw.variantAmbiguous===true)reasons.push("known-fixed-pack-required");
 if(parsed){const supplied=Identity.base(Number(raw.packAmount)*Number(raw.packCount??1),text(raw.packUnit,20));if(typeof raw.packAmount!=="number"||!Number.isFinite(raw.packAmount)||raw.packAmount<=0||!Number.isSafeInteger(raw.packCount)||raw.packCount!==parsed.count||supplied.unit!==parsed.total.unit||Math.abs(supplied.amount-parsed.total.amount)/Math.max(parsed.total.amount,1)>.001)reasons.push("pack-metadata-conflict");}
 const price=cents(raw.price)?Math.round(raw.price*100)/100:raw.price;if(!cents(price)||price<=0||price>10000)reasons.push("positive-cent-pack-price-required");
 if(raw.currency!=="EUR"||raw.priceBasis!=="pack")reasons.push("EUR-pack-price-required");
 if(raw.priceKind!=="published-current"||raw.regularPrice!=null||raw.priceType&&raw.priceType!=="unknown"||raw.promotionStatus!=="unknown")reasons.push("normal-price-classification-unattested");
 if(raw.availability!=="unknown"||raw.publicationAvailable!==true)reasons.push("publication-availability-scope-required");
 const suppliedDeposit=raw.deposit==null?null:raw.deposit,deposit=suppliedDeposit===null?null:cents(suppliedDeposit)?Math.round(suppliedDeposit*100)/100:suppliedDeposit;
 let depositBasisProof=null,positiveProof=false;
 if(deposit!==null&&cents(deposit)&&deposit>0&&deposit<=10000&&raw.depositIncluded===false){try{positiveProof=DepositProof.validateProof(raw)===true;}catch{positiveProof=false;}if(positiveProof)depositBasisProof=Object.fromEntries(PROOF_FIELDS.map(field=>[field,raw.depositBasisProof[field]]));}
 if(!(deposit===null&&raw.depositIncluded==null&&raw.depositBasisProof==null||deposit===0&&raw.depositIncluded===false&&raw.depositBasisProof==null||positiveProof))reasons.push("deposit-price-basis-unresolved");
 const captured=timestamp(raw.capturedAt),from=timestamp(raw.nativeValidFrom),until=timestamp(raw.nativeValidUntil),responseDate=timestamp(raw.sourceResponseDate),age=raw.sourceAgeSeconds??null;
 if(captured===null)reasons.push("capture-time-required");else if(captured>now)reasons.push("capture-time-future");
 if(from===null||until===null||until<=from||captured!==null&&(from>captured||until<=captured))reasons.push("native-current-validity-required");
 if(responseDate===null||captured!==null&&(responseDate<captured-300000||responseDate>captured+300000))reasons.push("fresh-source-response-date-required");
 if(age!==null&&(!Number.isSafeInteger(age)||age<0||age>300))reasons.push("source-cache-age-stale-or-invalid");
 if(!/^[a-f0-9]{64}$/.test(raw.sourceResponseHash||"")||!/^[a-f0-9]{64}$/.test(raw.proofHash||""))reasons.push("source-proof-hash-required");
 if(raw.sourceResponseUrl!=null&&raw.sourceResponseUrl!==raw.sourceUrl)reasons.push("exact-native-response-url-required");
 if(reasons.length)return{ok:false,reasons};
 const single=Identity.base(parsed.amount,parsed.unit);
 return{ok:true,reasons:[],offer:{sourceId:SOURCE,merchant:MERCHANT,retailerSku,gtin:null,name,brand,variant,pack,packAmount:single.amount,packUnit:single.unit,packCount:parsed.count,price,deposit,depositBasisProof,depositIncluded:deposit===null?null:false,currency:"EUR",priceBasis:"pack",priceKind:"published-current",priceType:"unknown",regularPrice:null,promotionStatus:"unknown",availability:"unknown",publicationAvailable:true,capturedAt:new Date(captured).toISOString(),nativeValidFrom:new Date(from).toISOString(),nativeValidUntil:new Date(until).toISOString(),expiresAt:new Date(Math.min(captured+DAY_MS,until)).toISOString(),sourceUrl:target.sourceUrl,sourceResponseUrl:target.sourceUrl,sourceResponseHash:raw.sourceResponseHash,proofHash:raw.proofHash,sourceResponseDate:new Date(responseDate).toISOString(),sourceAgeSeconds:age,scopeCountry:"DE",scopeChannel:CHANNEL,locationScope:"unknown",state:"published",truthEligible:false,identityStatus:"native-retailer-sku",shippingIncluded:false,serviceFeesIncluded:false,payablePackPrice:deposit===null?null:(Math.round(price*100)+Math.round(deposit*100))/100}};
}
async function ensure(pool){
 if(!pool)throw fail("database-required");
 return Schema.ensure(pool,TABLE,async()=>{
 await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(
 source_id text NOT NULL CHECK(source_id='ALDI Nord published assortment'),merchant text NOT NULL CHECK(merchant='ALDI Nord'),retailer_sku text NOT NULL CHECK(retailer_sku~'^[1-9][0-9]{0,14}$'),gtin text CHECK(gtin IS NULL),name text NOT NULL CHECK(length(name)>0),brand text,variant text,pack text NOT NULL,
 pack_amount numeric NOT NULL CHECK(pack_amount>0 AND pack_amount NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),pack_unit text NOT NULL CHECK(pack_unit IN ('g','ml','piece')),pack_count int NOT NULL CHECK(pack_count>0),
 price numeric NOT NULL CHECK(price>0 AND price<=10000 AND price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND price*100=trunc(price*100)),deposit numeric,deposit_basis_proof jsonb,currency text NOT NULL CHECK(currency='EUR'),price_kind text NOT NULL CHECK(price_kind='published-current'),promotion_status text NOT NULL CHECK(promotion_status='unknown'),availability text NOT NULL CHECK(availability='unknown'),publication_available boolean NOT NULL CHECK(publication_available=true),
 captured_at timestamptz NOT NULL,native_valid_from timestamptz NOT NULL,native_valid_until timestamptz NOT NULL,expires_at timestamptz NOT NULL,source_url text NOT NULL,source_response_hash text NOT NULL CHECK(source_response_hash~'^[a-f0-9]{64}$'),proof_hash text NOT NULL CHECK(proof_hash~'^[a-f0-9]{64}$'),source_response_date timestamptz NOT NULL,source_age_seconds int CHECK(source_age_seconds>=0 AND source_age_seconds<=300),
 scope_country text NOT NULL CHECK(scope_country='DE'),scope_channel text NOT NULL CHECK(scope_channel='assortment-publication'),location_scope text NOT NULL CHECK(location_scope='unknown'),offer_hash text NOT NULL CHECK(offer_hash~'^[a-f0-9]{64}$'),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_id,retailer_sku),CHECK(native_valid_from<=captured_at AND native_valid_until>captured_at),CHECK(expires_at>captured_at AND expires_at<=captured_at+interval '24 hours' AND expires_at<=native_valid_until),CHECK(source_response_date>=captured_at-interval '5 minutes' AND source_response_date<=captured_at+interval '5 minutes'),CHECK(source_url~('^https://www[.]aldi-nord[.]de/produkt/[a-z0-9-]+-'||retailer_sku||'[.]html$')));
 CREATE INDEX IF NOT EXISTS aldi_assortment_published_capture_idx ON ${TABLE}(captured_at DESC);
 ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS deposit_basis_proof jsonb;
 ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS aldi_assortment_published_prices_deposit_check;
 DO $aldi_deposit$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='${TABLE}'::regclass AND conname='aldi_assortment_deposit_proof_check') THEN
 ALTER TABLE ${TABLE} ADD CONSTRAINT aldi_assortment_deposit_proof_check CHECK(
 CASE WHEN deposit IS NULL OR deposit=0 THEN deposit_basis_proof IS NULL
 WHEN deposit>0 AND deposit<=10000 AND deposit NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND deposit*100=trunc(deposit*100) THEN COALESCE(
 jsonb_typeof(deposit_basis_proof)='object'
 AND deposit_basis_proof-ARRAY['version','contractId','buildId','rendererManifestHash','depositPriceBasis','depositAmountBasis','depositLabel','retailerSku','sourceUrl','sourceResponseHash','capturedAt','pack','priceCents','depositCents','proofHash']='{}'::jsonb
 AND deposit_basis_proof->'version'='1'::jsonb
 AND deposit_basis_proof->>'contractId'='${DepositProof.CONTRACT_ID}'
 AND deposit_basis_proof->>'buildId'='${DepositProof.BUILD_ID}'
 AND deposit_basis_proof->>'rendererManifestHash'='${DepositProof.MANIFEST_HASH}'
 AND deposit_basis_proof->>'depositPriceBasis'='excluded'
 AND deposit_basis_proof->>'depositAmountBasis'='sales-pack-total'
 AND deposit_basis_proof->>'depositLabel'='zzgl. Pfand'
 AND jsonb_typeof(deposit_basis_proof->'retailerSku')='string' AND deposit_basis_proof->>'retailerSku'=retailer_sku
 AND deposit_basis_proof->>'sourceUrl'=source_url
 AND deposit_basis_proof->>'sourceResponseHash'=source_response_hash
 AND deposit_basis_proof->>'capturedAt'=to_char(captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 AND deposit_basis_proof->>'pack'=pack
 AND deposit_basis_proof->'priceCents'=to_jsonb(price*100)
 AND deposit_basis_proof->'depositCents'=to_jsonb(deposit*100)
 AND jsonb_typeof(deposit_basis_proof->'proofHash')='string' AND deposit_basis_proof->>'proofHash'~'^[a-f0-9]{64}$',false)
 ELSE false END);
 END IF; END $aldi_deposit$;`);
 });
}
const mapping={sourceId:"source_id",merchant:"merchant",retailerSku:"retailer_sku",gtin:"gtin",name:"name",brand:"brand",variant:"variant",pack:"pack",packAmount:"pack_amount",packUnit:"pack_unit",packCount:"pack_count",price:"price",deposit:"deposit",depositBasisProof:"deposit_basis_proof",currency:"currency",priceKind:"price_kind",promotionStatus:"promotion_status",availability:"availability",publicationAvailable:"publication_available",capturedAt:"captured_at",nativeValidFrom:"native_valid_from",nativeValidUntil:"native_valid_until",expiresAt:"expires_at",sourceUrl:"source_url",sourceResponseHash:"source_response_hash",proofHash:"proof_hash",sourceResponseDate:"source_response_date",sourceAgeSeconds:"source_age_seconds",scopeCountry:"scope_country",scopeChannel:"scope_channel",locationScope:"location_scope"};
const types={pack_amount:"numeric",pack_count:"int",pack_unit:"text",price:"numeric",deposit:"numeric",deposit_basis_proof:"jsonb",publication_available:"boolean",captured_at:"timestamptz",native_valid_from:"timestamptz",native_valid_until:"timestamptz",expires_at:"timestamptz",source_response_date:"timestamptz",source_age_seconds:"int"};
const columns=[...Object.values(mapping),"offer_hash"],TYPES=columns.map(c=>c+" "+(types[c]||"text")).join(","),key=r=>r.source_id+"|"+r.retailer_sku;
function row(offer){const r=Object.fromEntries(Object.entries(mapping).map(([camel,column])=>[column,offer[camel]])),hashed=r.deposit_basis_proof===null?Object.fromEntries(Object.entries(r).filter(([column])=>column!=="deposit_basis_proof")):r;r.offer_hash=crypto.createHash("sha256").update(JSON.stringify(hashed)).digest("hex");return r;}
async function persist(pool,inputs=[],options={}){
 if(!pool)throw fail("database-required");if(!Array.isArray(inputs)||inputs.length>50000)throw fail("invalid-published-offers");const now=clock(options),groups=new Map(),reasons={};let rejected=0,duplicates=0;
 const reject=(reason,count=1)=>{rejected+=count;reasons[reason]=(reasons[reason]||0)+count;};
 for(const raw of inputs){const validated=validateOffer(raw,{now});if(!validated.ok){rejected++;for(const reason of validated.reasons)reasons[reason]=(reasons[reason]||0)+1;continue;}const candidate=row(validated.offer),id=key(candidate);if(!groups.has(id))groups.set(id,new Map());else duplicates++;const captures=groups.get(id),old=captures.get(candidate.captured_at);if(old){old.count++;if(old.row.offer_hash!==candidate.offer_hash)old.conflict=true;}else captures.set(candidate.captured_at,{row:candidate,count:1,conflict:false});}
 const accepted=[];for(const captures of groups.values()){const clean=[];for(const c of captures.values())if(c.conflict)reject("same-capture-conflict",c.count);else clean.push(c.row);clean.sort((a,b)=>b.captured_at.localeCompare(a.captured_at));if(clean.length)accepted.push(clean[0]);}
 await ensure(pool);let upserted=0,acceptedCount=0;const updates=columns.filter(c=>!["source_id","retailer_sku"].includes(c)).map(c=>c+"=EXCLUDED."+c).join(",");
 for(let offset=0;offset<accepted.length;offset+=500){let rows=accepted.slice(offset,offset+500);const existing=await pool.query(`SELECT p.source_id,p.retailer_sku,p.captured_at,p.offer_hash FROM ${TABLE} p JOIN jsonb_to_recordset($1::jsonb) AS x(source_id text,retailer_sku text) ON p.source_id=x.source_id AND p.retailer_sku=x.retailer_sku`,[JSON.stringify(rows.map(r=>({source_id:r.source_id,retailer_sku:r.retailer_sku})))]),stored=new Map(existing.rows.map(r=>[key(r),r]));rows=rows.filter(candidate=>{const old=stored.get(key(candidate));if(old&&new Date(old.captured_at).toISOString()===candidate.captured_at&&old.offer_hash!==candidate.offer_hash){reject("same-capture-conflict");return false;}return true;});acceptedCount+=rows.length;if(!rows.length)continue;const saved=await pool.query(`INSERT INTO ${TABLE}(${columns.join(",")}) SELECT ${columns.join(",")} FROM jsonb_to_recordset($1::jsonb) AS x(${TYPES}) WHERE true ON CONFLICT(source_id,retailer_sku) DO UPDATE SET ${updates},updated_at=now() WHERE EXCLUDED.captured_at>${TABLE}.captured_at`,[JSON.stringify(rows)]);upserted+=saved.rowCount;}
 return{received:inputs.length,accepted:acceptedCount,rejected,duplicates,upserted,unchanged:acceptedCount-upserted,reasons,scopeCountry:"DE",scopeChannel:CHANNEL,truthEligible:false};
}
const FIELDS=Object.entries(mapping).map(([camel,col])=>{const cast=["price","deposit","pack_amount"].includes(col)?"::float":"";return col+cast+' AS "'+camel+'"';}).join(",");
function querySpec(options={}){
 const params=[new Date(clock(options)).toISOString()],where=["source_id='ALDI Nord published assortment'","scope_country='DE'","scope_channel='assortment-publication'","captured_at<=$1::timestamptz","captured_at>=$1::timestamptz-interval '24 hours'","expires_at>$1::timestamptz","native_valid_from<=$1::timestamptz","native_valid_until>$1::timestamptz"],param=v=>{params.push(v);return"$"+params.length;};
 if(options.merchant!=null){const v=text(options.merchant,80);if(!v)throw fail("invalid-merchant");where.push("lower(merchant)=lower("+param(v)+")");}
 if(options.gtin!=null){const gtin=String(options.gtin).trim();if(!Identity.gtinValid(gtin))throw fail("invalid-gtin");where.push("gtin="+param(gtin));}
 if(options.retailerSku!=null){const v=String(options.retailerSku).trim();if(!/^[1-9]\d{0,14}$/.test(v))throw fail("invalid-retailer-sku");where.push("retailer_sku="+param(v));}
 if(options.search!=null){const v=text(options.search);if(v){const p=param("%"+v.replace(/[\\%_]/g,"\\$&")+"%");where.push("(name ILIKE "+p+" ESCAPE '\\' OR brand ILIKE "+p+" ESCAPE '\\')");}}
 if(options.today!=null){const v=String(options.today);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw fail("invalid-date");where.push("(captured_at AT TIME ZONE 'Europe/Berlin')::date<="+param(v)+"::date");}
 const requestedChannel=SearchFilters.channel(options.scopeChannel);if(requestedChannel&&requestedChannel!=="assortment-publication")where.push("false");
 const packClause=SearchFilters.sqlPack(options.pack,param);if(packClause)where.push(packClause);
 const n=Number(options.limit??50),limit=Number.isFinite(n)?Math.max(1,Math.min(200,Math.floor(n))):50;
 return{sql:"SELECT "+FIELDS+" FROM "+TABLE+" WHERE "+where.join(" AND ")+" ORDER BY captured_at DESC,retailer_sku LIMIT "+param(limit),params};
}
function published(r,now){try{const storedExpiry=new Date(r.expiresAt).getTime();if(!Number.isFinite(storedExpiry)||storedExpiry<=now)return null;const raw={...r,capturedAt:new Date(r.capturedAt).toISOString(),nativeValidFrom:new Date(r.nativeValidFrom).toISOString(),nativeValidUntil:new Date(r.nativeValidUntil).toISOString(),sourceResponseDate:new Date(r.sourceResponseDate).toISOString(),sourceResponseUrl:r.sourceUrl,priceBasis:"pack",priceType:"unknown",regularPrice:null,depositIncluded:r.deposit===null?null:false};const checked=validateOffer(raw,{now});return checked.ok?{...checked.offer,expiresAt:new Date(Math.min(storedExpiry,Date.parse(checked.offer.expiresAt))).toISOString(),current:true,physicalStorePriceVerified:false}:null;}catch{return null;}}
async function search(pool,options={}){if(!pool)throw fail("database-required");const q=querySpec(options);if(options.scopeChannel!==undefined&&options.scopeChannel!=="assortment-publication")return{items:[],scopeCountry:"DE",scopeChannel:"assortment-publication",maxAgeHours:24,truthEligible:false};await ensure(pool);const result=await pool.query(q.sql,q.params),now=clock(options);return{items:result.rows.map(r=>published(r,now)).filter(Boolean),scopeCountry:"DE",scopeChannel:CHANNEL,maxAgeHours:24,truthEligible:false};}
async function status(pool,options={}){
 if(!pool)throw fail("database-required");await ensure(pool);const now=new Date(clock(options)).toISOString(),fresh="captured_at<=$1::timestamptz AND captured_at>=$1::timestamptz-interval '24 hours' AND expires_at>$1::timestamptz AND native_valid_from<=$1::timestamptz AND native_valid_until>$1::timestamptz";
 const result=await pool.query(`SELECT count(*)::int AS "storedPrices",count(*) FILTER(WHERE ${fresh})::int AS "currentPrices",count(DISTINCT gtin) FILTER(WHERE ${fresh})::int AS "productsWithCurrentPublishedPrices",MAX(captured_at) AS "lastCapturedAt" FROM ${TABLE} WHERE source_id=$2`,[now,SOURCE]);
 return{ok:true,...result.rows[0],availableCurrentPrices:0,merchants:[{merchant:MERCHANT,sourceId:SOURCE,...result.rows[0]}],scopeCountry:"DE",scopeChannel:CHANNEL,locationScope:"unknown",maxAgeHours:24,state:"published",truthEligible:false,physicalStorePriceVerified:false,normalPriceClassificationVerified:false,independentOfUserReceipts:true,note:"Veröffentlichte ALDI-Nord-Packpreise aus öffentlichen Produktseiten; konkrete Filiale, Regalverfügbarkeit und Normalpreis-/Aktionszuordnung sind unbekannt. Native Preisgültigkeit begrenzt die Frische zusätzlich."};
}
module.exports={SOURCE,MERCHANT,TABLE,DAY_MS,CHANNEL,ensure,validateOffer,persist,querySpec,search,status};
