"use strict";
const Client=require("./rewe-retailer-price-client"),Published=require("./rewe-retailer-price-service"),Store=require("./price-refresh-state-store"),Backoff=require("./price-refresh-backoff");
const SOURCE=Client.SOURCE,REFRESH_MS=15*60*1000,CONTINUATION_MS=60*1000,TABLE="rewe_retailer_catalog_state";
let running=false;
async function ensure(pool){
 if(!pool)throw new Error("database-required");
 await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(source_id text PRIMARY KEY,cursor jsonb,last_completed_at timestamptz,completed_cycles int NOT NULL DEFAULT 0,category_count int NOT NULL DEFAULT 0,categories_completed int NOT NULL DEFAULT 0,pages_fetched int NOT NULL DEFAULT 0,received_cumulative int NOT NULL DEFAULT 0,assortment_hash text,last_error text,retry_after timestamptz,updated_at timestamptz NOT NULL DEFAULT now());`);
}
async function readState(pool,forUpdate=false){
 return(await pool.query(`SELECT cursor,last_completed_at AS "lastCompletedAt",completed_cycles AS "completedCycles",category_count AS "categoryCount",categories_completed AS "categoriesCompleted",pages_fetched AS "pagesFetched",received_cumulative AS "receivedCumulative",assortment_hash AS "assortmentHash",last_error AS "lastError",retry_after AS "retryAfter",updated_at AS "updatedAt",xmin::text AS "checkpointVersion" FROM ${TABLE} WHERE source_id=$1${forUpdate?" FOR UPDATE":""}`,[SOURCE])).rows[0]||{};
}
async function load(pool){await ensure(pool);return readState(pool);}
function confirmedProgress(collected,state={}){
 if(!collected||!Array.isArray(collected.offers)||typeof collected.complete!=="boolean"||!Number.isSafeInteger(collected.categoryCount)||collected.categoryCount<1||!Number.isSafeInteger(collected.categoriesCompleted)||collected.categoriesCompleted<0||collected.categoriesCompleted>collected.categoryCount||collected.complete!==(collected.categoriesCompleted===collected.categoryCount)||!Number.isSafeInteger(collected.pagesFetched)||collected.pagesFetched<1||!Number.isSafeInteger(collected.receivedCumulative??collected.received)||(collected.receivedCumulative??collected.received)<0||!/^[a-f0-9]{64}$/.test(collected.assortmentHash||""))throw new Error("rewe-catalog-progress-unconfirmed");
 if(collected.stalled||collected.pagesFetched<=(state.cursor?.pagesFetched||0)||(collected.receivedCumulative??collected.received)<(state.cursor?.received||0)||collected.categoriesCompleted<(state.cursor?.categoryIndex||0))throw new Error("rewe-catalog-progress-stalled");
 if(state.cursor&&state.cursor.assortmentHash!==collected.assortmentHash)throw new Error("rewe-native-assortment-conflict");
 if(collected.complete){if(collected.nextCursor!=null)throw new Error("rewe-catalog-progress-unconfirmed");return;}
 const cursor=collected.nextCursor;
 if(!cursor||typeof cursor!=="object"||Array.isArray(cursor)||cursor.version!==1||cursor.nativeMarketId!==Client.MARKET_ID||cursor.scopeChannel!=="pickup"||cursor.serviceType!=="PICKUP"||cursor.assortmentHash!==collected.assortmentHash||cursor.categoryIndex!==collected.categoriesCompleted||cursor.pagesFetched!==collected.pagesFetched||cursor.received!==(collected.receivedCumulative??collected.received)||!Number.isSafeInteger(cursor.pageNumber)||cursor.pageNumber<1)throw new Error("rewe-catalog-progress-unconfirmed");
}
const fail=(code,extra={})=>Object.assign(new Error(code),{code,...extra});
const timestamp=value=>value==null?null:new Date(value).toISOString();
const canonical=value=>JSON.stringify(value,(_,part)=>part&&typeof part==="object"&&!Array.isArray(part)?Object.fromEntries(Object.keys(part).sort().map(key=>[key,part[key]])):part);
const same=(a,b)=>canonical(a)===canonical(b);
function checkpointKey(state={}){return canonical([state.cursor??null,timestamp(state.lastCompletedAt),state.completedCycles??0,state.categoryCount??0,state.categoriesCompleted??0,state.pagesFetched??0,state.receivedCumulative??0,state.assortmentHash??null,state.lastError??null,timestamp(state.retryAfter),timestamp(state.updatedAt),state.checkpointVersion??null]);}
function clock(now){const n=now();if(!Number.isSafeInteger(n)||n<0||!Number.isFinite(new Date(n).getTime()))throw fail("rewe-refresh-clock-invalid");return n;}
function nativeBatch(collected,state,budget,time){
 confirmedProgress(collected,state);
 if(!Array.isArray(collected.originalPages)||!collected.originalPages.length||collected.originalPages.length>budget-1||!collected.originalFilters||!Array.isArray(collected.products)||!Array.isArray(collected.identityRejected)||!Array.isArray(collected.rejected)||collected.requests!==collected.originalPages.length+1||collected.requests>budget||collected.pagesThisBatch!==collected.originalPages.length)throw fail("rewe-native-original-batch-required");
 const listing=Client.reparseOriginalFilters(collected.originalFilters,{now:time}),cursor=Client.cursorState(state.cursor||null,listing),offers=new Map(),products=[],rejected=[],identityRejected=[];
 let received=0;
 for(const original of collected.originalPages){
  const category=listing.categories[cursor.categoryIndex];
  if(!category||!same(original.category,category)||original.pageNumber!==cursor.pageNumber)throw fail("rewe-native-original-frontier-conflict");
  const parsed=Client.reparseOriginalPage(original,{now:time});
  for(const offer of parsed.offers){const old=offers.get(offer.retailerSku);if(old&&(old.retailerProductId!==offer.retailerProductId||old.gtin!==offer.gtin||old.pack!==offer.pack))throw fail("rewe-native-listing-identity-conflict");offers.set(offer.retailerSku,offer);}
  products.push(...parsed.products);
  rejected.push(...parsed.rejected);identityRejected.push(...parsed.identityRejected);received+=parsed.received;cursor.received+=parsed.received;cursor.pagesFetched++;
  if(parsed.page.pagination.objectCount===0||cursor.pageNumber===parsed.page.pagination.pageCount){cursor.categoryIndex++;cursor.pageNumber=1;}else cursor.pageNumber++;
 }
 const complete=cursor.categoryIndex===listing.categories.length;
 if(collected.categoryCount!==listing.categories.length||collected.assortmentHash!==listing.assortmentHash||collected.categoryProofHash!==collected.originalFilters.meta.sourceResponseHash||collected.categoriesCompleted!==cursor.categoryIndex||collected.pagesFetched!==cursor.pagesFetched||collected.received!==received||collected.receivedCumulative!==cursor.received||collected.complete!==complete||!same(collected.nextCursor,complete?null:cursor)||!same(collected.offers,[...offers.values()])||!same(collected.products,products)||!same(collected.rejected,rejected)||!same(collected.identityRejected,identityRejected))throw fail("rewe-native-original-result-conflict");
 const priceIdentity=offer=>products.some(product=>product.retailerSku===offer.retailerSku&&product.retailerProductId===offer.retailerProductId&&product.nativeArticleId===offer.nativeArticleId&&product.gtin===offer.gtin&&product.name===offer.name&&product.pack===offer.pack&&product.sourceUrl===offer.sourceUrl&&product.sourceResponseUrl===offer.sourceResponseUrl&&product.sourceResponseHash===offer.sourceResponseHash&&product.observedAt===offer.capturedAt);
 const rawOffers=[...offers.values()],safeOffers=rawOffers.filter(priceIdentity),nativeSku=new RegExp("^[1-9]\\d{0,4}-[A-Z0-9]{1,40}-"+Client.NATIVE_STORE_ID+"$"),identityRejectedSKUs=[...new Set(identityRejected.map(row=>row.retailerSku).filter(sku=>typeof sku==="string"&&nativeSku.test(sku)))];
 return{received,products,offers:rawOffers,safeOffers,identityRejectedSKUs};
}
function requestDiagnostic(error){
 const stage=error?.requestStage,ordinal=error?.requestOrdinal,requests=error?.requests,bytes=error?.totalBytes,status=error?.status??null,url=error?.sourceResponseUrl;
 if(!["filters","products"].includes(stage)||!Number.isSafeInteger(ordinal)||ordinal<1||ordinal>48||!Number.isSafeInteger(requests)||requests<0||requests>48||!Number.isSafeInteger(bytes)||bytes<0||bytes>30*1024*1024||status!==null&&(!Number.isSafeInteger(status)||status<100||status>599)||typeof url!=="string"||url.length>512)return null;
 try{if(Client.allowedUrl(url)!==url||new URL(url).pathname!=="/shop/api/"+stage)return null;}catch{return null;}
 return{requestStage:stage,requestOrdinal:ordinal,status,requests,totalBytes:bytes,sourceResponseUrl:url};
}
function errorCode(error){const code=error?.code||error?.message;return typeof code==="string"&&/^rewe-[a-z0-9-]{1,200}$/.test(code)?code:"rewe-refresh-failed";}
function privateFailure(error){const code=errorCode(error),diagnostic=requestDiagnostic(error);return diagnostic?JSON.stringify({v:1,code,request:diagnostic}):code;}
function publicFailure(value){
 if(typeof value!=="string")return{lastError:null,lastFailureRequest:null};
 if(!/^[\s]*[\[{]/.test(value))return{lastError:/^rewe-[a-z0-9-]{1,200}$/.test(value)?value:"rewe-refresh-diagnostic-invalid",lastFailureRequest:null};
 try{const parsed=JSON.parse(value);if(!parsed||Array.isArray(parsed)||Object.keys(parsed).sort().join(",")!=="code,request,v"||parsed.v!==1||typeof parsed.code!=="string"||!/^rewe-[a-z0-9-]{1,200}$/.test(parsed.code)||!parsed.request||Object.keys(parsed.request).sort().join(",")!=="requestOrdinal,requestStage,requests,sourceResponseUrl,status,totalBytes")throw Error();const request=requestDiagnostic(parsed.request);if(!request)throw Error();return{lastError:parsed.code,lastFailureRequest:request};}catch{return{lastError:"rewe-refresh-diagnostic-invalid",lastFailureRequest:null};}
}
async function sourceState(writer,store,final){
 if(store!==Store)return(await store.loadAll(writer))[SOURCE]||null;
 if(!final)return(await Store.loadAll(writer))[SOURCE]||null;
 // The source schema was prepared before BEGIN. Read and lock the actual lease
 // on this assigned client, without a second pool connection or in-TX DDL.
 const result=await writer.query('SELECT last_attempt_at AS "lastAttemptAt",consecutive_failures AS "consecutiveFailures",lease_owner AS "leaseOwner",lease_until AS "leaseUntil",next_attempt_at AS "nextAttemptAt" FROM price_source_refresh_state WHERE source_name=$1 FOR UPDATE',[SOURCE]);
 return result.rows[0]?Store.row(result.rows[0]):null;
}
async function permission(writer,owner,now,deps,final=false){
 if(typeof deps.shouldContinue==="function"&&await deps.shouldContinue()!==true)return{allowed:false,reason:"server-stopping",nextAttemptAt:new Date(clock(now)+CONTINUATION_MS).toISOString()};
 const time=clock(now),catalog=await readState(writer),shared=await sourceState(writer,deps.store||Store,final);let pause=0;
 const catalogRetry=catalog.retryAfter==null?0:new Date(catalog.retryAfter).getTime();if(!Number.isFinite(catalogRetry))throw fail("rewe-source-cooldown-invalid");pause=Math.max(pause,catalogRetry);
 if(shared){const failures=shared.consecutiveFailures??0;if(!Number.isSafeInteger(failures)||failures<0)throw fail("rewe-source-state-invalid");if(failures){const attempt=shared.lastAttemptAt==null?NaN:new Date(shared.lastAttemptAt).getTime(),next=shared.nextAttemptAt==null?0:new Date(shared.nextAttemptAt).getTime();if(!Number.isFinite(attempt)||!Number.isFinite(next))throw fail("rewe-source-state-invalid");pause=Math.max(pause,attempt+Backoff.delayMs(shared),next);}}
 if(pause>time)return{allowed:false,reason:"source-cooldown",nextAttemptAt:new Date(pause).toISOString()};
 const until=shared?.leaseUntil==null?NaN:new Date(shared.leaseUntil).getTime();
 if(!shared||shared.leaseOwner!==owner||!Number.isFinite(until)||until<=time)return{allowed:false,reason:"source-lease-not-owned",nextAttemptAt:new Date(time+CONTINUATION_MS).toISOString()};
 return{allowed:true};
}
async function begin(pool){
 const tx=await pool.connect();if(!tx||tx===pool||typeof tx.query!=="function"||typeof tx.release!=="function")throw fail("rewe-refresh-transaction-client-required");
 try{await tx.query("BEGIN");await tx.query("SELECT txid_current()");await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[SOURCE+":checkpoint"]);return tx;}catch(error){try{await tx.query("ROLLBACK");tx.release();}catch(rollback){tx.release(rollback);}throw error;}
}
async function rollback(tx,error){let releaseError;try{await tx.query("ROLLBACK");}catch(failure){releaseError=failure;if(error)error.rollbackErrorCode=String(failure.code||"rewe-refresh-rollback-failed").slice(0,150);}tx.release(releaseError);}
async function checkpoint(tx,collected,expected,time){
 const query=`INSERT INTO ${TABLE}(source_id,cursor,last_completed_at,completed_cycles,category_count,categories_completed,pages_fetched,received_cumulative,assortment_hash,last_error,retry_after,updated_at) VALUES($1,$2::jsonb,CASE WHEN $3 THEN $4::timestamptz ELSE NULL END,CASE WHEN $3 THEN 1 ELSE 0 END,$5,$6,$7,$8,$9,NULL,NULL,$4) ON CONFLICT(source_id) DO UPDATE SET cursor=EXCLUDED.cursor,last_completed_at=CASE WHEN $3 THEN EXCLUDED.last_completed_at ELSE ${TABLE}.last_completed_at END,completed_cycles=${TABLE}.completed_cycles+CASE WHEN $3 THEN 1 ELSE 0 END,category_count=EXCLUDED.category_count,categories_completed=EXCLUDED.categories_completed,pages_fetched=EXCLUDED.pages_fetched,received_cumulative=EXCLUDED.received_cumulative,assortment_hash=EXCLUDED.assortment_hash,last_error=NULL,retry_after=NULL,updated_at=EXCLUDED.updated_at WHERE $10::text IS NOT NULL AND ${TABLE}.xmin::text=$10`;
 const saved=await tx.query(query,[SOURCE,JSON.stringify(collected.complete?null:collected.nextCursor),collected.complete,new Date(time).toISOString(),collected.categoryCount,collected.categoriesCompleted,collected.pagesFetched,collected.receivedCumulative,collected.assortmentHash,expected.checkpointVersion??null]);
 if(saved.rowCount!==1)throw fail("rewe-checkpoint-moved");
}
async function recordFailure(pool,error,expected,now,deps,owner){
 const time=clock(now),retry=Number(error.retryAfterMs),cooldown=Math.max(REFRESH_MS,Number.isFinite(retry)&&retry>0?retry:3600000),nextAttemptAt=new Date(Math.min(8640000000000000,time+cooldown)).toISOString(),code=String(error.code||error.message||"rewe-refresh-failed").slice(0,300),reset=/continuation-cursor-conflict|native-assortment-conflict|native-category-pagination-count-drift/.test(code);
 error.nextAttemptAt=nextAttemptAt;error.failureCheckpointPersisted=false;let tx;
 try{tx=await begin(pool);const current=await readState(tx,true);if(checkpointKey(current)!==checkpointKey(expected)){await rollback(tx);tx=null;return;}
  const gate=await permission(tx,owner,now,deps,true);if(!gate.allowed){await rollback(tx);tx=null;return;}
  const saved=await tx.query(`INSERT INTO ${TABLE}(source_id,last_error,retry_after,updated_at) VALUES($1,$2,$3,$5) ON CONFLICT(source_id) DO UPDATE SET last_error=EXCLUDED.last_error,retry_after=EXCLUDED.retry_after,cursor=CASE WHEN $4 THEN NULL ELSE ${TABLE}.cursor END,last_completed_at=CASE WHEN $4 THEN NULL ELSE ${TABLE}.last_completed_at END,categories_completed=CASE WHEN $4 THEN 0 ELSE ${TABLE}.categories_completed END,updated_at=EXCLUDED.updated_at WHERE $6::text IS NOT NULL AND ${TABLE}.xmin::text=$6`,[SOURCE,privateFailure(error),Store.timestampParameter(nextAttemptAt),reset,new Date(time).toISOString(),expected.checkpointVersion??null]);
  if(saved.rowCount!==1)throw fail("rewe-failure-checkpoint-moved");await tx.query("COMMIT");tx.release();tx=null;error.failureCheckpointPersisted=true;
 }catch(failure){if(tx){await rollback(tx,error);tx=null;}error.failurePersistenceErrorCode=String(failure.code||"rewe-failure-checkpoint-failed").slice(0,150);}finally{if(tx)tx.release();}
}
async function refresh({pool,maxRequests=2,now=Date.now,leaseOwner}={},deps={}){
 if(!pool||typeof pool.query!=="function")throw fail("database-required");if(typeof pool.connect!=="function"||typeof pool.release==="function")throw fail("rewe-refresh-transaction-pool-required");
 if(typeof leaseOwner!=="string"||leaseOwner.length<1||leaseOwner.length>200||leaseOwner.trim()!==leaseOwner)throw fail("rewe-source-lease-owner-required");
 if(running)return{received:0,accepted:0,skipped:"already-running"};running=true;
 try{
  const state=await load(pool),budget=Math.max(2,Math.min(48,Math.floor(Number(maxRequests)||2))),initialGate=await permission(pool,leaseOwner,now,deps);
  if(!initialGate.allowed)return{received:0,accepted:0,skipped:initialGate.reason,nextAttemptAt:initialGate.nextAttemptAt,retryAfter:initialGate.reason==="source-cooldown"?initialGate.nextAttemptAt:undefined};
  const articleService=deps.articleService||require("./rewe-retailer-article-service");await articleService.ensure(pool);await Published.ensure(pool);
  let collected,verified,lastGate={allowed:true};
  const canFetch=async()=>{lastGate=await permission(pool,leaseOwner,now,deps);return lastGate.allowed;};
  try{collected=await(deps.fetchOffers||Client.fetchOffers)({cursor:state.cursor||null,maxRequests:budget,now:()=>new Date(clock(now)).toISOString(),canFetch});verified=nativeBatch(collected,state,budget,clock(now));}
  catch(error){if(error?.code==="rewe-source-fetch-not-allowed")return{received:0,accepted:0,skipped:lastGate.reason||"source-not-eligible",nextAttemptAt:lastGate.nextAttemptAt,requests:error.requests||0};await recordFailure(pool,error,state,now,deps,leaseOwner);throw error;}
  let tx,saved,native,suppressedHeldPrices=0;
  try{
   tx=await begin(pool);const current=await readState(tx,true);if(checkpointKey(current)!==checkpointKey(state)){await rollback(tx);tx=null;return{received:0,accepted:0,requests:collected.requests,skipped:"checkpoint-changed",nextAttemptAt:new Date(clock(now)+CONTINUATION_MS).toISOString()};}
   const before=await permission(tx,leaseOwner,now,deps,true);if(!before.allowed){await rollback(tx);tx=null;return{received:0,accepted:0,requests:collected.requests,skipped:before.reason,nextAttemptAt:before.nextAttemptAt};}
   native=await(deps.persistArticles||articleService.persist)(tx,collected.originalPages,{now:clock(now)});
   if(!native||native.received!==collected.received||!Number.isSafeInteger(native.accepted)||native.accepted<0||native.accepted>native.received||!Number.isSafeInteger(native.retimedReplays)||native.retimedReplays<0)throw fail("rewe-native-article-result-unconfirmed");
   if(native.retimedReplays>0||native.retimedCaptures>0)throw fail("rewe-native-article-capture-replay-retimed");
   saved=await(deps.persist||Published.persist)(tx,verified.safeOffers,{now:clock(now),schemaEnsured:true,includeAcceptedSkus:true});
   if(!saved||!Number.isSafeInteger(saved.accepted)||saved.accepted<0||saved.accepted>verified.safeOffers.length||!Array.isArray(saved.acceptedRetailerSkus)||saved.acceptedRetailerSkus.length!==saved.accepted||new Set(saved.acceptedRetailerSkus).size!==saved.accepted||saved.acceptedRetailerSkus.some(sku=>!verified.safeOffers.some(offer=>offer.retailerSku===sku)))throw fail("rewe-native-price-result-unconfirmed");
   const suppression=await(deps.suppressHeldPrices||Published.suppressHeldArticles)(tx,{identityRejectedSKUs:verified.identityRejectedSKUs});
   if(!suppression||!Number.isSafeInteger(suppression.suppressed)||suppression.suppressed<0||!Array.isArray(suppression.retailerSkus)||suppression.retailerSkus.length!==suppression.suppressed||new Set(suppression.retailerSkus).size!==suppression.suppressed||suppression.retailerSkus.some(sku=>typeof sku!=="string"||!new RegExp("^[1-9]\\d{0,4}-[A-Z0-9]{1,40}-"+Client.NATIVE_STORE_ID+"$").test(sku)))throw fail("rewe-held-price-suppression-unconfirmed");
   suppressedHeldPrices=suppression.suppressed;
   const {acceptedRetailerSkus,...publicSaved}=saved;publicSaved.accepted-=acceptedRetailerSkus.filter(sku=>suppression.retailerSkus.includes(sku)).length;saved=publicSaved;
   await checkpoint(tx,collected,state,clock(now));
   const final=await permission(tx,leaseOwner,now,deps,true);if(!final.allowed){await rollback(tx);tx=null;return{received:0,accepted:0,requests:collected.requests,skipped:final.reason,nextAttemptAt:final.nextAttemptAt};}
   nativeBatch(collected,state,budget,clock(now));await tx.query("COMMIT");tx.release();tx=null;
  }catch(error){if(tx){await rollback(tx,error);tx=null;}if(error.code==="rewe-checkpoint-moved")return{received:0,accepted:0,requests:collected.requests,skipped:"checkpoint-changed",nextAttemptAt:new Date(clock(now)+CONTINUATION_MS).toISOString()};throw error;}finally{if(tx)tx.release();}
  return{...saved,suppressedHeldPrices,identityRejectedPrices:collected.offers.length-verified.safeOffers.length,nativeArticles:native,identityReceived:native.received,identityAccepted:native.accepted,sourceId:SOURCE,sourceRejected:collected.rejected.length,requests:collected.requests,pagesThisBatch:collected.pagesThisBatch,nextAttemptAt:collected.complete?null:new Date(clock(now)+CONTINUATION_MS).toISOString(),catalog:{publishedAssortmentComplete:collected.complete,physicalStoreAssortmentVerified:false,categoryCount:collected.categoryCount,categoriesCompleted:collected.categoriesCompleted,pagesFetched:collected.pagesFetched,receivedCumulative:collected.receivedCumulative,nextCursor:collected.complete?null:collected.nextCursor},scope:{country:"DE",channel:"pickup",city:"Berlin",nativeMarketId:Client.MARKET_ID},independentOfUserReceipts:true};
 }finally{running=false;}
}
async function resumeAt(pool,now=Date.now()){
 const state=await load(pool),retry=state.retryAfter?new Date(state.retryAfter).getTime():NaN;if(Number.isFinite(retry)&&retry>now)return new Date(retry).toISOString();const updated=state.updatedAt?new Date(state.updatedAt).getTime():NaN;return state.cursor&&!state.lastError&&Number.isFinite(updated)?new Date(updated+CONTINUATION_MS).toISOString():null;
}
async function status(pool){const state=await load(pool),{checkpointVersion,...publicState}=state;return{sourceId:SOURCE,...publicState,...publicFailure(state.lastError),publishedAssortmentComplete:!state.cursor&&!!state.lastCompletedAt&&!state.lastError&&state.categoryCount>0&&state.categoriesCompleted===state.categoryCount,physicalStoreAssortmentVerified:false,independentOfUserReceipts:true,refreshIntervalMinutes:15,continuationIntervalMinutes:1,nativeMarketId:Client.MARKET_ID,scopeCountry:"DE",scopeChannel:"pickup",city:"Berlin"};}
module.exports={SOURCE,REFRESH_MS,CONTINUATION_MS,TABLE,ensure,load,readState,refresh,status,resumeAt,confirmedProgress,nativeBatch,checkpointKey,checkpoint,requestDiagnostic,publicFailure,permission};
