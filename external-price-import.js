"use strict";
const crypto=require("crypto");
const ExternalStore=require("./external-store-matcher");
const ProductIdentity=require("./product-identity");
const AliasStore=require("./product-alias-store");
const StoreAliasStore=require("./store-alias-store");
const StoreUniverse=require("./store-universe");
const Semantics=require("./source-semantics");
function key(x){return x.gtin?"gtin:"+x.gtin:"raw:"+String(x.product||"").toLowerCase().replace(/[^a-z0-9äöüß]+/gi," ").trim()}
function date(x){const d=String(x.observedAt||"").slice(0,10);return d||new Date().toISOString().slice(0,10)}
function observation(x,batchId,meta={}){
 const source=x.source||meta.source||"external",semanticInput={...x,source,sourceType:x.sourceType||null},policy=Semantics.policy(semanticInput);
 return{
  id:crypto.randomUUID(),key:key(x),store:x.merchant||null,storeId:x.storeId||null,externalLocationId:x.externalLocationId||null,
  productId:x.productId||null,externalProductId:x.externalProductId||null,gtin:ProductIdentity.gtinValid(x.gtin)?String(x.gtin).replace(/\D/g,""):null,price:Number(x.price),per:"item",date:date(x),
  kind:"external",source,product:x.product||null,proof:x.proof||null,proofType:x.proofType||null,
  observedAt:x.observedAt||null,validFrom:x.validFrom||null,validTo:x.validTo||null,priceType:x.priceType||"regular",
  regularPrice:Number(x.regularPrice)>0?Number(x.regularPrice):null,minQuantity:Number(x.minQuantity)>1?Number(x.minQuantity):null,currency:x.currency||"EUR",trust:Number(x.registryTrust||0),status:"observed",
  sourceType:x.sourceType||policy.type||null,sourceId:x.sourceId||source,proofActor:x.proofActor||null,sourceUrl:x.sourceUrl||meta.sourceUrl||null,fetchedAt:x.fetchedAt||null,importBatchId:batchId,
  evidencePurpose:x.evidencePurpose||Semantics.primaryPurpose(semanticInput),truthEligible:x.truthEligible===false?false:policy.currentPrice,
  region:x.region||null,brand:x.brand||null,pack:x.pack||x.packageSize||null,proofHash:x.proofHash||null,
  packAmount:Number.isFinite(Number(x.packAmount))&&Number(x.packAmount)>0?Number(x.packAmount):null,packUnit:x.packUnit||null
 };
}
const COLUMNS=["id","key","store","store_id","external_location_id","product_id","external_product_id","gtin","price","per","date","kind","source","product","proof","proof_type","observed_at","valid_from","valid_to","price_type","regular_price","min_quantity","currency","trust","status","source_type","source_id","proof_actor","source_url","fetched_at","import_batch_id","evidence_purpose","truth_eligible","region","brand","pack","proof_hash","pack_amount","pack_unit"];
function insertSpec(o){const values=[o.id,o.key,o.store,o.storeId,o.externalLocationId,o.productId,o.externalProductId,o.gtin,o.price,o.per,o.date,o.kind,o.source,o.product,o.proof,o.proofType,o.observedAt,o.validFrom,o.validTo,o.priceType,o.regularPrice,o.minQuantity,o.currency,o.trust,o.status,o.sourceType,o.sourceId,o.proofActor,o.sourceUrl,o.fetchedAt,o.importBatchId,o.evidencePurpose,o.truthEligible,o.region,o.brand,o.pack,o.proofHash,o.packAmount,o.packUnit];const placeholders=values.map((_,i)=>"$"+(i+1)).join(",");return{sql:"INSERT INTO price_observations("+COLUMNS.join(",")+") VALUES("+placeholders+") ON CONFLICT DO NOTHING",values}}
async function persist(pool,providerResult,meta={}){
 const source=meta.source||"external",url=meta.sourceUrl||null,received=(providerResult.accepted?.length||0)+(providerResult.rejected?.length||0);
 const b=(await pool.query("INSERT INTO price_import_batches(source,source_url,received,status) VALUES($1,$2,$3,'running') RETURNING id",[source,url,received])).rows[0];
 let accepted=0,rejected=0,duplicates=0;
 for(const r of providerResult.rejected||[]){await pool.query("INSERT INTO price_import_quarantine(batch_id,source,raw_payload,reason) VALUES($1,$2,$3::jsonb,$4)",[b.id,source,JSON.stringify(r.raw||{}),(r.reasons||["provider-rejected"]).join(",")]);rejected++}
 for(const raw of providerResult.accepted||[]){let x=raw;try{
  if(x.externalProductId){let pm=(await pool.query('SELECT product_id AS "productId",status,confidence::float FROM external_product_mappings WHERE source_id=$1 AND external_product_id=$2',[x.sourceId,x.externalProductId])).rows[0];if(pm&&pm.status==="verified")x={...x,productId:pm.productId};else if(x.gtin){const cp=(await pool.query("SELECT id FROM products WHERE gtin=$1 LIMIT 2",[x.gtin])).rows;if(cp.length===1){x={...x,productId:cp[0].id};await pool.query("INSERT INTO external_product_mappings(source_id,external_product_id,product_id,status,confidence,match_reason,verified_at) VALUES($1,$2,$3,'verified',1,'gtin',now()) ON CONFLICT(source_id,external_product_id) DO NOTHING",[x.sourceId,x.externalProductId,cp[0].id])}}}
  if(x.productId&&x.product)await AliasStore.observe(pool,{productId:x.productId,alias:x.product,sourceId:x.sourceId||source,confidence:x.gtin?1:.92});
  if(x.externalLocationId){const sm=(await pool.query('SELECT store_id AS "storeId",status,confidence::float,match_reason AS "reason" FROM external_store_mappings WHERE source_id=$1 AND external_location_id=$2',[x.sourceId,x.externalLocationId])).rows[0];if(sm&&sm.status==="verified"){x=ExternalStore.apply(x,{state:"verified",storeId:sm.storeId,confidence:sm.confidence,reason:sm.reason});await StoreAliasStore.observe(pool,{storeId:sm.storeId,alias:x.merchant+(x.address?" "+x.address:""),sourceId:x.sourceId||source,externalLocationId:x.externalLocationId,confidence:sm.confidence});await StoreUniverse.link(pool,{storeId:sm.storeId,sourceId:x.sourceId||source,externalLocationId:x.externalLocationId,confidence:sm.confidence,status:"verified"})}}
  const spec=insertSpec(observation(x,b.id,{source,sourceUrl:url})),q=await pool.query(spec.sql,spec.values);if(q.rowCount)accepted++;else duplicates++;
 }catch(e){await pool.query("INSERT INTO price_import_quarantine(batch_id,source,raw_payload,reason) VALUES($1,$2,$3::jsonb,$4)",[b.id,source,JSON.stringify(x||raw),String(e.message||"persist-error").slice(0,500)]);rejected++}}
 await pool.query("UPDATE price_import_batches SET finished_at=now(),status='finished',accepted=$2,rejected=$3,duplicate_count=$4 WHERE id=$1",[b.id,accepted,rejected,duplicates]);
 return{batchId:b.id,received,accepted,rejected,duplicates};
}
module.exports={key,date,observation,insertSpec,persist};
