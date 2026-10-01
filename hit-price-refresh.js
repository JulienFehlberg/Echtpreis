"use strict";
const Collector=require("./hit-assortment-collector"),Import=require("./hit-price-import"),Clock=require("./current-price-query-service");
const SOURCE=Import.SOURCE,TABLE="hit_assortment_refresh_state",REFRESH_MS=900000,CONTINUATION_MS=60000;
let running=false;
const fail=code=>Object.assign(new Error(code),{code});
async function ensure(pool){await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(source_id text PRIMARY KEY,cursor jsonb,last_completed_at timestamptz,completed_cycles integer NOT NULL DEFAULT 0,native_total integer,pages_fetched integer NOT NULL DEFAULT 0,received_cumulative integer NOT NULL DEFAULT 0,last_error text,retry_after timestamptz,scan_coverage jsonb,updated_at timestamptz NOT NULL DEFAULT now())`);await pool.query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS scan_coverage jsonb`);}
async function load(pool){await ensure(pool);const state=(await pool.query(`SELECT cursor,last_completed_at AS "lastCompletedAt",completed_cycles AS "completedCycles",native_total AS "nativeTotal",pages_fetched AS "pagesFetched",received_cumulative AS "receivedCumulative",last_error AS "lastError",retry_after AS "retryAfter",scan_coverage AS "scanCoverage",updated_at AS "updatedAt" FROM ${TABLE} WHERE source_id=$1`,[SOURCE])).rows[0]||{};if(state.cursor?.version===1){state.cursor=null;state.scanCoverage=null;}return state;}
function nextTime(state,time){const initial=Date.parse(Collector.COOLDOWN_UNTIL),retry=state.retryAfter==null?NaN:new Date(state.retryAfter).getTime(),updated=state.updatedAt==null?NaN:new Date(state.updatedAt).getTime(),due=Number.isFinite(retry)?retry:Number.isFinite(updated)?updated+(state.cursor?CONTINUATION_MS:REFRESH_MS):time;return new Date(Math.max(initial,due,time)).toISOString();}
function confirmed(result,state,budget){
 if(!result||result.sourceId!==SOURCE||!Array.isArray(result.accepted)||!Array.isArray(result.rejected)||!Array.isArray(result.pages)||!Number.isSafeInteger(result.requests)||result.requests<1||result.requests>budget||typeof result.complete!=="boolean"||result.physicalStoreAssortmentComplete!==false)throw fail("hit-refresh-progress-unconfirmed");
 const previous=state.cursor||{pagesFetched:0,received:0},pages=result.pages,coverage=result.categoryCoverage;
 if(!coverage||![coverage.visited,coverage.pending].every(n=>Number.isSafeInteger(n)&&n>=0)||!Array.isArray(coverage.truncatedLeaves)||!Array.isArray(coverage.unresolvedNodes)||typeof result.nativePaginationComplete!=="boolean")throw fail("hit-refresh-category-coverage-unconfirmed");
 if(result.pagesFetched!==previous.pagesFetched+pages.length||result.received!==previous.received+pages.reduce((sum,p)=>sum+p.uniqueRowCount,0)||pages.some(p=>p.pagination?.page!==0||!Number.isSafeInteger(p.rowCount)||!Number.isSafeInteger(p.uniqueRowCount)||p.uniqueRowCount<0||p.uniqueRowCount>p.rowCount||p.rowCount!==Math.min(p.pagination?.limit,p.pagination?.total)))throw fail("hit-refresh-progress-conflict");
 if(result.nativePaginationComplete&&(coverage.truncatedLeaves.length||coverage.unresolvedNodes.length||!result.complete||result.total!==result.received))throw fail("hit-refresh-assortment-completion-unconfirmed");
 if(result.complete){if(result.cursor!==null||result.error||result.total<1||coverage.pending!==0||result.pagesFetched<1)throw fail("hit-refresh-completion-unconfirmed");}
 else{const cursor=Collector.cursorFor(result.cursor,Import.STORE_PROFILE);if(cursor.pagesFetched!==result.pagesFetched||cursor.received!==result.received||cursor.total!==result.total)throw fail("hit-refresh-cursor-unconfirmed");}
 if(!pages.length&&!result.error)throw fail("hit-refresh-no-native-progress");
}
async function refresh({pool,maxRequests=8,now=Date.now}={},deps={}){
 if(!pool)throw fail("database-required");if(running)return{received:0,accepted:0,skipped:"already-running"};running=true;
 try{
  const state=await load(pool),time=now(),nextAttemptAt=nextTime(state,time),budget=Math.max(1,Math.min(16,Math.floor(Number(maxRequests)||8)));
  if(Date.parse(nextAttemptAt)>time)return{received:0,accepted:0,skipped:"source-cooldown",nextAttemptAt};
  let result;
  try{result=await(deps.collect||Collector.collect)({storeProfile:Import.STORE_PROFILE,cursor:state.cursor||null,maxRequests:budget,now});confirmed(result,state,budget);}
  catch(error){await recordFailure(pool,error,now());throw error;}
  let saved;
  try{saved=await(deps.persist||Import.persist)(pool,result.accepted,{storeProfile:Import.STORE_PROFILE,now});}
  catch(error){await recordFailure(pool,error,now());throw error;}
  const stamp=new Date(now()).toISOString(),partial=result.error,cooldown=partial?new Date(now()+Math.max(3600000,Number(partial.retryAfterMs)||0)).toISOString():null,reset=partial&&/cursor-conflict|count-drift|repeated-sku|duplicate-or-invalid-sku|page-identity-conflict/.test(partial.code||"");
  if(["hit-native-cross-page-identity-conflict","hit-native-page-identity-conflict"].includes(partial?.code)){
   if(!Array.isArray(partial.conflictGtins)||!partial.conflictGtins.length||partial.conflictGtins.some(g=>!/^\d{8,14}$/.test(g)))throw fail("hit-conflict-native-identities-required");
   await pool.query("UPDATE price_observations SET truth_eligible=false,status='conflicting-source' WHERE source_id=$1 AND external_location_id=$2 AND gtin=ANY($3::text[])",[SOURCE,String(Import.STORE_PROFILE.storeId),partial.conflictGtins]);
  }
  // Advance only after valid native quotes have committed. A business rejection remains a coverage gap.
  const scanCoverage={categoryCoverage:result.categoryCoverage,categoryTraversalCycleComplete:result.complete,nativePaginationComplete:result.nativePaginationComplete};
  await pool.query(`INSERT INTO ${TABLE}(source_id,cursor,last_completed_at,completed_cycles,native_total,pages_fetched,received_cumulative,last_error,retry_after,updated_at,scan_coverage) VALUES($1,$2::jsonb,CASE WHEN $3 THEN $4::timestamptz ELSE NULL END,CASE WHEN $3 THEN 1 ELSE 0 END,$5,$6,$7,$8,$9,$4,$10::jsonb) ON CONFLICT(source_id) DO UPDATE SET cursor=EXCLUDED.cursor,last_completed_at=CASE WHEN $3 THEN EXCLUDED.last_completed_at ELSE ${TABLE}.last_completed_at END,completed_cycles=${TABLE}.completed_cycles+CASE WHEN $3 THEN 1 ELSE 0 END,native_total=EXCLUDED.native_total,pages_fetched=EXCLUDED.pages_fetched,received_cumulative=EXCLUDED.received_cumulative,last_error=EXCLUDED.last_error,retry_after=EXCLUDED.retry_after,scan_coverage=EXCLUDED.scan_coverage,updated_at=EXCLUDED.updated_at`,[SOURCE,JSON.stringify(result.complete||reset?null:result.cursor),result.complete,stamp,result.total,result.pagesFetched,result.received,partial?.code||null,cooldown,JSON.stringify(scanCoverage)]);
  const output={sourceId:SOURCE,received:result.accepted.length,accepted:saved.accepted.length,duplicates:saved.duplicates,rejected:saved.rejected.length,sourceRejected:result.rejected.length,productsCreated:saved.productsCreated,storeId:saved.storeId,requests:result.requests,nativeTotal:result.total,pagesFetched:result.pagesFetched,receivedCumulative:result.received,...scanCoverage,publishedTraversalComplete:result.nativePaginationComplete,physicalStoreAssortmentComplete:false,nextAttemptAt:cooldown||new Date(now()+(result.complete?REFRESH_MS:CONTINUATION_MS)).toISOString(),independentOfUserReceipts:true};
  if(partial)throw Object.assign(fail(partial.code),{nextAttemptAt:output.nextAttemptAt,partialResult:output,received:output.received,accepted:output.accepted,checkpointSaved:true});
  return output;
 }finally{running=false;}
}
async function recordFailure(pool,error,time){const code=String(error.code||error.message||error).slice(0,300),retry=new Date(Math.max(time+3600000,Date.parse(error.nextAttemptAt)||0)).toISOString(),reset=/cursor-conflict|count-drift|repeated-sku|duplicate-or-invalid-sku/.test(code);await pool.query(`INSERT INTO ${TABLE}(source_id,last_error,retry_after,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(source_id) DO UPDATE SET last_error=EXCLUDED.last_error,retry_after=EXCLUDED.retry_after,cursor=CASE WHEN $5 THEN NULL ELSE ${TABLE}.cursor END,updated_at=EXCLUDED.updated_at`,[SOURCE,code,retry,new Date(time).toISOString(),reset]);error.nextAttemptAt=retry;}
async function resumeAt(pool,now=Date.now()){return nextTime(await load(pool),now);}
async function status(pool){
 const state=await load(pool);await Import.ensure(pool);
 const active="e.retailer_sku !~ 'KG$' AND po.truth_eligible=true AND po.valid_to=$2::date AND po.valid_from=$2::date AND po.observed_at>statement_timestamp()-interval '24 hours' AND po.observed_at<=statement_timestamp()";
 const counts=(await pool.query(`SELECT count(DISTINCT e.product_id)::int AS "historicalProducts",count(*)::int AS "historicalCaptures",count(*) FILTER(WHERE e.retailer_sku ~ 'KG$')::int AS "unsupportedKilogramCaptures",count(*) FILTER(WHERE e.retailer_sku ~ 'KG$' AND po.truth_eligible=true)::int AS "truthEligibleKilogramCaptures",count(DISTINCT e.product_id) FILTER(WHERE ${active})::int AS "currentProducts",count(*) FILTER(WHERE ${active})::int AS "currentPrices",count(*) FILTER(WHERE ${active} AND (po.eligibility->>'checkoutPriceVerified') IS DISTINCT FROM 'true')::int AS "unknownDepositPrices" FROM ${Import.TABLE} e JOIN price_observations po ON po.id=e.observation_id WHERE e.source_id=$1`,[SOURCE,Clock.today()])).rows[0]||{};
 const {cursor:privateCursor,...publicState}=state;
 return{sourceId:SOURCE,...publicState,hasContinuation:!!privateCursor,...counts,...(state.scanCoverage||{}),nextAttemptAt:nextTime(state,Date.now()),publishedTraversalComplete:!state.cursor&&!state.lastError&&state.nativeTotal>0&&state.receivedCumulative===state.nativeTotal&&!!state.lastCompletedAt&&state.scanCoverage?.nativePaginationComplete===true,physicalStoreAssortmentComplete:false,scopeCountry:"DE",scopeChannel:"physical-store",city:"Berlin",nativeStoreId:Import.STORE_PROFILE.storeId,nativeStoreNumber:Import.STORE_PROFILE.storeNumber,storeAddress:Import.STORE_PROFILE.address,scopeEvidenceUrl:"https://www.hit.de/faq/sortiment",captureValidity:"captured-berlin-calendar-day",independentOfUserReceipts:true,refreshIntervalMinutes:15,continuationIntervalMinutes:1};
}
module.exports={SOURCE,TABLE,REFRESH_MS,CONTINUATION_MS,ensure,load,confirmed,refresh,resumeAt,status};
