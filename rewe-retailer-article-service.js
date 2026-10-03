"use strict";

// Private original-bound identities. Article persistence grants no price or stock authority.
const crypto=require("node:crypto"),Client=require("./rewe-retailer-price-client"),Identity=require("./product-identity"),Schema=require("./retailer-schema-lifecycle");
const SOURCE="REWE Berlin pickup articles",MERCHANT="REWE",TABLE="rewe_retailer_articles",CAPTURE_TABLE="rewe_retailer_article_originals",PROOF_TABLE="rewe_retailer_article_captures",MAX_ROWS=10000,MAX_PAGES=48,MAX_OFFSET=10000;
const fail=code=>Object.assign(new Error(code),{code}),plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const sha=v=>crypto.createHash("sha256").update(v).digest("hex");
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(plain(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
const serialized=v=>JSON.stringify(canonical(v)),hash=v=>sha(serialized(v)),same=(a,b)=>serialized(a)===serialized(b);
function clock(options={}){const n=options.now===undefined?Date.now():options.now;if(!Number.isSafeInteger(n)||n<0||!Number.isFinite(new Date(n).getTime()))throw fail("invalid-article-time");return n;}
function iso(v){if(typeof v!=="string")return null;const n=Date.parse(v);return Number.isFinite(n)&&new Date(n).toISOString()===v?v:null;}
function text(v,max=500){return typeof v==="string"&&v===v.trim()&&v.length>0&&v.length<=max&&!/[<>\u0000-\u001f\u007f]/.test(v)?v:null;}
const identityFields=["sourceId","merchant","nativeMarketId","nativeStoreId","retailerSku","retailerProductId","nativeArticleId","gtin","name","brand","description","variant","pack","packAmount","packUnit","packCount","sourceUrl","shop","scopeCountry","scopeChannel","locationScope"];
const viewFields=[...identityFields,"sourceResponseUrl","sourceResponseHash","sourceResponseDate","sourceAgeSeconds","observedAt","purpose","identityScope","truthEligible","witnessHash","identityHash","captureHash","kind","state","availability","currentPriceVerified","currentAvailabilityVerified","physicalStorePriceVerified","normalPriceClassificationVerified","assortmentComplete","expiresAt"];
function validateView(raw={},options={}){
 const now=clock(options),reasons=[];
 if(!plain(raw))return{ok:false,reasons:["native-article-required"],article:null};
 if(Object.keys(raw).some(k=>!viewFields.includes(k)))reasons.push("invalid-native-article-view-fields");
 if(raw.sourceId!==SOURCE||raw.merchant!==MERCHANT||raw.nativeMarketId!==Client.MARKET_ID||raw.nativeStoreId!==Client.NATIVE_STORE_ID||raw.scopeCountry!=="DE"||raw.scopeChannel!=="pickup"||raw.locationScope!=="pickup-market"||raw.purpose!=="identity"||raw.identityScope!=="retailer-sku")reasons.push("native-article-scope-required");
 const listing=/^([1-9]\d{0,4})-([A-Z0-9]{1,40})-(7ae33841-fa98-3b7e-9ee5-8132f39c189c)$/.exec(raw.retailerSku||"");
 if(!listing||listing[2]!==raw.nativeArticleId||!/^[1-9]\d{0,11}$/.test(raw.retailerProductId||"")||raw.gtin!==null&&(typeof raw.gtin!=="string"||!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(raw.gtin)||!Identity.gtinValid(raw.gtin)))reasons.push("native-article-identity-required");
 if(!text(raw.name)||raw.brand!==null&&!text(raw.brand,120)||raw.description!==null||raw.variant!==null)reasons.push("native-article-label-required");
 const p=Client.salesPack(raw.pack);
 if(!p||p.pack!==raw.pack||p.parsed.count>1000||p.parsed.total.amount>100000000)reasons.push("native-article-exact-pack-required");
 else{const base=Identity.base(p.parsed.amount,p.parsed.unit);if(raw.packAmount!==base.amount||raw.packUnit!==base.unit||raw.packCount!==p.parsed.count)reasons.push("native-article-pack-metadata-conflict");}
 const expected=Client.MARKET;
 if(!plain(raw.shop)||Object.keys(expected).some(k=>raw.shop[k]!==expected[k])||Object.keys(raw.shop).some(k=>!Object.hasOwn(expected,k)))reasons.push("native-Berlin-shop-required");
 if(typeof raw.sourceUrl!=="string"||!raw.sourceUrl.startsWith(Client.ORIGIN+"/shop/p/")||Client.sourceUrl(raw.sourceUrl.slice((Client.ORIGIN+"/shop").length),raw.retailerProductId)!==raw.sourceUrl)reasons.push("native-article-product-url-required");
 try{if(Client.allowedUrl(raw.sourceResponseUrl)!==raw.sourceResponseUrl||new URL(raw.sourceResponseUrl).pathname!=="/shop/api/products")throw Error();}catch{reasons.push("native-article-original-url-required");}
 const at=iso(raw.observedAt),date=iso(raw.sourceResponseDate);
 if(!at||Date.parse(at)>now||!date||Date.parse(date)<Date.parse(at)-900000||Date.parse(date)>Date.parse(at)+300000||!Object.hasOwn(raw,"sourceAgeSeconds")||raw.sourceAgeSeconds!==null&&(!Number.isSafeInteger(raw.sourceAgeSeconds)||raw.sourceAgeSeconds<0||raw.sourceAgeSeconds>900))reasons.push("native-article-original-time-required");
 if(!["sourceResponseHash","witnessHash","identityHash","captureHash"].every(k=>/^[a-f0-9]{64}$/.test(raw[k]||"")))reasons.push("native-article-proof-required");
 if(raw.kind!=="native-retailer-article"||raw.state!=="last-observed"||raw.availability!=="unknown"||raw.expiresAt!==null||["truthEligible","currentPriceVerified","currentAvailabilityVerified","physicalStorePriceVerified","normalPriceClassificationVerified","assortmentComplete"].some(k=>raw[k]!==false))reasons.push("article-authority-forbidden");
 return{ok:reasons.length===0,reasons,article:reasons.length?null:raw};
}
function rowForArticle(article,original){
 const metadata={meta:original.meta,category:original.category,pageNumber:original.pageNumber};
 const r={source_id:SOURCE,retailer_sku:article.retailerSku,observed_at:article.observedAt,source_response_hash:article.sourceResponseHash,original_metadata:metadata,article};
 r.identity_hash=hash(identityFields.map(k=>article[k]));r.capture_hash=hash(r);return r;
}
function view(row,now){
 const {nativeWitness,storeId,...a}=row.article;
 const result={...a,witnessHash:hash(nativeWitness),identityHash:row.identity_hash,captureHash:row.capture_hash,kind:"native-retailer-article",state:"last-observed",availability:"unknown",truthEligible:false,currentPriceVerified:false,currentAvailabilityVerified:false,physicalStorePriceVerified:false,normalPriceClassificationVerified:false,assortmentComplete:false,expiresAt:null};
 return validateView(result,{now}).ok?result:null;
}
async function ensure(pool){
 if(!pool||typeof pool.query!=="function")throw fail("database-required");
 const initialize=()=>pool.query(`
 CREATE TABLE IF NOT EXISTS ${CAPTURE_TABLE}(source_response_hash text PRIMARY KEY CHECK(source_response_hash~'^[a-f0-9]{64}$'),body text NOT NULL,body_bytes int NOT NULL CHECK(body_bytes BETWEEN 1 AND 4194304),CHECK(octet_length(body)=body_bytes));
 CREATE TABLE IF NOT EXISTS ${PROOF_TABLE}(capture_proof_hash text PRIMARY KEY CHECK(capture_proof_hash~'^[a-f0-9]{64}$'),source_response_hash text NOT NULL REFERENCES ${CAPTURE_TABLE}(source_response_hash),original_metadata jsonb NOT NULL CHECK(jsonb_typeof(original_metadata)='object' AND octet_length(original_metadata::text)<=8192),admissible boolean NOT NULL);
 CREATE INDEX IF NOT EXISTS rewe_article_capture_body_idx ON ${PROOF_TABLE}(source_response_hash);
 CREATE TABLE IF NOT EXISTS ${TABLE}(
 source_id text NOT NULL CHECK(source_id='REWE Berlin pickup articles'),retailer_sku text NOT NULL CHECK(retailer_sku~'^[1-9][0-9]{0,4}-[A-Z0-9]{1,40}-7ae33841-fa98-3b7e-9ee5-8132f39c189c$'),
 observed_at timestamptz NOT NULL CHECK(isfinite(observed_at)),source_response_hash text NOT NULL REFERENCES ${CAPTURE_TABLE}(source_response_hash),
 original_metadata jsonb NOT NULL CHECK(jsonb_typeof(original_metadata)='object' AND octet_length(original_metadata::text)<=8192),article jsonb NOT NULL CHECK(jsonb_typeof(article)='object' AND octet_length(article::text)<=32768),
 identity_hash text NOT NULL CHECK(identity_hash~'^[a-f0-9]{64}$'),capture_hash text NOT NULL CHECK(capture_hash~'^[a-f0-9]{64}$'),held boolean NOT NULL DEFAULT false,conflict_capture jsonb,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(source_id,retailer_sku),
 CHECK(COALESCE(article->>'sourceId'=source_id AND article->>'retailerSku'=retailer_sku AND article->>'scopeCountry'='DE' AND article->>'scopeChannel'='pickup' AND article->>'nativeMarketId'='8321066' AND article->>'nativeStoreId'='7ae33841-fa98-3b7e-9ee5-8132f39c189c',false)),
 CHECK(COALESCE((NOT held AND conflict_capture IS NULL) OR (held AND jsonb_typeof(conflict_capture)='object' AND octet_length(conflict_capture::text)<=49152 AND conflict_capture->>'retailer_sku'=retailer_sku AND conflict_capture->>'identity_hash'<>identity_hash AND (conflict_capture->>'observed_at')::timestamptz=observed_at),false)));
 CREATE INDEX IF NOT EXISTS rewe_articles_observed_idx ON ${TABLE}(observed_at DESC,retailer_sku);`);
 return typeof pool.release==="function"?initialize():Schema.ensure(pool,TABLE,initialize);
}
async function writingTransaction(tx){
 if(!tx||typeof tx.query!=="function"||typeof tx.release!=="function")throw fail("article-transaction-client-required");
 if((await tx.query('SELECT txid_current_if_assigned() IS NOT NULL AS "transactionOpen"')).rows[0]?.transactionOpen!==true)throw fail("article-open-writing-transaction-required");
 await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[SOURCE]);
}
async function persist(tx,originalPages=[],options={}){
 const now=clock(options);if(!Array.isArray(originalPages)||originalPages.length>MAX_PAGES)throw fail("invalid-native-original-pages");await writingTransaction(tx);
 const captures=[],candidates=[],reasons={};let received=0,rejected=0;
 for(const original of originalPages){
  const checked=Client.reparseOriginalPage(original,{now});
  if(Buffer.byteLength(JSON.stringify({meta:original.meta,category:original.category,pageNumber:original.pageNumber}))>8192)throw fail("native-article-original-metadata-too-large");
  received+=checked.received;rejected+=checked.identityRejected.length;for(const r of checked.identityRejected)for(const reason of r.reasons)reasons[reason]=(reasons[reason]||0)+1;
  captures.push(original);
  for(const article of checked.products){
   if(Buffer.byteLength(JSON.stringify(article))>32768){rejected++;reasons["native-article-witness-too-large"]=(reasons["native-article-witness-too-large"]||0)+1;continue;}
   const r=rowForArticle(article,original);if(!view(r,now))throw fail("native-article-rederived-view-invalid");candidates.push(r);
  }
 }
 if(candidates.length>MAX_ROWS)throw fail("invalid-native-articles");
 const oldRows=candidates.length?(await tx.query(`SELECT retailer_sku,observed_at,source_response_hash,original_metadata FROM ${TABLE} WHERE source_id=$1 AND retailer_sku=ANY($2::text[]) FOR UPDATE`,[SOURCE,[...new Set(candidates.map(r=>r.retailer_sku))]])).rows:[],oldBySku=new Map(oldRows.map(r=>[r.retailer_sku,r])),replayProofs=new Set(),retimedSkus=new Set();
 for(const r of candidates){const old=oldBySku.get(r.retailer_sku);if(old&&new Date(old.observed_at).toISOString()!==r.observed_at&&old.source_response_hash===r.source_response_hash&&old.original_metadata?.meta?.sourceResponseDate===r.original_metadata.meta.sourceResponseDate&&old.original_metadata?.meta?.sourceAgeSeconds===r.original_metadata.meta.sourceAgeSeconds){replayProofs.add(hash(r.original_metadata));retimedSkus.add(r.retailer_sku);}}
 // The latest SKU row can have changed since a genuine capture. Bind replay
 // detection to all retained original proofs, including captures with no SKU.
 for(const original of captures){
  const meta=original.meta,metadata={meta,category:original.category,pageNumber:original.pageNumber};
  const retained=(await tx.query(`SELECT EXISTS(SELECT 1 FROM ${PROOF_TABLE} WHERE source_response_hash=$1 AND admissible=true AND original_metadata->'meta'->>'sourceResponseUrl'=$2 AND original_metadata->'meta'->>'sourceResponseDate'=$3 AND original_metadata->'meta'->'sourceAgeSeconds'=$4::jsonb AND original_metadata->'meta'->>'capturedAt'<>$5) AS replay`,[meta.sourceResponseHash,meta.sourceResponseUrl,meta.sourceResponseDate,JSON.stringify(meta.sourceAgeSeconds),meta.capturedAt])).rows[0];
  if(retained?.replay===true){const proofHash=hash(metadata);replayProofs.add(proofHash);for(const r of candidates)if(hash(r.original_metadata)===proofHash)retimedSkus.add(r.retailer_sku);}
 }
 if(retimedSkus.size)reasons["original-capture-replay-retimed"]=retimedSkus.size;
 for(const original of captures){
  await tx.query(`INSERT INTO ${CAPTURE_TABLE}(source_response_hash,body,body_bytes) VALUES($1,$2,$3) ON CONFLICT(source_response_hash) DO NOTHING`,[original.meta.sourceResponseHash,original.body,Buffer.byteLength(original.body)]);
  const stored=(await tx.query(`SELECT body,body_bytes FROM ${CAPTURE_TABLE} WHERE source_response_hash=$1`,[original.meta.sourceResponseHash])).rows[0];
  if(!stored||stored.body!==original.body||stored.body_bytes!==Buffer.byteLength(original.body))throw fail("native-article-original-storage-conflict");
  const metadata={meta:original.meta,category:original.category,pageNumber:original.pageNumber},proofHash=hash(metadata);
  const admissible=!replayProofs.has(proofHash);
  await tx.query(`INSERT INTO ${PROOF_TABLE}(capture_proof_hash,source_response_hash,original_metadata,admissible) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(capture_proof_hash) DO NOTHING`,[proofHash,original.meta.sourceResponseHash,JSON.stringify(metadata),admissible]);
  const proof=(await tx.query(`SELECT source_response_hash,original_metadata,admissible FROM ${PROOF_TABLE} WHERE capture_proof_hash=$1`,[proofHash])).rows[0];
  if(!proof||proof.source_response_hash!==original.meta.sourceResponseHash||!same(proof.original_metadata,metadata)||proof.admissible!==admissible)throw fail("native-article-original-proof-storage-conflict");
 }
 const groups=new Map();for(const r of candidates){if(replayProofs.has(hash(r.original_metadata)))continue;if(!groups.has(r.retailer_sku))groups.set(r.retailer_sku,[]);groups.get(r.retailer_sku).push(r);}
 const latest=[];let duplicates=0;
 for(const rows of groups.values()){rows.sort((a,b)=>b.observed_at.localeCompare(a.observed_at)||a.capture_hash.localeCompare(b.capture_hash));const first=rows[0],sameClock=rows.filter(r=>r.observed_at===first.observed_at),unique=new Map(sameClock.map(r=>[r.capture_hash,r]));duplicates+=sameClock.length-unique.size;const conflict=[...unique.values()].find(r=>r.identity_hash!==first.identity_hash);latest.push({...first,held:!!conflict,conflict_capture:conflict||null});}
 let upserted=0;const retimedReplays=retimedSkus.size,admitted=[];
 for(const r of latest){
  admitted.push(r.retailer_sku);
  const saved=await tx.query(`INSERT INTO ${TABLE}(source_id,retailer_sku,observed_at,source_response_hash,original_metadata,article,identity_hash,capture_hash,held,conflict_capture) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10::jsonb)
   ON CONFLICT(source_id,retailer_sku) DO UPDATE SET
   observed_at=CASE WHEN EXCLUDED.observed_at>${TABLE}.observed_at THEN EXCLUDED.observed_at ELSE ${TABLE}.observed_at END,
   source_response_hash=CASE WHEN EXCLUDED.observed_at>${TABLE}.observed_at THEN EXCLUDED.source_response_hash ELSE ${TABLE}.source_response_hash END,
   original_metadata=CASE WHEN EXCLUDED.observed_at>${TABLE}.observed_at THEN EXCLUDED.original_metadata ELSE ${TABLE}.original_metadata END,
   article=CASE WHEN EXCLUDED.observed_at>${TABLE}.observed_at THEN EXCLUDED.article ELSE ${TABLE}.article END,
   identity_hash=CASE WHEN EXCLUDED.observed_at>${TABLE}.observed_at THEN EXCLUDED.identity_hash ELSE ${TABLE}.identity_hash END,
   capture_hash=CASE WHEN EXCLUDED.observed_at>${TABLE}.observed_at THEN EXCLUDED.capture_hash ELSE ${TABLE}.capture_hash END,
   held=CASE WHEN EXCLUDED.observed_at>${TABLE}.observed_at THEN EXCLUDED.held WHEN EXCLUDED.observed_at=${TABLE}.observed_at AND (EXCLUDED.held OR EXCLUDED.identity_hash<>${TABLE}.identity_hash) THEN true ELSE ${TABLE}.held END,
   conflict_capture=CASE WHEN EXCLUDED.observed_at>${TABLE}.observed_at THEN EXCLUDED.conflict_capture WHEN ${TABLE}.held THEN ${TABLE}.conflict_capture WHEN EXCLUDED.observed_at=${TABLE}.observed_at AND EXCLUDED.identity_hash<>${TABLE}.identity_hash THEN to_jsonb(EXCLUDED)-ARRAY['held','conflict_capture','updated_at'] WHEN EXCLUDED.observed_at=${TABLE}.observed_at AND EXCLUDED.held THEN EXCLUDED.conflict_capture ELSE ${TABLE}.conflict_capture END,updated_at=now()
   WHERE EXCLUDED.observed_at>${TABLE}.observed_at OR EXCLUDED.observed_at=${TABLE}.observed_at AND NOT ${TABLE}.held AND (EXCLUDED.held OR EXCLUDED.identity_hash<>${TABLE}.identity_hash)`,[SOURCE,r.retailer_sku,r.observed_at,r.source_response_hash,JSON.stringify(r.original_metadata),JSON.stringify(r.article),r.identity_hash,r.capture_hash,r.held,JSON.stringify(r.conflict_capture)]);
  upserted+=saved.rowCount||0;
 }
 const held=admitted.length?Number((await tx.query(`SELECT count(*)::int AS count FROM ${TABLE} WHERE source_id=$1 AND retailer_sku=ANY($2::text[]) AND held`,[SOURCE,admitted])).rows[0]?.count||0):0;
 return{received,accepted:admitted.length-held,rejected,duplicates,upserted,unchanged:Math.max(0,admitted.length-upserted),held,retimedReplays,retimedCaptures:replayProofs.size,reasons,sourceId:SOURCE,scopeCountry:"DE",scopeChannel:"pickup",truthEligible:false};
}
async function readRows(pool,rows,options={}){
 const now=clock(options);if(!Array.isArray(rows)||rows.length>MAX_ROWS)throw fail("invalid-native-article-rows");
 const hashes=[...new Set(rows.map(r=>r.source_response_hash).filter(h=>/^[a-f0-9]{64}$/.test(h||"")))],result=[];
 // Bound loaded bodies and parsed pages to eight originals at a time. Preserve
 // the requested row order rather than silently reporting a partial status.
 for(let i=0;i<hashes.length;i+=8){
  const wanted=new Set(hashes.slice(i,i+8)),originals=new Map(),parsed=new Map();
  const found=await pool.query(`SELECT source_response_hash,body,body_bytes FROM ${CAPTURE_TABLE} WHERE source_response_hash=ANY($1::text[]) AND body_bytes BETWEEN 1 AND 4194304`,[[...wanted]]);
  if(found.rows.length>wanted.size)throw fail("native-article-original-read-bound");
  for(const r of found.rows)if(wanted.has(r.source_response_hash)&&typeof r.body==="string"&&r.body_bytes===Buffer.byteLength(r.body)&&r.body_bytes<=4194304&&sha(r.body)===r.source_response_hash)originals.set(r.source_response_hash,r.body);
  const metadataHashes=new Set();for(const row of rows)if(wanted.has(row.source_response_hash)&&plain(row.original_metadata))try{metadataHashes.add(hash(row.original_metadata));}catch{}
  const retained=metadataHashes.size?(await pool.query(`SELECT capture_proof_hash,source_response_hash,original_metadata,admissible FROM ${PROOF_TABLE} WHERE capture_proof_hash=ANY($1::text[]) AND admissible=true AND octet_length(original_metadata::text)<=8192`,[[...metadataHashes]])).rows:[];
  if(retained.length>metadataHashes.size)throw fail("native-article-original-proof-read-bound");
  const proofs=new Map(retained.filter(p=>p.admissible===true&&metadataHashes.has(p.capture_proof_hash)&&hash(p.original_metadata)===p.capture_proof_hash).map(p=>[p.capture_proof_hash,p]));
  for(const [index,row] of rows.entries()){
   if(!wanted.has(row.source_response_hash))continue;
  try{
   if(row.source_id!==SOURCE||row.held||row.conflict_capture!=null||!iso(new Date(row.observed_at).toISOString())||new Date(row.observed_at).getTime()>now||!plain(row.original_metadata)||!plain(row.article))continue;
   const body=originals.get(row.source_response_hash);if(!body)continue;
   const proof=proofs.get(hash(row.original_metadata));if(!proof||proof.source_response_hash!==row.source_response_hash||!same(proof.original_metadata,row.original_metadata))continue;
   const original={body,...row.original_metadata},at=original.meta?.capturedAt;if(!iso(at)||at!==new Date(row.observed_at).toISOString()||original.meta.sourceResponseHash!==row.source_response_hash)continue;
   const cacheKey=hash([row.source_response_hash,row.original_metadata]);if(!parsed.has(cacheKey))parsed.set(cacheKey,Client.reparseOriginalPage(original,{now:Date.parse(at)}));
   const candidates=parsed.get(cacheKey).products.filter(a=>a.retailerSku===row.retailer_sku);
   if(!candidates.length)continue;const derived=candidates.map(a=>rowForArticle(a,original));if(new Set(derived.map(r=>r.identity_hash)).size!==1)continue;
   const expected=derived.find(r=>same(r.article,row.article));if(!expected||expected.identity_hash!==row.identity_hash||expected.capture_hash!==row.capture_hash||!same(expected.original_metadata,row.original_metadata))continue;
   const item=view(expected,now);if(item)result.push({index,item});
  }catch{/* Invalid latest evidence remains excluded; never fall back to an older article. */}
  }
 }
 return result.sort((a,b)=>a.index-b.index).map(r=>r.item);
}
function queryOptions(options={}){
 if(!plain(options)||Object.keys(options).some(k=>!["merchant","scopeChannel","search","limit","offset","now"].includes(k)))throw fail("invalid-native-article-query");
 if(options.merchant!==undefined&&options.merchant!==MERCHANT||options.scopeChannel!==undefined&&options.scopeChannel!=="pickup")throw fail("invalid-native-article-scope");
 const number=(v,fallback,min,max)=>{if(v===undefined)return fallback;if(typeof v==="string"&&/^(0|[1-9]\d*)$/.test(v))v=Number(v);if(!Number.isSafeInteger(v)||v<min||v>max)throw fail("invalid-native-article-pagination");return v;};
 let search;if(options.search!==undefined){if(typeof options.search!=="string"||options.search.trim().length<2||options.search.trim().length>120||/[\u0000-\u001f\u007f]/.test(options.search))throw fail("invalid-native-article-search");search=options.search.trim();}
 return{now:clock(options),limit:number(options.limit,50,1,200),offset:number(options.offset,0,0,MAX_OFFSET),search};
}
async function search(pool,options={}){
 const q=queryOptions(options);await ensure(pool);const params=[SOURCE,new Date(q.now).toISOString()],where=["source_id=$1","observed_at<=$2::timestamptz"];
 if(q.search){params.push("%"+q.search.replace(/[\\%_]/g,"\\$&")+"%");where.push(`(article->>'name' ILIKE $3 ESCAPE '\\' OR article->>'brand' ILIKE $3 ESCAPE '\\')`);}
 params.push(q.limit,q.offset);const rows=(await pool.query(`SELECT * FROM ${TABLE} WHERE ${where.join(" AND ")} ORDER BY observed_at DESC,retailer_sku LIMIT $${params.length-1} OFFSET $${params.length}`,params)).rows,items=await readRows(pool,rows,{now:q.now});
 return{ok:true,sourceId:SOURCE,merchant:MERCHANT,items,scannedRows:rows.length,nextOffset:q.offset+rows.length,hasMore:rows.length===q.limit&&q.offset+rows.length<=MAX_OFFSET,scopeCountry:"DE",scopeChannel:"pickup",truthEligible:false,currentPriceVerified:false,assortmentComplete:false};
}
async function status(pool,options={}){
 if(!plain(options)||Object.keys(options).some(k=>k!=="now"))throw fail("invalid-native-article-query");const now=clock(options);await ensure(pool);
 const rows=(await pool.query(`SELECT * FROM ${TABLE} WHERE source_id=$1 ORDER BY observed_at DESC,retailer_sku LIMIT $2`,[SOURCE,MAX_ROWS+1])).rows;if(rows.length>MAX_ROWS)throw fail("native-article-status-safety-limit");
 const valid=await readRows(pool,rows,{now}),held=rows.filter(r=>r.held===true).length;
 const originalCounts=(await pool.query(`SELECT count(*)::int AS count,COALESCE(sum(body_bytes),0)::float AS bytes,(SELECT count(*)::int FROM ${PROOF_TABLE}) AS proofs FROM ${CAPTURE_TABLE}`)).rows[0];
 return{ok:true,sourceId:SOURCE,merchant:MERCHANT,storedArticles:rows.length,heldArticles:held,lastObservedArticles:valid.length,excludedInvalidArticles:rows.length-held-valid.length,lastObservedAt:valid.length?valid.map(a=>a.observedAt).sort().at(-1):null,storedCaptureBodies:Number(originalCounts?.count||0),storedCaptureBytes:Number(originalCounts?.bytes||0),storedCaptureProofs:Number(originalCounts?.proofs||0),scopeCountry:"DE",scopeChannel:"pickup",locationScope:"pickup-market",shop:Client.MARKET,availability:"unknown",truthEligible:false,currentPriceVerified:false,currentAvailabilityVerified:false,physicalStorePriceVerified:false,assortmentComplete:false,independentOfPrice:true,independentOfUserReceipts:true};
}
module.exports={SOURCE,MERCHANT,TABLE,CAPTURE_TABLE,PROOF_TABLE,MAX_ROWS,MAX_OFFSET,ensure,persist,readRows,rowForArticle,validateView,queryOptions,search,status};
