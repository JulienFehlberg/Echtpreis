"use strict";
const Client=require("./rewe-retailer-price-client"),Published=require("./rewe-retailer-price-service");
const SOURCE=Client.SOURCE,REFRESH_MS=15*60*1000,CONTINUATION_MS=60*1000,TABLE="rewe_retailer_catalog_state";
let running=false;
async function ensure(pool){
 if(!pool)throw new Error("database-required");
 await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(source_id text PRIMARY KEY,cursor jsonb,last_completed_at timestamptz,completed_cycles int NOT NULL DEFAULT 0,category_count int NOT NULL DEFAULT 0,categories_completed int NOT NULL DEFAULT 0,pages_fetched int NOT NULL DEFAULT 0,received_cumulative int NOT NULL DEFAULT 0,assortment_hash text,last_error text,retry_after timestamptz,updated_at timestamptz NOT NULL DEFAULT now());`);
}
async function load(pool){
 await ensure(pool);
 return(await pool.query(`SELECT cursor,last_completed_at AS "lastCompletedAt",completed_cycles AS "completedCycles",category_count AS "categoryCount",categories_completed AS "categoriesCompleted",pages_fetched AS "pagesFetched",received_cumulative AS "receivedCumulative",assortment_hash AS "assortmentHash",last_error AS "lastError",retry_after AS "retryAfter",updated_at AS "updatedAt" FROM ${TABLE} WHERE source_id=$1`,[SOURCE])).rows[0]||{};
}
function confirmedProgress(collected,state={}){
 if(!collected||!Array.isArray(collected.offers)||typeof collected.complete!=="boolean"||!Number.isSafeInteger(collected.categoryCount)||collected.categoryCount<1||!Number.isSafeInteger(collected.categoriesCompleted)||collected.categoriesCompleted<0||collected.categoriesCompleted>collected.categoryCount||collected.complete!==(collected.categoriesCompleted===collected.categoryCount)||!Number.isSafeInteger(collected.pagesFetched)||collected.pagesFetched<1||!Number.isSafeInteger(collected.receivedCumulative??collected.received)||(collected.receivedCumulative??collected.received)<0||!/^[a-f0-9]{64}$/.test(collected.assortmentHash||""))throw new Error("rewe-catalog-progress-unconfirmed");
 if(collected.stalled||collected.pagesFetched<=(state.cursor?.pagesFetched||0)||(collected.receivedCumulative??collected.received)<(state.cursor?.received||0)||collected.categoriesCompleted<(state.cursor?.categoryIndex||0))throw new Error("rewe-catalog-progress-stalled");
 if(state.cursor&&state.cursor.assortmentHash!==collected.assortmentHash)throw new Error("rewe-native-assortment-conflict");
 if(collected.complete){if(collected.nextCursor!=null)throw new Error("rewe-catalog-progress-unconfirmed");return;}
 const cursor=collected.nextCursor;
 if(!cursor||typeof cursor!=="object"||Array.isArray(cursor)||cursor.version!==1||cursor.nativeMarketId!==Client.MARKET_ID||cursor.scopeChannel!=="pickup"||cursor.serviceType!=="PICKUP"||cursor.assortmentHash!==collected.assortmentHash||cursor.categoryIndex!==collected.categoriesCompleted||cursor.pagesFetched!==collected.pagesFetched||cursor.received!==(collected.receivedCumulative??collected.received)||!Number.isSafeInteger(cursor.pageNumber)||cursor.pageNumber<1)throw new Error("rewe-catalog-progress-unconfirmed");
}
async function refresh({pool,maxRequests=16,now=Date.now}={},deps={}){
 if(!pool)throw new Error("database-required");
 if(running)return{received:0,accepted:0,skipped:"already-running"};
 running=true;
 try{
  const state=await load(pool),time=now();
  if(state.retryAfter&&time<new Date(state.retryAfter).getTime())return{received:0,accepted:0,skipped:"source-cooldown",retryAfter:state.retryAfter};
  let collected;
  try{
   collected=await(deps.fetchOffers||Client.fetchOffers)({cursor:state.cursor||null,maxRequests:Math.max(2,Math.min(48,Math.floor(Number(maxRequests)||16))),now:()=>new Date(now()).toISOString()});
   confirmedProgress(collected,state);
  }catch(error){
   const code=String(error.code||error.message||error).slice(0,300),retry=Number(error.retryAfterMs),cooldown=Math.max(REFRESH_MS,Number.isFinite(retry)&&retry>0?retry:3600000);
   const reset=/continuation-cursor-conflict|native-assortment-conflict|native-category-pagination-count-drift/.test(code);
   const nextAttemptAt=new Date(time+cooldown).toISOString();
   await pool.query(`INSERT INTO ${TABLE}(source_id,last_error,retry_after) VALUES($1,$2,$3) ON CONFLICT(source_id) DO UPDATE SET last_error=EXCLUDED.last_error,retry_after=EXCLUDED.retry_after,cursor=CASE WHEN $4 THEN NULL ELSE ${TABLE}.cursor END,last_completed_at=CASE WHEN $4 THEN NULL ELSE ${TABLE}.last_completed_at END,categories_completed=CASE WHEN $4 THEN 0 ELSE ${TABLE}.categories_completed END,updated_at=now()`,[SOURCE,code,nextAttemptAt,reset]);
   throw Object.assign(error instanceof Error?error:new Error(code),{nextAttemptAt});
  }
  const saved=await(deps.persist||Published.persist)(pool,collected.offers,{now:now()});
  // Never move past a page until its validated quotes have been written successfully.
  await pool.query(`INSERT INTO ${TABLE}(source_id,cursor,last_completed_at,completed_cycles,category_count,categories_completed,pages_fetched,received_cumulative,assortment_hash,last_error,retry_after) VALUES($1,$2::jsonb,CASE WHEN $3 THEN $4::timestamptz ELSE NULL END,CASE WHEN $3 THEN 1 ELSE 0 END,$5,$6,$7,$8,$9,NULL,NULL) ON CONFLICT(source_id) DO UPDATE SET cursor=EXCLUDED.cursor,last_completed_at=CASE WHEN $3 THEN EXCLUDED.last_completed_at ELSE ${TABLE}.last_completed_at END,completed_cycles=${TABLE}.completed_cycles+CASE WHEN $3 THEN 1 ELSE 0 END,category_count=EXCLUDED.category_count,categories_completed=EXCLUDED.categories_completed,pages_fetched=EXCLUDED.pages_fetched,received_cumulative=EXCLUDED.received_cumulative,assortment_hash=EXCLUDED.assortment_hash,last_error=NULL,retry_after=NULL,updated_at=now()`,[SOURCE,JSON.stringify(collected.complete?null:collected.nextCursor),collected.complete,new Date(now()).toISOString(),collected.categoryCount,collected.categoriesCompleted,collected.pagesFetched,collected.receivedCumulative??collected.received,collected.assortmentHash]);
  return{...saved,sourceId:SOURCE,sourceRejected:collected.rejected?.length||0,requests:collected.requests,nextAttemptAt:collected.complete?null:new Date(now()+CONTINUATION_MS).toISOString(),catalog:{publishedAssortmentComplete:collected.complete,physicalStoreAssortmentVerified:false,categoryCount:collected.categoryCount,categoriesCompleted:collected.categoriesCompleted,pagesFetched:collected.pagesFetched,receivedCumulative:collected.receivedCumulative??collected.received,nextCursor:collected.complete?null:collected.nextCursor},scope:{country:"DE",channel:"pickup",city:"Berlin",nativeMarketId:Client.MARKET_ID},independentOfUserReceipts:true};
 }finally{running=false;}
}
async function resumeAt(pool,now=Date.now()){
 const state=await load(pool),retry=state.retryAfter?new Date(state.retryAfter).getTime():NaN;
 if(Number.isFinite(retry)&&retry>now)return new Date(retry).toISOString();
 const updated=state.updatedAt?new Date(state.updatedAt).getTime():NaN;
 return state.cursor&&!state.lastError&&Number.isFinite(updated)?new Date(updated+CONTINUATION_MS).toISOString():null;
}
async function status(pool){
 const state=await load(pool);
 return{sourceId:SOURCE,...state,publishedAssortmentComplete:!state.cursor&&!!state.lastCompletedAt&&!state.lastError&&state.categoryCount>0&&state.categoriesCompleted===state.categoryCount,physicalStoreAssortmentVerified:false,independentOfUserReceipts:true,refreshIntervalMinutes:15,continuationIntervalMinutes:1,nativeMarketId:Client.MARKET_ID,scopeCountry:"DE",scopeChannel:"pickup",city:"Berlin"};
}
module.exports={SOURCE,REFRESH_MS,CONTINUATION_MS,ensure,refresh,status,resumeAt,confirmedProgress};
