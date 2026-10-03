"use strict";
const Fetch=require("./aldi-category-fetch-client"),Articles=require("./aldi-category-article-service"),Timestamp=require("./price-refresh-state-store"),Rejected=require("./aldi-category-rejected-capture-store");
const SOURCE=Fetch.SOURCE,TABLE="aldi_category_catalog_state",CONTINUATION_MS=60000,REFRESH_MS=4*3600000,ERROR_WAIT_MS=3600000,MAX_REQUESTS=4;
const fail=(code,extra={})=>Object.assign(new Error(code),{code,...extra});
const iso=value=>typeof value==="string"&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const object=value=>value&&typeof value==="object"&&!Array.isArray(value);
const loadedTime=value=>value==null?null:Number.isFinite(new Date(value).getTime())?new Date(value).getTime():NaN;
let running=false;
function priority(url){const path=new URL(url).pathname;return/milchprodukte/.test(path)?0:/backwaren|vorraete|fleisch|fisch|obst/.test(path)?1:/snacks|fertiggerichte|eis|vegane/.test(path)?2:3;}
function eligibleNavigation(url){return!/(?:^|\/)(?:aldi-eigenmarken|sortiment-highlights|gutscheine-guthabenkarten|weihnachten-silvester)(?:\/|\.)/.test(new URL(url).pathname);}
function initial(){return{version:1,targets:[Fetch.SEED],nextIndex:0,targetProofs:[],excludedNavigationTargets:[],completedPasses:0,nextPassAt:null,lastError:null,retryAfter:null,revision:0,lastRunAt:null};}
function state(raw={}){
 const cursor=raw.cursor??initial();if(!object(cursor)||Object.keys(cursor).some(k=>!["version","targets","nextIndex","targetProofs","excludedNavigationTargets","completedPasses","nextPassAt","lastError","retryAfter","revision","lastRunAt"].includes(k))||cursor.version!==1)throw fail("aldi-category-checkpoint-invalid");
 Fetch.targets(cursor.targets);if(!Number.isSafeInteger(cursor.nextIndex)||cursor.nextIndex<0||cursor.nextIndex>cursor.targets.length||!["completedPasses","revision"].every(k=>Number.isSafeInteger(cursor[k])&&cursor[k]>=0)||!["nextPassAt","retryAfter","lastRunAt"].every(k=>cursor[k]===null||iso(cursor[k]))||cursor.lastError!==null&&(typeof cursor.lastError!=="string"||cursor.lastError.length>300)||!Array.isArray(cursor.targetProofs)||cursor.targetProofs.length>Fetch.MAX_TARGETS||!Array.isArray(cursor.excludedNavigationTargets)||cursor.excludedNavigationTargets.length>Fetch.MAX_TARGETS)throw fail("aldi-category-checkpoint-invalid");
 const proofs=new Set();for(const proof of cursor.targetProofs){if(!object(proof)||Object.keys(proof).some(k=>!["target","from","sourceResponseHash","capturedAt"].includes(k))||!cursor.targets.includes(proof.target)||proofs.has(proof.target)||!/^[a-f0-9]{64}$/.test(proof.sourceResponseHash||"")||!iso(proof.capturedAt))throw fail("aldi-category-checkpoint-invalid");Fetch.targets([proof.target]);Fetch.targets([proof.from]);proofs.add(proof.target);}
 for(const target of cursor.targets)if(target!==Fetch.SEED&&!proofs.has(target))throw fail("aldi-category-discovery-proof-required");
 for(const target of cursor.excludedNavigationTargets)Fetch.targets([target]);
 return structuredClone(cursor);
}
async function ensure(pool){if(!pool||typeof pool.query!=="function")throw fail("database-required");await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(source_id text PRIMARY KEY CHECK(source_id='ALDI Nord category publication'),cursor jsonb NOT NULL CHECK(jsonb_typeof(cursor)='object' AND octet_length(cursor::text)<=200000),last_error text,retry_after timestamptz,updated_at timestamptz NOT NULL DEFAULT now());`);}
async function load(pool){await ensure(pool);const result=await pool.query(`SELECT cursor,last_error AS "lastError",retry_after AS "retryAfter",updated_at AS "updatedAt" FROM ${TABLE} WHERE source_id=$1`,[SOURCE]);return result.rows[0]||{};}
function dueAt(raw={},now=Date.now()){
 const cursor=state(raw),retry=loadedTime(raw.retryAfter),insideRetry=loadedTime(cursor.retryAfter);if(Number.isNaN(retry)||Number.isNaN(insideRetry))throw fail("aldi-category-checkpoint-invalid");
 const pause=Math.max(retry??0,insideRetry??0);if(pause>now)return pause;
 if(cursor.nextIndex<cursor.targets.length)return cursor.lastRunAt===null?now:Math.max(now,Date.parse(cursor.lastRunAt)+CONTINUATION_MS);
 return cursor.nextPassAt===null?now:Math.max(now,Date.parse(cursor.nextPassAt));
}
async function resumeAt(pool,now=Date.now()){return new Date(dueAt(await load(pool),now)).toISOString();}
function nextState(previous,observed,time){
 const next=structuredClone(previous),seen=new Set(next.targets),excluded=new Set(next.excludedNavigationTargets),proofs=new Set(next.targetProofs.map(x=>x.target));
 const additions=observed.discoveredTargets.filter(eligibleNavigation).sort((a,b)=>priority(a)-priority(b)||a.localeCompare(b));
 for(const target of observed.discoveredTargets)if(!eligibleNavigation(target))excluded.add(target);
 for(const target of additions)if(!seen.has(target)){if(next.targets.length>=Fetch.MAX_TARGETS)throw fail("aldi-category-discovery-bound-exceeded");next.targets.push(target);seen.add(target);if(!proofs.has(target))next.targetProofs.push({target,from:observed.original.meta.sourceResponseUrl,sourceResponseHash:observed.original.meta.sourceResponseHash,capturedAt:observed.original.meta.capturedAt});}
 if(excluded.size>Fetch.MAX_TARGETS)throw fail("aldi-category-discovery-bound-exceeded");next.excludedNavigationTargets=[...excluded].sort();next.nextIndex++;next.revision++;next.lastRunAt=new Date(time).toISOString();next.lastError=null;next.retryAfter=null;
 if(next.nextIndex===next.targets.length){next.completedPasses++;next.nextPassAt=new Date(time+REFRESH_MS).toISOString();}else next.nextPassAt=null;
 return state({cursor:next});
}
async function checkpoint(tx,next,expected){
 await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[SOURCE+":checkpoint"]);
 const existing=(await tx.query(`SELECT cursor FROM ${TABLE} WHERE source_id=$1 FOR UPDATE`,[SOURCE])).rows[0];if(state(existing||{}).revision!==expected)throw fail("aldi-category-checkpoint-moved");
 await tx.query(`INSERT INTO ${TABLE}(source_id,cursor,last_error,retry_after,updated_at) VALUES($1,$2::jsonb,NULL,NULL,$3) ON CONFLICT(source_id) DO UPDATE SET cursor=EXCLUDED.cursor,last_error=NULL,retry_after=NULL,updated_at=EXCLUDED.updated_at`,[SOURCE,JSON.stringify(next),next.lastRunAt]);
}
async function failureCheckpoint(client,code,nextAttemptAt,time){
 await client.query(`INSERT INTO ${TABLE}(source_id,cursor,last_error,retry_after,updated_at) VALUES($1,$2::jsonb,$3,$4,$5) ON CONFLICT(source_id) DO UPDATE SET last_error=EXCLUDED.last_error,retry_after=EXCLUDED.retry_after,updated_at=EXCLUDED.updated_at`,[SOURCE,JSON.stringify(initial()),code,Timestamp.timestampParameter(nextAttemptAt),new Date(time).toISOString()]);
}
async function retainFailure(pool,error,code,nextAttemptAt,time,service=Rejected){
 if(!error.rejectedCapture){try{await failureCheckpoint(pool,code,nextAttemptAt,time);error.failureCheckpointPersisted=true;}catch(persistenceError){error.failureCheckpointPersisted=false;error.failurePersistenceErrorCode=String(persistenceError.code||"aldi-category-failure-checkpoint-failed").slice(0,150);}return;}
 let tx,rollbackError;
 try{
  await service.ensure(pool);tx=await pool.connect();await tx.query("BEGIN");await tx.query("SELECT txid_current()");
  await service.persist(tx,error.rejectedCapture,{now:time});await failureCheckpoint(tx,code,nextAttemptAt,time);await tx.query("COMMIT");error.failureCheckpointPersisted=true;
 }catch(retentionError){
  if(tx)try{await tx.query("ROLLBACK");}catch(rollback){rollbackError=rollback;}
  if(tx){tx.release(rollbackError);tx=null;}
  // A diagnostic write failure cannot erase the original source failure or pause.
  error.retentionErrorCode=String(retentionError.code||"aldi-category-rejected-retention-failed").slice(0,150);
  try{await failureCheckpoint(pool,code,nextAttemptAt,time);error.failureCheckpointPersisted=true;}catch(persistenceError){error.failureCheckpointPersisted=false;error.failurePersistenceErrorCode=String(persistenceError.code||"aldi-category-failure-checkpoint-failed").slice(0,150);}
 }finally{tx?.release(rollbackError);}
}
async function refresh(options={},deps={}){
 const {pool}=options,now=options.now||Date.now;if(!pool)throw fail("database-required");if(typeof deps.canFetch!=="function")throw fail("aldi-shared-source-gate-required");if(running)return{received:0,accepted:0,skipped:"already-running"};
 const requested=options.maxRequests??MAX_REQUESTS;if(!Number.isSafeInteger(requested)||requested<1||requested>MAX_REQUESTS)throw fail("aldi-category-request-budget-invalid");
 running=true;let requests=0,bytes=0,received=0,accepted=0,identityReceived=0,identityAccepted=0,categoryRejected=0,pages=0;
 try{
  const saved=await(deps.load||load)(pool),start=now();if(dueAt(saved,start)>start)return{received:0,accepted:0,skipped:"category-not-due",nextAttemptAt:new Date(dueAt(saved,start)).toISOString()};let cursor=state(saved);
  const Prices=deps.prices||require("./aldi-category-price-service"),articleService=deps.articles||Articles;await(deps.ensure||ensure)(pool);await articleService.ensure(pool);await Prices.ensure(pool);
  if(cursor.nextIndex===cursor.targets.length)cursor={...cursor,nextIndex:0,nextPassAt:null};
  while(requests<requested&&now()-start<120000){
   if(requests)await(deps.sleep||((ms)=>new Promise(resolve=>setTimeout(resolve,ms))))(1000);
   const gate=await deps.canFetch();if(gate!==true)return{received,accepted,identityReceived,identityAccepted,requests,bytes,pages,skipped:pages?undefined:"shared-source-not-eligible",nextAttemptAt:typeof gate==="string"?gate:new Date(now()+CONTINUATION_MS).toISOString(),captureSourceId:SOURCE};
   const target=cursor.targets[cursor.nextIndex];let observed;try{observed=await(deps.fetchPage||Fetch.fetchPage)(target,{now});requests+=observed.requests;bytes+=observed.bytes;}catch(error){requests++;throw error;}
   if(!observed||observed.requests!==1||!Number.isSafeInteger(observed.bytes)||observed.bytes<1||observed.bytes>4*1024*1024||bytes>16*1024*1024||observed.original?.meta?.sourceResponseUrl!==target||observed.page?.freshCaptureVerified!==true||!Array.isArray(observed.discoveredTargets)||JSON.stringify(observed.discoveredTargets)!==JSON.stringify(Fetch.navigationTargets(observed.original.body)))throw fail("aldi-category-result-unconfirmed");Fetch.targets(observed.discoveredTargets.length?observed.discoveredTargets:[target]);
   const next=nextState(cursor,observed,now()),tx=await pool.connect();let rollbackError;
   try{await tx.query("BEGIN");await tx.query("SELECT txid_current()");const native=await articleService.persist(tx,observed.page,{now:now(),original:observed.original}),priced=await Prices.persist(tx,observed.page,{now:now(),original:observed.original});await(deps.checkpoint||checkpoint)(tx,next,cursor.revision);await tx.query("COMMIT");identityReceived+=native.received||0;identityAccepted+=native.accepted||0;received+=priced.received||0;accepted+=priced.accepted||0;categoryRejected+=observed.page.rejectedCount||0;pages++;cursor=next;}catch(error){try{await tx.query("ROLLBACK");}catch(rollback){rollbackError=rollback;}throw error;}finally{tx.release(rollbackError);}
   if(cursor.nextIndex===cursor.targets.length)break;
  }
  return{received,accepted,identityReceived,identityAccepted,categoryRejected,requests,bytes,pages,captureSourceId:SOURCE,nextAttemptAt:new Date(cursor.nextIndex===cursor.targets.length?Date.parse(cursor.nextPassAt):now()+CONTINUATION_MS).toISOString(),catalog:{targetCategories:cursor.targets.length,scannedCategories:cursor.nextIndex,completedPasses:cursor.completedPasses,excludedNavigationTargets:cursor.excludedNavigationTargets,categoryTraversalFinished:cursor.nextIndex===cursor.targets.length,fullAssortment:false},scope:{country:"DE",channel:"assortment-publication",location:"unknown"},independentOfUserReceipts:true};
 }catch(error){
  const time=now(),nextAttemptAt=new Date(time+Math.max(ERROR_WAIT_MS,Number.isFinite(error.retryAfterMs)&&error.retryAfterMs>0?error.retryAfterMs:0)).toISOString(),code=String(error.code||"aldi-category-refresh-failed").slice(0,300);
  await retainFailure(pool,error,code,nextAttemptAt,time,deps.rejected||Rejected);throw Object.assign(error,{nextAttemptAt,requests,bytes,pages});
 }finally{running=false;}
}
async function status(pool,now=Date.now()){const raw=await load(pool),cursor=state(raw);return{sourceId:SOURCE,targetCategories:cursor.targets.length,scannedCategories:cursor.nextIndex,completedPasses:cursor.completedPasses,lastRunAt:cursor.lastRunAt,lastError:raw.lastError||null,nextAttemptAt:new Date(dueAt(raw,now)).toISOString(),excludedNavigationTargets:cursor.excludedNavigationTargets,categoryTraversalFinished:cursor.nextIndex===cursor.targets.length,fullAssortment:false,scopeCountry:"DE",scopeChannel:"assortment-publication",locationScope:"unknown",normalPriceClassificationVerified:false,independentOfUserReceipts:true};}
module.exports={SOURCE,TABLE,CONTINUATION_MS,REFRESH_MS,MAX_REQUESTS,ensure,load,state,dueAt,priority,eligibleNavigation,nextState,checkpoint,failureCheckpoint,retainFailure,refresh,status,resumeAt};
