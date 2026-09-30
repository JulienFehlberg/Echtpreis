"use strict";

const Inventory=require("./canonical-inventory-import");
const SOURCE="Open Food Facts",CHUNK_SIZE=500;
const ATTRIBUTION={source:SOURCE,url:"https://world.openfoodfacts.org",license:"ODbL-1.0",licenseUrl:"https://opendatacommons.org/licenses/odbl/1-0/",purpose:"identity"};
const PRODUCT_FIELDS='id,canonical_key AS "canonicalKey",gtin,name,brand,pack_amount::float AS "packAmount",pack_unit AS "packUnit",pack_count::float AS "packCount"';
function productCandidate(raw={}){
 const p=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
 const name=[p.product_name_de,p.product_name,p.product_name_en].find(value=>typeof value==="string"&&value.trim());
 const candidate=Inventory.productCandidate({product:{...p,code:p.code??p._id,product_name:name}}),reasons=[...candidate.reasons];
 if(!Array.isArray(p.countries_tags)||!p.countries_tags.includes("en:germany"))reasons.push("catalog-germany-market-required");
 if(p.code!=null&&p._id!=null&&String(p.code)!==String(p._id))reasons.push("catalog-product-code-conflict");
 if(candidate.name&&/^[\d\s.,+-]+$/.test(candidate.name))reasons.push("catalog-readable-product-name-required");
 return{...candidate,ok:reasons.length===0,reasons,raw:p,externalProductId:"off:"+candidate.gtin,sourceId:SOURCE,purpose:"identity",truthEligible:false};
}
function verified(mapping,gtin,productId){const confidence=Number(mapping.confidence);return mapping.status==="verified"&&Number.isFinite(confidence)&&confidence>=.9&&confidence<=1&&mapping.gtin===gtin&&(!productId||mapping.productId===productId)}
function productRecord(candidate){return{canonicalKey:candidate.canonicalKey,gtin:candidate.gtin,name:candidate.name,brand:candidate.brand,packAmount:candidate.packParsed.amount,packUnit:candidate.packParsed.unit,packCount:candidate.packParsed.count}}
function displayPack(p){return(p.packCount>1?p.packCount+" x ":"")+p.packAmount+" "+p.packUnit}
function packCompatible(a,b){return Inventory.matchingPack(a,b)}
async function readProducts(client,candidates){
 return(await client.query("SELECT "+PRODUCT_FIELDS+" FROM products WHERE gtin=ANY($1::text[]) OR canonical_key=ANY($2::text[]) ORDER BY gtin FOR UPDATE",[candidates.map(p=>p.gtin),candidates.map(p=>p.canonicalKey)])).rows;
}
async function readMappings(client,candidates){
 return(await client.query('SELECT ep.external_product_id AS "externalProductId",ep.product_id AS "productId",ep.status,ep.confidence::float,p.gtin FROM external_product_mappings ep JOIN products p ON p.id=ep.product_id WHERE ep.source_id=$1 AND ep.external_product_id=ANY($2::text[]) FOR UPDATE OF ep',[SOURCE,candidates.map(p=>p.externalProductId)])).rows;
}
async function importChunk(pool,candidates,options){
 const client=await pool.connect(),accepted=[],rejected=[];let created=0,mappingsCreated=0,evidenceCreated=0;
 try{
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["canonical-product-catalog:"+SOURCE]);
  const current=await readProducts(client,candidates),mappingRows=await readMappings(client,candidates);
  const byGtin=new Map(current.map(p=>[p.gtin,p])),byKey=new Map(current.map(p=>[p.canonicalKey,p])),mappings=new Map(mappingRows.map(m=>[m.externalProductId,m])),pending=[];
  for(const candidate of candidates){
   const product=byGtin.get(candidate.gtin),canonical=byKey.get(candidate.canonicalKey),mapping=mappings.get(candidate.externalProductId),reasons=[];
   if(canonical&&canonical.gtin!==candidate.gtin)reasons.push("catalog-canonical-key-conflict");
   if(product&&!packCompatible(product,candidate))reasons.push("catalog-existing-pack-conflict");
   if(mapping&&!verified(mapping,candidate.gtin,product?.id))reasons.push("catalog-existing-mapping-needs-review");
   if(reasons.length)rejected.push({raw:candidate.raw,reasons});else pending.push(candidate);
  }
  if(pending.length){
   const inserted=await client.query(`INSERT INTO products(canonical_key,gtin,name,brand,pack_amount,pack_unit,pack_count,identity_status)
    SELECT x."canonicalKey",x.gtin,x.name,x.brand,x."packAmount",x."packUnit",x."packCount",'verified'
    FROM jsonb_to_recordset($1::jsonb) AS x("canonicalKey" text,gtin text,name text,brand text,"packAmount" numeric,"packUnit" text,"packCount" numeric)
    ORDER BY x.gtin ON CONFLICT DO NOTHING RETURNING id,gtin`,[JSON.stringify(pending.filter(p=>!byGtin.has(p.gtin)).map(productRecord))]);
   const insertedIds=new Set(inserted.rows.map(p=>p.id));created=inserted.rows.length;
   // A different source may have inserted the same GTIN after the first read.
   // Resolve the actual committed canonical row and recheck its pack; never fill
   // in an ID by assuming our attempted insert won the uniqueness constraint.
   const resolved=await readProducts(client,pending),resolvedByGtin=new Map(resolved.map(p=>[p.gtin,p])),confirmed=[];
   for(const candidate of pending){
    const product=resolvedByGtin.get(candidate.gtin);
    if(!product||!packCompatible(product,candidate)){rejected.push({raw:candidate.raw,reasons:[product?"catalog-existing-pack-conflict":"catalog-canonical-key-conflict"]});continue}
    confirmed.push({candidate,product});
   }
   const links=confirmed.map(({candidate,product})=>({externalProductId:candidate.externalProductId,productId:product.id}));
   const linked=await client.query(`INSERT INTO external_product_mappings(source_id,external_product_id,product_id,status,confidence,match_reason,verified_at)
    SELECT $2,x."externalProductId",x."productId",'verified',1,'gtin',now()
    FROM jsonb_to_recordset($1::jsonb) AS x("externalProductId" text,"productId" uuid)
    ORDER BY x."externalProductId" ON CONFLICT DO NOTHING RETURNING external_product_id`,[JSON.stringify(links),SOURCE]);mappingsCreated=linked.rowCount||0;
   const actualMappings=new Map((await readMappings(client,confirmed.map(p=>p.candidate))).map(m=>[m.externalProductId,m]));
   const evidences=[];
   for(const {candidate,product} of confirmed){
    const mapping=actualMappings.get(candidate.externalProductId);
    if(!mapping||!verified(mapping,candidate.gtin,product.id)){rejected.push({raw:candidate.raw,reasons:["catalog-existing-mapping-needs-review"]});continue}
    evidences.push({productId:product.id,name:candidate.name,gtin:candidate.gtin,packAmount:candidate.packParsed.amount,packUnit:candidate.packParsed.unit,proof:candidate.sourceUrl});
    accepted.push({productId:product.id,gtin:product.gtin,name:product.name,brand:product.brand||null,pack:displayPack(product),packAmount:product.packAmount,packUnit:product.packUnit,packCount:product.packCount,externalProductId:candidate.externalProductId,sourceId:SOURCE,created:insertedIds.has(product.id),purpose:"identity",truthEligible:false,proofVerified:false,sourceUrl:candidate.sourceUrl,fetchedAt:options.fetchedAt||null});
   }
   const evidence=await client.query(`INSERT INTO product_identity_evidence(product_id,raw_name,source,gtin,pack_amount,pack_unit,match_score,match_level,proof)
    SELECT x."productId",x.name,$2,x.gtin,x."packAmount",x."packUnit",1,'exact',x.proof
    FROM jsonb_to_recordset($1::jsonb) AS x("productId" uuid,name text,gtin text,"packAmount" numeric,"packUnit" text,proof text)
    WHERE NOT EXISTS(SELECT 1 FROM product_identity_evidence e WHERE e.product_id=x."productId" AND e.raw_name=x.name AND e.source=$2 AND e.gtin=x.gtin AND e.proof=x.proof)
    RETURNING id`,[JSON.stringify(evidences),SOURCE]);evidenceCreated=evidence.rowCount||0;
  }
  await client.query("COMMIT");return{accepted,rejected,created,mappingsCreated,evidenceCreated};
 }catch(error){try{await client.query("ROLLBACK")}catch{}throw error}
 finally{client.release()}
}
async function importBatch(pool,rawProducts,options={}){
 if(!pool||typeof pool.connect!=="function")throw new Error("catalog-transaction-pool-required");
 if(options.sourceId&&options.sourceId!==SOURCE)throw new Error("catalog-source-not-supported");
 const rows=Array.isArray(rawProducts)?rawProducts:Array.isArray(rawProducts?.products)?rawProducts.products:[];
 const limit=Number.isSafeInteger(options.limit)&&options.limit>0?Math.min(10000,options.limit):1000;
 const rejected=[],duplicates=[],candidates=new Map(),conflicting=new Set();
 for(const raw of rows.slice(0,limit)){
  const candidate=productCandidate(raw);
  if(!candidate.ok){rejected.push({raw,reasons:candidate.reasons});continue}
  if(conflicting.has(candidate.gtin)){rejected.push({raw,reasons:["catalog-conflicting-duplicate-gtin"]});continue}
  const previous=candidates.get(candidate.gtin);
  if(previous){
   if(!packCompatible(productRecord(previous),candidate)){candidates.delete(candidate.gtin);conflicting.add(candidate.gtin);rejected.push({raw:previous.raw,reasons:["catalog-conflicting-duplicate-gtin"]},{raw,reasons:["catalog-conflicting-duplicate-gtin"]})}
   else duplicates.push({gtin:candidate.gtin,raw});
  }else candidates.set(candidate.gtin,candidate);
 }
 const ordered=[...candidates.values()].sort((a,b)=>a.gtin.localeCompare(b.gtin)),accepted=[];let created=0,mappingsCreated=0,evidenceCreated=0;
 for(let offset=0;offset<ordered.length;offset+=CHUNK_SIZE){const result=await importChunk(pool,ordered.slice(offset,offset+CHUNK_SIZE),options);accepted.push(...result.accepted);rejected.push(...result.rejected);created+=result.created;mappingsCreated+=result.mappingsCreated;evidenceCreated+=result.evidenceCreated}
 return{accepted,rejected,duplicates,counts:{received:rows.length,processed:Math.min(rows.length,limit),accepted:accepted.length,created,reused:accepted.filter(p=>!p.created).length,mappingsCreated,evidenceCreated,rejected:rejected.length,duplicates:duplicates.length,truncated:rows.length>limit},sourceId:SOURCE,sourceUrl:options.sourceUrl||ATTRIBUTION.url,fetchedAt:options.fetchedAt||null,attribution:ATTRIBUTION,purpose:"identity",truthEligible:false};
}
module.exports={SOURCE,CHUNK_SIZE,ATTRIBUTION,productCandidate,importBatch,prepare:importBatch};
