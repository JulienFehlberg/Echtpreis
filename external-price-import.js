"use strict";
const crypto=require("crypto");
function key(x){return x.gtin?"gtin:"+x.gtin:"raw:"+String(x.product||"").toLowerCase().replace(/[^a-z0-9äöüß]+/gi," ").trim()}
function date(x){return String(x.observedAt||"").slice(0,10)||new Date().toISOString().slice(0,10)}
async function persist(pool,providerResult,meta={}){
 const source=meta.source||"external",url=meta.sourceUrl||null,received=(providerResult.accepted?.length||0)+(providerResult.rejected?.length||0);
 const b=(await pool.query("INSERT INTO price_import_batches(source,source_url,received,status) VALUES($1,$2,$3,'running') RETURNING id",[source,url,received])).rows[0];let accepted=0,rejected=0,duplicates=0;
 for(const r of providerResult.rejected||[]){await pool.query("INSERT INTO price_import_quarantine(batch_id,source,raw_payload,reason) VALUES($1,$2,$3::jsonb,$4)",[b.id,source,JSON.stringify(r.raw||{}),(r.reasons||["provider-rejected"]).join(",")]);rejected++}
 for(const x of providerResult.accepted||[]){try{const vals=[crypto.randomUUID(),key(x),x.merchant,x.storeId,x.externalLocationId,x.gtin,x.price,date(x),x.source,x.product,x.proof,x.proofType,x.observedAt,x.validFrom,x.validTo,x.priceType,x.regularPrice,x.currency,x.registryTrust,x.sourceType,x.sourceId,x.sourceUrl,x.fetchedAt,b.id];const q=await pool.query("INSERT INTO price_observations(id,key,store,store_id,external_location_id,gtin,price,per,date,kind,source,product,proof,proof_type,observed_at,valid_from,valid_to,price_type,regular_price,currency,trust,status,source_type,source_id,source_url,fetched_at,import_batch_id) VALUES($1,$2,$3,$4,$5,$6,$7,'item',$8,'external',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'observed',$20,$21,$22,$23,$24) ON CONFLICT DO NOTHING",vals);if(q.rowCount)accepted++;else duplicates++}catch(e){await pool.query("INSERT INTO price_import_quarantine(batch_id,source,raw_payload,reason) VALUES($1,$2,$3::jsonb,$4)",[b.id,source,JSON.stringify(x),String(e.message||"persist-error").slice(0,500)]);rejected++}}
 await pool.query("UPDATE price_import_batches SET finished_at=now(),status='finished',accepted=$2,rejected=$3,duplicate_count=$4 WHERE id=$1",[b.id,accepted,rejected,duplicates]);return{batchId:b.id,received,accepted,rejected,duplicates};
}
module.exports={key,date,persist};
