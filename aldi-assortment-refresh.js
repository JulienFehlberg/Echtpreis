"use strict";
const Client=require("./aldi-assortment-client"),Published=require("./aldi-assortment-price-service");
const SOURCE=Client.SOURCE,TABLE="aldi_assortment_catalog_state",REFRESH_MS=15*60*1000,CONTINUATION_MS=60*1000;
let running=false;
const failure=(code,extra={})=>Object.assign(new Error(code),{code,...extra});
const hash=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
const GAP_WAIT_MS=60*60*1000,GAP_CODES=new Set(["aldi-native-source-unavailable","aldi-product-page-schema-invalid","aldi-native-request-identity-conflict","aldi-native-product-identity-conflict","aldi-native-product-name-required","aldi-exact-sales-pack-required","aldi-drained-weight-unresolved","aldi-product-variant-unresolved"]);
const object=value=>!!value&&typeof value==="object"&&!Array.isArray(value);
const iso=value=>typeof value==="string"&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value;
const invalid=()=>{throw failure("aldi-catalog-progress-unconfirmed");};
const sameTarget=(a,b)=>a?.retailerSku===b?.retailerSku&&a?.sourceUrl===b?.sourceUrl;
const gapFields=["retailerSku","sourceUrl","code","attempts","capturedAt","sourceResponseHash","sourceResponseDate","sourceAgeSeconds","retryAfter"];
const sameGap=(a,b)=>gapFields.every(key=>a?.[key]===b?.[key]);
function sourceProof(proof,{current=false,start=0,time=Date.now(),missing=false}={}){
 if(!object(proof)||!iso(proof.capturedAt)||Date.parse(proof.capturedAt)>time||current&&Date.parse(proof.capturedAt)<start)invalid();
 if(missing){if(proof.sourceResponseHash!==null||proof.sourceResponseDate!==null||proof.sourceAgeSeconds!==null)invalid();return;}
 if(!hash(proof.sourceResponseHash)||!iso(proof.sourceResponseDate)||!Object.hasOwn(proof,"sourceAgeSeconds"))invalid();
 try{if(Client.responseFreshness(proof,5*60*1000)!==proof.sourceResponseDate)invalid();}catch{invalid();}
}
function gapProof(gap,options){
 if(!object(gap)||!GAP_CODES.has(gap.code)||!Number.isSafeInteger(gap.attempts)||gap.attempts<1||!Number.isSafeInteger(gap.attempts+1)||!iso(gap.retryAfter)||Date.parse(gap.retryAfter)!==Date.parse(gap.capturedAt)+GAP_WAIT_MS)invalid();
 let target;try{target=Client.targetForUrl(gap.sourceUrl);}catch{invalid();}if(!sameTarget(gap,target))invalid();
 sourceProof(gap,options);return gap;
}
function gapsFrom(cursor,{targetCount=null,targets=null,time=Date.now()}={}){
 if(!object(cursor)||!hash(cursor.snapshotHash)||!count(cursor.nextIndex)||targetCount!==null&&cursor.nextIndex>targetCount||cursor.nextIndex===0&&cursor.lastSku!==null||cursor.nextIndex>0&&(typeof cursor.lastSku!=="string"||!/^[1-9]\d{0,14}$/.test(cursor.lastSku)))invalid();
 if(targets&&cursor.lastSku!==(cursor.nextIndex?targets[cursor.nextIndex-1]?.retailerSku:null))invalid();
 const gaps=cursor.unresolvedTargets===undefined?[]:cursor.unresolvedTargets;if(!Array.isArray(gaps)||gaps.length>cursor.nextIndex)invalid();
 const seen=new Set(),prefix=targets&&new Map(targets.slice(0,cursor.nextIndex).map(t=>[t.retailerSku,t]));
 for(const gap of gaps){gapProof(gap,{time});if(seen.has(gap.retailerSku)||prefix&&!sameTarget(gap,prefix.get(gap.retailerSku)))invalid();seen.add(gap.retailerSku);}
 return gaps;
}
function confirmedDiscovery(discovery){
 if(!discovery||!Array.isArray(discovery.targets)||!discovery.targets.length||!hash(discovery.snapshotHash)||discovery.requests!==1)throw failure("aldi-catalog-discovery-unconfirmed");
 let native;try{native=Client.stableTargets(discovery.targets);}catch{throw failure("aldi-catalog-discovery-unconfirmed");}
 if(native.rejected.length||native.snapshotHash!==discovery.snapshotHash||native.targets.length!==discovery.targets.length||native.targets.some((target,index)=>!sameTarget(target,discovery.targets[index])))throw failure("aldi-catalog-discovery-unconfirmed");
 return native.targets;
}
function budget(value){const n=Math.floor(Number(value));return Number.isFinite(n)&&n>0?Math.max(2,Math.min(32,n)):16;}
function retryTime(error,time){const native=Number(error?.retryAfterMs),delay=Math.max(REFRESH_MS,Number.isFinite(native)&&native>0?native:60*60*1000);return new Date(time+delay).toISOString();}
async function ensure(pool){
 if(!pool)throw failure("database-required");
 await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(source_id text PRIMARY KEY,target_count int NOT NULL DEFAULT 0 CHECK(target_count>=0),processed_cumulative int NOT NULL DEFAULT 0 CHECK(processed_cumulative>=0),next_index int NOT NULL DEFAULT 0 CHECK(next_index>=0),cursor jsonb,last_completed_at timestamptz,completed_cycles int NOT NULL DEFAULT 0 CHECK(completed_cycles>=0),snapshot_hash text,last_error text,retry_after timestamptz,updated_at timestamptz NOT NULL DEFAULT now());`);
}
async function load(pool){await ensure(pool);return(await pool.query(`SELECT cursor,target_count AS "targetCount",processed_cumulative AS "processedCumulative",next_index AS "nextIndex",last_completed_at AS "lastCompletedAt",completed_cycles AS "completedCycles",snapshot_hash AS "snapshotHash",last_error AS "lastError",retry_after AS "retryAfter",updated_at AS "updatedAt" FROM ${TABLE} WHERE source_id=$1`,[SOURCE])).rows[0]||{};}
function progress(discovery,collected,state,totalBudget,runStartedAt,time){
 const targets=confirmedDiscovery(discovery),targetCount=targets.length,changed=!!state.cursor&&state.cursor.snapshotHash!==discovery.snapshotHash;
 if(!collected||!Array.isArray(collected.offers)||!Array.isArray(collected.products)||!Array.isArray(collected.rejected)||!Array.isArray(collected.confirmedTargets)||!Array.isArray(collected.unresolvedTargets)||typeof collected.complete!=="boolean"||collected.targetCount!==targetCount||collected.snapshotHash!==discovery.snapshotHash||!count(collected.processed)||!count(collected.requests)||discovery.requests+collected.requests>totalBudget||collected.processed>collected.requests||!count(collected.bytes)||!count(collected.nextIndex)||!count(collected.gapAttempts)||collected.confirmedTargets.length!==collected.processed)invalid();
 if(changed&&collected.cursorReset!==true||!changed&&collected.cursorReset===true)throw failure("aldi-catalog-snapshot-reset-unconfirmed");
 let previous=[];if(state.cursor){previous=gapsFrom(state.cursor,{targetCount:changed?(state.targetCount??null):targetCount,targets:changed?null:targets,time});if(state.nextIndex!==undefined&&state.nextIndex!==state.cursor.nextIndex||state.processedCumulative!==undefined&&state.processedCumulative!==state.cursor.nextIndex-previous.length)invalid();}
 const start=changed||!state.cursor?0:state.cursor.nextIndex,oldGaps=new Map((changed?[]:previous).map(g=>[g.retailerSku,g]));
 const nextIndex=collected.nextIndex;if(nextIndex<start||nextIndex>targetCount)invalid();
 const frontier=new Map(targets.slice(start,nextIndex).map(t=>[t.retailerSku,t])),prefix=new Map(targets.slice(0,nextIndex).map(t=>[t.retailerSku,t])),confirmed=new Map(),newGaps=new Map();
 for(const proof of collected.confirmedTargets){if(!sameTarget(proof,prefix.get(proof?.retailerSku))||confirmed.has(proof.retailerSku)||!frontier.has(proof.retailerSku)&&!oldGaps.has(proof.retailerSku)||![200,404,410].includes(proof.status)||!(proof.status===200?["detail","rejected"].includes(proof.kind):proof.kind==="missing"))invalid();sourceProof(proof,{current:true,start:runStartedAt,time,missing:proof.kind==="missing"});if(oldGaps.has(proof.retailerSku)&&(proof.kind==="rejected"||Date.parse(proof.capturedAt)<Date.parse(oldGaps.get(proof.retailerSku).retryAfter)))invalid();confirmed.set(proof.retailerSku,proof);}
 let created=0,retried=0;
 for(const gap of collected.unresolvedTargets){gapProof(gap,{time});if(!sameTarget(gap,prefix.get(gap.retailerSku))||newGaps.has(gap.retailerSku)||confirmed.has(gap.retailerSku))invalid();const old=oldGaps.get(gap.retailerSku);if(old){if(!sameGap(old,gap)){if(gap.attempts!==old.attempts+1||Date.parse(gap.capturedAt)<Date.parse(old.retryAfter))invalid();sourceProof(gap,{current:true,start:runStartedAt,time});retried++;}}else{if(!frontier.has(gap.retailerSku)||gap.code!=="aldi-native-source-unavailable"||gap.attempts!==1)invalid();sourceProof(gap,{current:true,start:runStartedAt,time});created++;}newGaps.set(gap.retailerSku,gap);}
 for(const target of frontier.values())if(!confirmed.has(target.retailerSku)&&!newGaps.has(target.retailerSku))invalid();
 for(const old of oldGaps.values())if(!newGaps.has(old.retailerSku)){if(!confirmed.has(old.retailerSku))invalid();retried++;}
 const partial=collected.partialError;let failedNew=0;
 if(partial){if(!object(partial)||typeof partial.code!=="string"||!partial.code.startsWith("aldi-")||GAP_CODES.has(partial.code)||typeof partial.requestStarted!=="boolean"||typeof partial.retryingGap!=="boolean")invalid();const target=partial.retryingGap?oldGaps.get(partial.retailerSku):targets[nextIndex];if(!sameTarget(partial,target))invalid();if(partial.retryingGap){if(!sameGap(target,newGaps.get(partial.retailerSku))||confirmed.has(partial.retailerSku)||Date.parse(target.retryAfter)>time)invalid();if(partial.requestStarted)retried++;}else if(partial.requestStarted)failedNew=1;}
 const processedCumulative=nextIndex-newGaps.size;
 if(processedCumulative-(start-oldGaps.size)!==collected.processed||collected.gapAttempts!==created+retried||collected.requests!==nextIndex-start+retried+failedNew)invalid();
 const complete=nextIndex===targetCount&&newGaps.size===0;
 if(collected.complete!==complete||complete&&partial)invalid();
 if(complete){if(collected.cursor!=null)invalid();}
 else{const resultGaps=gapsFrom(collected.cursor,{targetCount,targets,time});if(collected.cursor.snapshotHash!==discovery.snapshotHash||collected.cursor.nextIndex!==nextIndex||resultGaps.length!==newGaps.size||resultGaps.some(g=>!sameGap(g,newGaps.get(g.retailerSku))))invalid();}
 const retryTimes=collected.unresolvedTargets.map(g=>Date.parse(g.retryAfter)),earliest=retryTimes.length?Math.min(...retryTimes):null,deferredUntil=nextIndex===targetCount&&earliest!==null&&earliest>time?new Date(earliest).toISOString():null;
 // A legitimate client deferral may become due between its final clock read and this validation.
 const boundaryDeferral=nextIndex===targetCount&&earliest!==null&&earliest>runStartedAt&&earliest<=time&&collected.deferredUntil===new Date(earliest).toISOString();
 if(collected.deferredUntil!==deferredUntil&&!boundaryDeferral||collected.requests===0&&(start!==targetCount||!newGaps.size||!collected.deferredUntil||partial||collected.processed!==0)||collected.requests===0&&collected.bytes!==0)invalid();
 const productSkus=new Set();for(const product of collected.products){const proof=confirmed.get(product?.retailerSku);if(!proof||proof.kind!=="detail"||!sameTarget(product,proof)||productSkus.has(product.retailerSku)||product.observedAt!==proof.capturedAt||product.sourceResponseHash!==proof.sourceResponseHash||product.sourceResponseDate!==proof.sourceResponseDate||product.sourceAgeSeconds!==proof.sourceAgeSeconds)invalid();productSkus.add(product.retailerSku);}
 for(const proof of confirmed.values())if(proof.kind==="detail"&&!productSkus.has(proof.retailerSku))invalid();
 const offerSkus=new Set();for(const offer of collected.offers){const proof=confirmed.get(offer?.retailerSku);if(!proof||!productSkus.has(offer.retailerSku)||!sameTarget(offer,proof)||offerSkus.has(offer.retailerSku)||offer.capturedAt!==proof.capturedAt||offer.sourceResponseHash!==proof.sourceResponseHash||offer.sourceResponseDate!==proof.sourceResponseDate||offer.sourceAgeSeconds!==proof.sourceAgeSeconds)invalid();offerSkus.add(offer.retailerSku);}
 return{targetCount,nextIndex,processedCumulative,cursorReset:changed,unresolvedCount:newGaps.size,scannedCount:nextIndex,deferredUntil};
}
async function refresh({pool,maxRequests=16,now=Date.now}={},deps={}){
 if(!pool)throw failure("database-required");if(running)return{received:0,accepted:0,skipped:"already-running"};running=true;
 try{
  const state=await load(pool),time=now(),limit=budget(maxRequests);
  if(state.retryAfter&&time<new Date(state.retryAfter).getTime())return{received:0,accepted:0,skipped:"source-cooldown",retryAfter:state.retryAfter,nextAttemptAt:new Date(state.retryAfter).toISOString()};
  let discovery,collected,verified;
  try{
   discovery=await(deps.discoverTargets||Client.discoverTargets)({maxRequests:1,now:()=>new Date(now()).toISOString()});
   confirmedDiscovery(discovery);
   collected=await(deps.fetchProducts||Client.fetchProducts)(discovery.targets,{cursor:state.cursor||null,maxRequests:limit-1,now:()=>new Date(now()).toISOString()});
   verified=progress(discovery,collected,state,limit,time,now());
  }catch(error){
   const code=String(error.code||error.message||error).slice(0,300),nextAttemptAt=retryTime(error,time);
   await pool.query(`INSERT INTO ${TABLE}(source_id,last_error,retry_after,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(source_id) DO UPDATE SET last_error=EXCLUDED.last_error,retry_after=EXCLUDED.retry_after,updated_at=EXCLUDED.updated_at`,[SOURCE,code,nextAttemptAt,new Date(time).toISOString()]);
   throw Object.assign(error instanceof Error?error:failure(code),{nextAttemptAt});
  }
  const saved=await(deps.persist||Published.persist)(pool,collected.offers,{now:now()});
  const partial=collected.partialError,complete=collected.complete&&!partial,checkpointAt=now(),nextAttemptAt=partial?retryTime(partial,checkpointAt):complete?null:verified.deferredUntil||new Date(checkpointAt+CONTINUATION_MS).toISOString();
  // Confirmed native pages advance only after their valid price evidence has been saved.
  // A page without a current price remains scanned without becoming a priced product.
  await pool.query(`INSERT INTO ${TABLE}(source_id,cursor,last_completed_at,completed_cycles,target_count,next_index,processed_cumulative,snapshot_hash,last_error,retry_after,updated_at) VALUES($1,$2::jsonb,CASE WHEN $3 THEN $4::timestamptz ELSE NULL END,CASE WHEN $3 THEN 1 ELSE 0 END,$5,$6,$7,$8,$9,$10,$4) ON CONFLICT(source_id) DO UPDATE SET cursor=EXCLUDED.cursor,last_completed_at=CASE WHEN $3 THEN EXCLUDED.last_completed_at ELSE ${TABLE}.last_completed_at END,completed_cycles=${TABLE}.completed_cycles+CASE WHEN $3 THEN 1 ELSE 0 END,target_count=EXCLUDED.target_count,next_index=EXCLUDED.next_index,processed_cumulative=EXCLUDED.processed_cumulative,snapshot_hash=EXCLUDED.snapshot_hash,last_error=EXCLUDED.last_error,retry_after=EXCLUDED.retry_after,updated_at=EXCLUDED.updated_at`,[SOURCE,JSON.stringify(complete?null:collected.cursor),complete,new Date(checkpointAt).toISOString(),verified.targetCount,verified.nextIndex,verified.processedCumulative,discovery.snapshotHash,partial?.code?.slice(0,300)||null,partial?nextAttemptAt:null]);
  const result={...saved,sourceId:SOURCE,sourceRejected:collected.rejected.length,identityOnlyProducts:collected.products.length-collected.offers.length,processed:collected.processed,gapAttempts:collected.gapAttempts,requests:discovery.requests+collected.requests,bytes:(Number(discovery.bytes)||0)+collected.bytes,nextAttemptAt,deferredUntil:verified.deferredUntil,cursorReset:verified.cursorReset,catalog:{publishedAssortmentComplete:complete,physicalStoreAssortmentVerified:false,targetCount:verified.targetCount,nextIndex:verified.nextIndex,scannedCount:verified.scannedCount,unresolvedCount:verified.unresolvedCount,processedCumulative:verified.processedCumulative,snapshotHash:discovery.snapshotHash,nextCursor:complete?null:collected.cursor},scope:{country:"DE",channel:"assortment-publication",location:"unknown"},independentOfUserReceipts:true};
  if(partial)throw failure(partial.code,{status:partial.status||null,retryAfterMs:partial.retryAfterMs??null,nextAttemptAt,partialResult:result,received:result.received??collected.offers.length,accepted:result.accepted??0,checkpointSaved:true});
  return result;
 }finally{running=false;}
}
async function resumeAt(pool,now=Date.now()){
 const state=await load(pool),retry=state.retryAfter?new Date(state.retryAfter).getTime():NaN;
 if(Number.isFinite(retry))return new Date(Math.max(retry,now)).toISOString();
 const updated=state.updatedAt?new Date(state.updatedAt).getTime():NaN;
 if(state.cursor&&!state.lastError&&state.cursor.nextIndex===state.targetCount){try{const gaps=gapsFrom(state.cursor,{targetCount:state.targetCount,time:now});if(gaps.length)return new Date(Math.max(Math.min(...gaps.map(g=>Date.parse(g.retryAfter))),now)).toISOString();}catch{return null;}}
 return state.cursor&&!state.lastError&&Number.isFinite(updated)?new Date(updated+CONTINUATION_MS).toISOString():null;
}
async function status(pool){const state=await load(pool),unresolvedCount=Array.isArray(state.cursor?.unresolvedTargets)?state.cursor.unresolvedTargets.length:0;return{sourceId:SOURCE,...state,scannedCount:count(state.nextIndex)?state.nextIndex:0,unresolvedCount,publishedAssortmentComplete:!state.cursor&&!unresolvedCount&&!!state.lastCompletedAt&&!state.lastError&&state.targetCount>0&&state.nextIndex===state.targetCount&&state.processedCumulative===state.targetCount,physicalStoreAssortmentVerified:false,normalPriceClassificationVerified:false,independentOfUserReceipts:true,refreshIntervalMinutes:15,continuationIntervalMinutes:1,scopeCountry:"DE",scopeChannel:"assortment-publication",locationScope:"unknown"};}
module.exports={SOURCE,TABLE,REFRESH_MS,CONTINUATION_MS,ensure,load,refresh,status,resumeAt};
