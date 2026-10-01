"use strict";
const Seed=require("./dm-discovery-seed");
const Client=require("./dm-price-client"),Published=require("./published-price-service"),Queue=require("./stable-coverage-queue"),Checkpoints=require("./refresh-checkpoint-store");
const SOURCE="dm online",DISCOVERY_MS=6*3600000;
const QUERIES=["dmBio","Milch","Haferdrink","Reis","Nudeln","Mehl","Zucker","Kaffee","Tee","Mineralwasser","Saft","Müsli","Haferflocken","Brot","Nussmus","Marmelade","Honig","Olivenöl","Sonnenblumenöl","Tomaten","Kichererbsen","Linsen","Bohnen","Gewürze","Salz","Nüsse","Schokolade","Kekse","Babynahrung","Windeln","Toilettenpapier","Taschentücher","Waschmittel","Spülmittel","Zahnpasta","Duschgel","Shampoo","Seife","Müllbeutel","Küchenrolle"];
let running=false;
async function ensure(pool){await pool.query(`CREATE TABLE IF NOT EXISTS retailer_refresh_targets(source_id text NOT NULL,retailer_sku text NOT NULL,payload jsonb NOT NULL,discovered_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(source_id,retailer_sku));CREATE TABLE IF NOT EXISTS retailer_discovery_state(source_id text PRIMARY KEY,cursor jsonb,last_completed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now());ALTER TABLE retailer_discovery_state ADD COLUMN IF NOT EXISTS last_error text;ALTER TABLE retailer_discovery_state ADD COLUMN IF NOT EXISTS retry_after timestamptz;`)}
async function refresh({pool,maxTargets=100,discoveryRequests=8,now=Date.now}={},deps={}){
 if(!pool)throw new Error("database-required");if(running)return{received:0,accepted:0,skipped:"already-running"};running=true;
 try{
  await ensure(pool);const targetCount=(await pool.query("SELECT count(*)::int AS targets FROM retailer_refresh_targets WHERE source_id=$1",[SOURCE])).rows[0].targets;
  if(!targetCount){const seed=(deps.seedTargets||Seed.read)();if(seed.length)await pool.query(`INSERT INTO retailer_refresh_targets(source_id,retailer_sku,payload) SELECT $1,x->>'retailerSku',x FROM jsonb_array_elements($2::jsonb) x ON CONFLICT DO NOTHING`,[SOURCE,JSON.stringify(seed)])}
  const state=(await pool.query('SELECT cursor,last_completed_at AS "lastCompletedAt",last_error AS "lastError",retry_after AS "retryAfter" FROM retailer_discovery_state WHERE source_id=$1',[SOURCE])).rows[0]||{};
  let discovery=null;
  if((!state.retryAfter||now()>=new Date(state.retryAfter).getTime())&&(!state.lastCompletedAt||now()-new Date(state.lastCompletedAt).getTime()>=DISCOVERY_MS)){
   try{discovery=await(deps.discoverTargets||Client.discoverTargets)({queries:QUERIES,maxProducts:10000,maxPages:40,maxRequests:Math.max(1,Math.min(40,Number(discoveryRequests)||8)),cursor:state.cursor||undefined});}catch(error){discovery={targets:[],complete:false,cursor:state.cursor||null,partialError:String(error.code||error.message||error).slice(0,300),received:0,requests:0}}
   const targets=Array.isArray(discovery.targets)?discovery.targets:[];
   if(targets.length)await pool.query(`INSERT INTO retailer_refresh_targets(source_id,retailer_sku,payload) SELECT $1,x->>'retailerSku',x FROM jsonb_array_elements($2::jsonb) x WHERE x->>'retailerSku' ~ '^[0-9]+$' ON CONFLICT(source_id,retailer_sku) DO UPDATE SET payload=EXCLUDED.payload,discovered_at=now()`,[SOURCE,JSON.stringify(targets)]);
   await pool.query(`INSERT INTO retailer_discovery_state(source_id,cursor,last_completed_at) VALUES($1,$2::jsonb,CASE WHEN $3 THEN now() ELSE NULL END) ON CONFLICT(source_id) DO UPDATE SET cursor=EXCLUDED.cursor,last_completed_at=EXCLUDED.last_completed_at,updated_at=now()`,[SOURCE,JSON.stringify(discovery.complete?null:discovery.cursor||null),discovery.complete===true]);
   await pool.query("UPDATE retailer_discovery_state SET last_error=$2,retry_after=$3 WHERE source_id=$1",[SOURCE,(typeof discovery.partialError==="object"?JSON.stringify(discovery.partialError):discovery.partialError)||null,discovery.partialError?new Date(now()+3600000).toISOString():null]);
  }
  const rows=(await pool.query("SELECT payload FROM retailer_refresh_targets WHERE source_id=$1 ORDER BY retailer_sku",[SOURCE])).rows.map(row=>({...row.payload,productCode:String(row.payload.retailerSku)}));
  if(!rows.length)throw new Error("dm-discovery-no-product-targets");
  const checkpoint=await Checkpoints.load(pool,"dm online prices"),pick=Queue.select(rows,checkpoint,Math.max(1,Math.min(100,Number(maxTargets)||100)),0);
  const collected=await(deps.fetchOffers||Client.fetchOffers)(pick.selected,{maxProducts:100,batchSize:100,maxRequests:2});
  if(collected.complete!==true)throw new Error("dm-live-offers-request-budget-incomplete");
  // A completed source response can reject a removed SKU. That attempt must still let the next SKU run.
  // Incomplete or failed requests cannot write quotes or advance the queue.
  const offers=collected.offers||collected.validatedOffers||[],saved=await(deps.persist||Published.persist)(pool,offers);
  await Checkpoints.save(pool,"dm online prices",pick.next);
  return{...saved,sourceRejected:Array.isArray(collected.rejected)?collected.rejected.length:0,sourceId:SOURCE,queuedTargets:rows.length,targets:pick.selected.length,requests:Number(collected.requests)||0,discovery:discovery?{received:discovery.received,requests:discovery.requests,complete:discovery.complete,cursor:discovery.cursor,error:discovery.partialError||null}:null,checkpoint:pick.next,scope:{country:"DE",channel:"online"},independentOfUserReceipts:true};
 }finally{running=false}
}
async function status(pool){
 if(!pool)throw new Error("database-required");await ensure(pool);
 const queue=(await pool.query("SELECT count(*)::int AS targets FROM retailer_refresh_targets WHERE source_id=$1",[SOURCE])).rows[0];
 const discovery=(await pool.query('SELECT cursor,last_completed_at AS "lastCompletedAt",last_error AS "lastError",retry_after AS "retryAfter" FROM retailer_discovery_state WHERE source_id=$1',[SOURCE])).rows[0]||null;
 const checkpoint=await Checkpoints.load(pool,"dm online prices");
 return{queuedTargets:Number(queue.targets),discovery,processedAttempts:Number(checkpoint.processedTotal),completedCycles:Number(checkpoint.cycle),cursorKey:checkpoint.cursorKey||null,independentOfUserReceipts:true};
}
module.exports={SOURCE,QUERIES,DISCOVERY_MS,ensure,refresh,status};
