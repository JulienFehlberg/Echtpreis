"use strict";
const Client=require("./aldi-assortment-client"),Published=require("./aldi-assortment-price-service");
const SOURCE=Client.SOURCE,TABLE="aldi_assortment_catalog_state",REFRESH_MS=15*60*1000,CONTINUATION_MS=60*1000;
let running=false;
const failure=(code,extra={})=>Object.assign(new Error(code),{code,...extra});
const hash=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
function budget(value){const n=Math.floor(Number(value));return Number.isFinite(n)&&n>0?Math.max(2,Math.min(32,n)):16;}
function retryTime(error,time){const native=Number(error?.retryAfterMs),delay=Math.max(REFRESH_MS,Number.isFinite(native)&&native>0?native:60*60*1000);return new Date(time+delay).toISOString();}
async function ensure(pool){
 if(!pool)throw failure("database-required");
 await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(source_id text PRIMARY KEY,target_count int NOT NULL DEFAULT 0 CHECK(target_count>=0),processed_cumulative int NOT NULL DEFAULT 0 CHECK(processed_cumulative>=0),next_index int NOT NULL DEFAULT 0 CHECK(next_index>=0),cursor jsonb,last_completed_at timestamptz,completed_cycles int NOT NULL DEFAULT 0 CHECK(completed_cycles>=0),snapshot_hash text,last_error text,retry_after timestamptz,updated_at timestamptz NOT NULL DEFAULT now());`);
}
async function load(pool){await ensure(pool);return(await pool.query(`SELECT cursor,target_count AS "targetCount",processed_cumulative AS "processedCumulative",next_index AS "nextIndex",last_completed_at AS "lastCompletedAt",completed_cycles AS "completedCycles",snapshot_hash AS "snapshotHash",last_error AS "lastError",retry_after AS "retryAfter",updated_at AS "updatedAt" FROM ${TABLE} WHERE source_id=$1`,[SOURCE])).rows[0]||{};}
function progress(discovery,collected,state,totalBudget){
 if(!discovery||!Array.isArray(discovery.targets)||!discovery.targets.length||!hash(discovery.snapshotHash)||discovery.requests!==1)throw failure("aldi-catalog-discovery-unconfirmed");
 const targetCount=discovery.targets.length,changed=!!state.cursor&&state.cursor.snapshotHash!==discovery.snapshotHash;
 if(!collected||!Array.isArray(collected.offers)||!Array.isArray(collected.products)||!Array.isArray(collected.rejected)||typeof collected.complete!=="boolean"||collected.targetCount!==targetCount||collected.snapshotHash!==discovery.snapshotHash||!count(collected.processed)||!count(collected.requests)||collected.requests<1||discovery.requests+collected.requests>totalBudget||collected.processed>collected.requests||!count(collected.bytes))throw failure("aldi-catalog-progress-unconfirmed");
 if(changed&&collected.cursorReset!==true||!changed&&collected.cursorReset===true)throw failure("aldi-catalog-snapshot-reset-unconfirmed");
 const start=changed||!state.cursor?0:state.cursor.nextIndex;
 if(!count(start)||start>targetCount||state.cursor&&!changed&&(state.nextIndex!==undefined&&state.nextIndex!==start||state.processedCumulative!==undefined&&state.processedCumulative!==start))throw failure("aldi-catalog-progress-unconfirmed");
 const nextIndex=start+collected.processed;
 if(collected.processed===0)throw failure("aldi-catalog-progress-stalled");
 if(nextIndex>targetCount||collected.complete!==(nextIndex===targetCount))throw failure("aldi-catalog-progress-unconfirmed");
 if(collected.complete){if(collected.cursor!=null||collected.partialError)throw failure("aldi-catalog-progress-unconfirmed");}
 else{const cursor=collected.cursor;if(!cursor||typeof cursor!=="object"||Array.isArray(cursor)||cursor.snapshotHash!==discovery.snapshotHash||cursor.nextIndex!==nextIndex||cursor.lastSku!==discovery.targets[nextIndex-1]?.retailerSku)throw failure("aldi-catalog-progress-unconfirmed");}
 if(collected.partialError&&(!collected.partialError.code||typeof collected.partialError.code!=="string"))throw failure("aldi-catalog-progress-unconfirmed");
 return{targetCount,nextIndex,processedCumulative:nextIndex,cursorReset:changed};
}
async function refresh({pool,maxRequests=16,now=Date.now}={},deps={}){
 if(!pool)throw failure("database-required");if(running)return{received:0,accepted:0,skipped:"already-running"};running=true;
 try{
  const state=await load(pool),time=now(),limit=budget(maxRequests);
  if(state.retryAfter&&time<new Date(state.retryAfter).getTime())return{received:0,accepted:0,skipped:"source-cooldown",retryAfter:state.retryAfter,nextAttemptAt:new Date(state.retryAfter).toISOString()};
  let discovery,collected,verified;
  try{
   discovery=await(deps.discoverTargets||Client.discoverTargets)({maxRequests:1,now:()=>new Date(now()).toISOString()});
   if(!discovery||!Array.isArray(discovery.targets)||!discovery.targets.length||!hash(discovery.snapshotHash)||discovery.requests!==1)throw failure("aldi-catalog-discovery-unconfirmed");
   collected=await(deps.fetchProducts||Client.fetchProducts)(discovery.targets,{cursor:state.cursor||null,maxRequests:limit-1,now:()=>new Date(now()).toISOString()});
   verified=progress(discovery,collected,state,limit);
  }catch(error){
   const code=String(error.code||error.message||error).slice(0,300),nextAttemptAt=retryTime(error,time);
   await pool.query(`INSERT INTO ${TABLE}(source_id,last_error,retry_after,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(source_id) DO UPDATE SET last_error=EXCLUDED.last_error,retry_after=EXCLUDED.retry_after,updated_at=EXCLUDED.updated_at`,[SOURCE,code,nextAttemptAt,new Date(time).toISOString()]);
   throw Object.assign(error instanceof Error?error:failure(code),{nextAttemptAt});
  }
  const saved=await(deps.persist||Published.persist)(pool,collected.offers,{now:now()});
  const partial=collected.partialError,complete=collected.complete&&!partial,checkpointAt=now(),nextAttemptAt=partial?retryTime(partial,checkpointAt):complete?null:new Date(checkpointAt+CONTINUATION_MS).toISOString();
  // Confirmed native pages advance only after their valid price evidence has been saved.
  // A page without a current price remains scanned without becoming a priced product.
  await pool.query(`INSERT INTO ${TABLE}(source_id,cursor,last_completed_at,completed_cycles,target_count,next_index,processed_cumulative,snapshot_hash,last_error,retry_after,updated_at) VALUES($1,$2::jsonb,CASE WHEN $3 THEN $4::timestamptz ELSE NULL END,CASE WHEN $3 THEN 1 ELSE 0 END,$5,$6,$7,$8,$9,$10,$4) ON CONFLICT(source_id) DO UPDATE SET cursor=EXCLUDED.cursor,last_completed_at=CASE WHEN $3 THEN EXCLUDED.last_completed_at ELSE ${TABLE}.last_completed_at END,completed_cycles=${TABLE}.completed_cycles+CASE WHEN $3 THEN 1 ELSE 0 END,target_count=EXCLUDED.target_count,next_index=EXCLUDED.next_index,processed_cumulative=EXCLUDED.processed_cumulative,snapshot_hash=EXCLUDED.snapshot_hash,last_error=EXCLUDED.last_error,retry_after=EXCLUDED.retry_after,updated_at=EXCLUDED.updated_at`,[SOURCE,JSON.stringify(complete?null:collected.cursor),complete,new Date(checkpointAt).toISOString(),verified.targetCount,verified.nextIndex,verified.processedCumulative,discovery.snapshotHash,partial?.code?.slice(0,300)||null,partial?nextAttemptAt:null]);
  const result={...saved,sourceId:SOURCE,sourceRejected:collected.rejected.length,identityOnlyProducts:collected.products.length-collected.offers.length,processed:collected.processed,requests:discovery.requests+collected.requests,bytes:(Number(discovery.bytes)||0)+collected.bytes,nextAttemptAt,cursorReset:verified.cursorReset,catalog:{publishedAssortmentComplete:complete,physicalStoreAssortmentVerified:false,targetCount:verified.targetCount,nextIndex:verified.nextIndex,processedCumulative:verified.processedCumulative,snapshotHash:discovery.snapshotHash,nextCursor:complete?null:collected.cursor},scope:{country:"DE",channel:"assortment-publication",location:"unknown"},independentOfUserReceipts:true};
  if(partial)throw failure(partial.code,{status:partial.status||null,retryAfterMs:partial.retryAfterMs??null,nextAttemptAt,partialResult:result,received:result.received??collected.offers.length,accepted:result.accepted??0,checkpointSaved:true});
  return result;
 }finally{running=false;}
}
async function resumeAt(pool,now=Date.now()){
 const state=await load(pool),retry=state.retryAfter?new Date(state.retryAfter).getTime():NaN;
 if(Number.isFinite(retry))return new Date(Math.max(retry,now)).toISOString();
 const updated=state.updatedAt?new Date(state.updatedAt).getTime():NaN;
 return state.cursor&&!state.lastError&&Number.isFinite(updated)?new Date(updated+CONTINUATION_MS).toISOString():null;
}
async function status(pool){const state=await load(pool);return{sourceId:SOURCE,...state,publishedAssortmentComplete:!state.cursor&&!!state.lastCompletedAt&&!state.lastError&&state.targetCount>0&&state.nextIndex===state.targetCount&&state.processedCumulative===state.targetCount,physicalStoreAssortmentVerified:false,normalPriceClassificationVerified:false,independentOfUserReceipts:true,refreshIntervalMinutes:15,continuationIntervalMinutes:1,scopeCountry:"DE",scopeChannel:"assortment-publication",locationScope:"unknown"};}
module.exports={SOURCE,TABLE,REFRESH_MS,CONTINUATION_MS,ensure,load,refresh,status,resumeAt};
