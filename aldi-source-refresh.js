"use strict";
const PDP=require("./aldi-assortment-refresh"),PDPClient=require("./aldi-assortment-client"),Category=require("./aldi-category-refresh"),Store=require("./price-refresh-state-store"),Backoff=require("./price-refresh-backoff");
const SOURCE=PDP.SOURCE,fail=code=>Object.assign(new Error(code),{code});let running=false;
const timestamp=value=>value==null?null:Number.isFinite(new Date(value).getTime())?new Date(value).getTime():NaN;
function categoryAttemptAt(category,time,service=Category){
 const success=timestamp(service.state(category).lastRunAt);if(Number.isNaN(success))throw fail("aldi-shared-source-state-invalid");
 if(category.lastError==null)return success;
 const updated=category.updatedAt,validDate=updated instanceof Date&&Number.isFinite(updated.getTime()),validString=typeof updated==="string"&&Number.isFinite(Date.parse(updated))&&new Date(updated).toISOString()===updated;
 const failed=validDate||validString?timestamp(updated):NaN;if(typeof category.lastError!=="string"||!category.lastError.trim()||category.lastError.length>300||!Number.isSafeInteger(failed)||failed<0||failed>time)throw fail("aldi-shared-source-state-invalid");
 // Failure checkpoints record a real attempted turn without advancing the category cursor.
 return Math.max(success??0,failed);
}
function cooldownUntil(source,pdp,category,time){
 const failures=Number(source.consecutiveFailures||0),last=timestamp(source.lastAttemptAt),times=[timestamp(pdp.retryAfter),timestamp(category.retryAfter),timestamp(category.cursor?.retryAfter)];
 if(!Number.isSafeInteger(failures)||failures<0||Number.isNaN(last)||times.some(Number.isNaN))throw fail("aldi-shared-source-state-invalid");
 if(failures){if(last===null)throw fail("aldi-shared-source-state-invalid");times.push(last+Backoff.delayMs(source),timestamp(source.nextAttemptAt));}
 if(times.some(Number.isNaN))throw fail("aldi-shared-source-state-invalid");return Math.max(time,...times.filter(x=>x!==null));
}
async function schedule(pool,time,deps={}){
 const pdp=await(deps.pdp||PDP).load(pool),category=await(deps.category||Category).load(pool),sources=await(deps.store||Store).loadAll(pool),source=sources[SOURCE]||{};
 const pause=cooldownUntil(source,pdp,category,time),nativeResume=timestamp(await(deps.pdp||PDP).resumeAt(pool,time)),updated=timestamp(pdp.updatedAt),pdpDue=nativeResume??(updated===null?time:updated+PDP.REFRESH_MS),categoryDue=(deps.category||Category).dueAt(category,time);
 if(Number.isNaN(pdpDue)||!Number.isFinite(categoryDue))throw fail("aldi-shared-source-state-invalid");
 const lastCategory=categoryAttemptAt(category,time,deps.category||Category),lastSuccess=timestamp(source.lastSuccessAt);if(Number.isNaN(lastSuccess))throw fail("aldi-shared-source-state-invalid");
 const continuationAfter=Math.max(updated??0,lastCategory??0,lastSuccess??0)+Category.CONTINUATION_MS;
 return{pdp,category,source,pdpDue,categoryDue,pause,due:Math.max(pause,continuationAfter,Math.min(pdpDue,categoryDue))};
}
async function refresh(options={},deps={}){
 const {pool,leaseOwner}=options,now=options.now||Date.now;if(!pool)throw fail("database-required");if(typeof leaseOwner!=="string"||!leaseOwner.trim()||leaseOwner.length>200)throw fail("aldi-shared-source-lease-owner-required");if(running)return{received:0,accepted:0,skipped:"already-running"};running=true;
 try{
  const current=await schedule(pool,now(),deps);
  const gate=async()=>{if(deps.shouldContinue&&deps.shouldContinue()!==true)return false;const loaded=await schedule(pool,now(),deps),leaseUntil=timestamp(loaded.source.leaseUntil);if(loaded.pause>now())return new Date(loaded.pause).toISOString();if(loaded.source.leaseOwner!==leaseOwner||leaseUntil===null||Number.isNaN(leaseUntil)||leaseUntil<=now())return new Date(Math.max(now()+60000,leaseUntil||0)).toISOString();return true;};
  const permission=await gate();if(permission!==true)return{received:0,accepted:0,skipped:"shared-source-not-eligible",nextAttemptAt:typeof permission==="string"?permission:new Date(now()+60000).toISOString()};
  const time=now();if(current.due>time)return{received:0,accepted:0,skipped:"source-not-due",nextAttemptAt:new Date(current.due).toISOString()};
  const lastCategory=categoryAttemptAt(current.category,time,deps.category||Category),lastPDP=timestamp(current.pdp.updatedAt),categoryTurn=current.categoryDue<=time&&(current.pdpDue>time||lastCategory===null||lastPDP===null||lastCategory<=lastPDP);
  let result;if(categoryTurn){const budget=Math.min(Category.MAX_REQUESTS,options.maxRequests??16);if(!Number.isSafeInteger(budget)||budget<1)throw fail("aldi-category-request-budget-invalid");result=await(deps.category||Category).refresh({pool,maxRequests:budget,now},{...(deps.categoryDeps||{}),canFetch:gate});}else{const legacy=deps.pdpDeps||{};result=await(deps.pdp||PDP).refresh({pool,maxRequests:options.maxRequests??16,now},{...legacy,discoverTargets:args=>(legacy.discoverTargets||PDPClient.discoverTargets)({...args,canFetch:gate}),fetchProducts:(input,args)=>(legacy.fetchProducts||PDPClient.fetchProducts)(input,{...args,canFetch:gate})});}
  const next=await schedule(pool,now(),deps);return{...result,runnerSourceId:SOURCE,captureMode:categoryTurn?"category-original":"product-detail-original",nextAttemptAt:new Date(next.due).toISOString(),sharedSourceLease:true};
 }finally{running=false;}
}
async function resumeAt(pool,now=Date.now()){return new Date((await schedule(pool,now)).due).toISOString();}
async function status(pool){const legacy=await PDP.status(pool);return{...legacy,categoryResearch:await Category.status(pool),sharedSource:{runnerSourceId:SOURCE,categoryCaptureSourceId:Category.SOURCE,separateCategoryCursor:true,sharedLease:true,sharedFailureCooldown:true,normalPriceClassificationVerified:false}};}
module.exports={SOURCE,refresh,resumeAt,status,schedule,cooldownUntil};
