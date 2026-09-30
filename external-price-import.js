"use strict";
const crypto=require("crypto");
const ExternalStore=require("./external-store-matcher");
function key(x){return x.gtin?"gtin:"+x.gtin:"raw:"+String(x.product||"").toLowerCase().replace(/[^a-z0-9äöüß]+/gi," ").trim()}
function date(x){const d=String(x.observedAt||"").slice(0,10);return d||new Date().toISOString().slice(0,10)}
async function persist(pool,providerResult,meta={}){
 const source=meta.source||"external",url=meta.sourceUrl||null,received=(providerResult.accepted?.length||0)+(providerResult.rejected?.length||0);
 const b=(await pool.query("INSERT INTO price_import_batches(source,source_url,received,status) VALUES($1,$2,$3,'running') RETURNING id",[source,url,received])).rows[0];
 let accepted=0,rejected=0,duplicates=0;
 for(const r of providerResult.rejected||[]){await pool.query("INSERT INTO price_import_quarantine(batch_id,source,raw_payload,reason) VALUES($1,$2,$3::jsonb,$4)",[b.id,source,JSON.stringify(r.raw||{}),(r.reasons||["provider-rejected"]).join(",")]);rejected++}
 for(const raw of providerResult.accepted||[]){
  let x=raw;
  try{
   if(x.externalProductId){const pm=(await pool.query('SELECT product_id AS "productId",status,confidence::float FROM external_product_mappings WHERE source_id=$1 AND external_product_id=$2',[x.sourceId,x.externalProductId])).rows[0];if(pm&&pm.status==="verified")x={...x,productId:pm.productId,productResolution:{state:"verified",confidence:pm.confidence,reason:"external-product-mapping"}}}
   if(x.externalLocationId){const sm=(await pool.query('SELECT store_id AS "storeId",status,confidence::float,match_reason AS "reason" FROM external_store_mappings WHERE source_id=$1 AND external_location_id=$2',[x.sourceId,x.externalLocationId])).rows[0];if(sm&&sm.status==="verified")x=ExternalStore.apply(x,{state:"verified",storeId:sm.storeId,confidence:sm.confidence,reason:sm.reason})}
   const vals=[crypto.randomUUID(),key(x),x.merchant||null,x.storeId||null,x.externalLocationId||null,x.productId||null,x.externalProductId||null,x.gtin||null,Number(x.price),date(x),x.source||source,x.product||null,x.proof||null,x.proofType||null,x.observedAt||null,x.validFrom||null,x.validTo||null,x.priceType||"regular",Number(x.regularPrice)>0?Number(x.regularPrice):null,x.currency||"EUR",Number(x.registryTrust||0),x.sourceType||null,x.sourceId||null,x.sourceUrl||url,x.fetchedAt||null,b.id];
   const sql="INSERT INTO price_observations(id,key,store,store_id,external_location_id,product_id,external_product_id,gtin,price,per,date,kind,source,product,proof,proof_type,observed_at,valid_from,valid_to,price_type,regular_price,currency,trust,status,source_type,source_id,source_url,fetched_at,import_batch_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'item',$10,'external',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'observed',$22,$23,$24,$25,$26) ON CONFLICT DO NOTHING";
   const q=await pool.query(sql,vals);if(q.rowCount)accepted++;else duplicates++;
  }catch(e){await pool.query("INSERT INTO price_import_quarantine(batch_id,source,raw_payload,reason) VALUES($1,$2,$3::jsonb,$4)",[b.id,source,JSON.stringify(x||raw),String(e.message||"persist-error").slice(0,500)]);rejected++}
 }
 await pool.query("UPDATE price_import_batches SET finished_at=now(),status='finished',accepted=$2,rejected=$3,duplicate_count=$4 WHERE id=$1",[b.id,accepted,rejected,duplicates]);
 return{batchId:b.id,received,accepted,rejected,duplicates};
}
module.exports={key,date,persist};
