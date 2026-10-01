"use strict";
const assert=require("assert/strict"),Refresh=require("../dm-price-refresh");
function database(){const targets=new Map(),states={},checkpoint={};let priceWrites=0;
 return{targets,states,checkpoint,get priceWrites(){return priceWrites},query:async(sql,params=[])=>{
  if(sql.startsWith("SELECT count(*)"))return{rows:[{targets:targets.size}]};
  if(sql.startsWith("SELECT cursor"))return{rows:states.saved?[{lastCompletedAt:states.completed,cursor:states.cursor,lastError:states.error,retryAfter:states.retryAfter}]:[]};
  if(sql.startsWith("INSERT INTO retailer_refresh_targets")){for(const target of JSON.parse(params[1]))targets.set(target.retailerSku,target);return{rows:[]}}
  if(sql.startsWith("INSERT INTO retailer_discovery_state")){states.saved=true;states.cursor=JSON.parse(params[1]);states.completed=params[2]?"2026-10-01T00:00:00Z":null;return{rows:[]}}
  if(sql.startsWith("UPDATE retailer_discovery_state")){states.error=params[1];states.retryAfter=params[2];return{rows:[]}}
  if(sql.startsWith("SELECT payload"))return{rows:[...targets.values()].map(payload=>({payload}))};
  if(sql.startsWith("SELECT stream_name"))return{rows:Object.keys(checkpoint).length?[checkpoint]:[]};
  if(sql.startsWith("INSERT INTO price_refresh_checkpoints")){Object.assign(checkpoint,{cursorKey:params[1],cursorOffset:params[2],cycle:params[3],lastQueueSize:params[4],processedTotal:params[5]});return{rows:[]}}
  if(/INSERT INTO (price_observations|receipt_submissions|stores)/.test(sql))priceWrites++;return{rows:[]};
 }};
}
async function main(){
 const pool=database(),all=Array.from({length:250},(_,i)=>({retailerSku:String(1450000+i),gtin:"4070765022773"})),seen=new Set();let discoveryCalls=0,persisted=0;
 const deps={seedTargets:()=>[],discoverTargets:async opts=>{discoveryCalls++;assert.equal(opts.maxRequests,8);assert(opts.queries.includes("Reis"));return{targets:all,complete:true,received:250,requests:3}},fetchOffers:async(targets,opts)=>{assert.equal(opts.maxRequests,2);assert(targets.length<=100);for(const target of targets)seen.add(target.retailerSku);return{offers:targets.map(t=>({...t,scopeChannel:"online",price:.9})),complete:true,requests:2}},persist:async(_,offers)=>{persisted+=offers.length;return{received:offers.length,accepted:offers.length}}};
 let last;for(let i=0;i<3;i++)last=await Refresh.refresh({pool,now:()=>Date.parse("2026-10-01T01:00:00Z")},deps);
 assert.equal(discoveryCalls,1);assert.equal(seen.size,250,"All discovered retailer products must be researched, independently of app-user receipts");assert.equal(last.queuedTargets,250);assert.equal(last.independentOfUserReceipts,true);assert.equal(last.scope.channel,"online");assert.equal(pool.priceWrites,0,"Online offers must never invent physical stores or user receipts");assert.equal(persisted,300);assert.equal(pool.checkpoint.processedTotal,300);
 const before={...pool.checkpoint};await assert.rejects(()=>Refresh.refresh({pool,now:()=>Date.parse("2026-10-01T01:00:00Z")},{...deps,fetchOffers:async()=>{throw Error("source-down")}}),/source-down/);assert.deepEqual(pool.checkpoint,before,"Failure must not advance the price cursor or refresh old offers");
 // An unavailable product must not hold every later SKU behind its cursor position.
 const rotation=database(),attempts=[],oldCapture="2026-09-29T01:00:00Z",newCapture="2026-10-01T01:00:00Z";
 for(const retailerSku of["1001","1002"])rotation.targets.set(retailerSku,{retailerSku});
 const quotes=new Map([["1001",{price:.9,capturedAt:oldCapture}],["1002",{price:1.1,capturedAt:oldCapture}]]);let quoteWrites=0,persistCalls=0;
 const rotationDeps={...deps,
  discoverTargets:async()=>({targets:[],complete:true,received:0,requests:1}),
  fetchOffers:async targets=>{const target=targets[0];attempts.push(target.retailerSku);return target.retailerSku==="1001"?{offers:[],rejected:[{target,reasons:["dm-current-product-missing"]}],received:1,requests:2,complete:true}:{offers:[{...target,price:1.2,capturedAt:newCapture}],rejected:[],received:1,requests:2,complete:true}},
  persist:async(_,offers)=>{persistCalls++;for(const offer of offers){quotes.set(offer.retailerSku,{price:offer.price,capturedAt:offer.capturedAt});quoteWrites++}return{received:offers.length,accepted:offers.length,rejected:0}}
 };
 const removed=await Refresh.refresh({pool:rotation,maxTargets:1,now:()=>Date.parse(newCapture)},rotationDeps);
 assert.equal(removed.accepted,0);assert.equal(removed.sourceRejected,1);assert.equal(rotation.checkpoint.processedTotal,1);assert.equal(quoteWrites,0);assert.equal(quotes.get("1001").capturedAt,oldCapture,"A rejected SKU must not acquire a newer capture time");
 const next=await Refresh.refresh({pool:rotation,maxTargets:1,now:()=>Date.parse(newCapture)},rotationDeps);
 assert.deepEqual(attempts,["1001","1002"]);assert.equal(next.accepted,1);assert.equal(rotation.checkpoint.processedTotal,2);assert.equal(quotes.get("1002").capturedAt,newCapture);assert.equal(quoteWrites,1);
 const preservedCheckpoint={...rotation.checkpoint},preservedQuotes=structuredClone(quotes),preservedCalls=persistCalls;
 await assert.rejects(()=>Refresh.refresh({pool:rotation,maxTargets:2,now:()=>Date.parse(newCapture)},{...rotationDeps,fetchOffers:async()=>{throw Error("dm-source-http-503")}}),/dm-source-http-503/);
 assert.deepEqual(rotation.checkpoint,preservedCheckpoint);assert.deepEqual(quotes,preservedQuotes);assert.equal(persistCalls,preservedCalls);
 const partialOffer={retailerSku:"1002",price:99,capturedAt:"2026-10-01T01:01:00Z"};
 await assert.rejects(()=>Refresh.refresh({pool:rotation,maxTargets:2,now:()=>Date.parse(newCapture)},{...rotationDeps,fetchOffers:async()=>({offers:[partialOffer],rejected:[],complete:false,requests:2})}),/dm-live-offers-request-budget-incomplete/);
 assert.deepEqual(rotation.checkpoint,preservedCheckpoint,"An incomplete batch must not skip unprocessed targets");assert.deepEqual(quotes,preservedQuotes,"An incomplete batch must not extend existing quote freshness");assert.equal(persistCalls,preservedCalls,"Incomplete offers must not reach persistence");
 await assert.rejects(()=>Refresh.refresh({pool:rotation,maxTargets:2,now:()=>Date.parse(newCapture)},{...rotationDeps,fetchOffers:async()=>({offers:[partialOffer]})}),/dm-live-offers-request-budget-incomplete/);
 assert.deepEqual(rotation.checkpoint,preservedCheckpoint);assert.deepEqual(quotes,preservedQuotes);assert.equal(persistCalls,preservedCalls,"An unconfirmed completion must fail closed");
 const throttled=database();let throttleCalls=0;const throttledDeps={...deps,discoverTargets:async()=>{throttleCalls++;return{targets:all,complete:false,cursor:{page:3},partialError:"dm-source-http-429",received:250,requests:4}}};
 await Refresh.refresh({pool:throttled,now:()=>Date.parse("2026-10-01T01:00:00Z")},throttledDeps);assert.equal(throttled.states.error,"dm-source-http-429");assert.equal(throttled.states.completed,null);assert.deepEqual(throttled.states.cursor,{page:3});
 const continued=await Refresh.refresh({pool:throttled,now:()=>Date.parse("2026-10-01T01:15:00Z")},throttledDeps);assert.equal(throttleCalls,1,"Rate-limited discovery must pause for its persisted cooldown");assert.equal(continued.accepted,100,"Known retailer targets can still acquire current online prices during discovery cooldown");
 const outage=await Refresh.refresh({pool,now:()=>Date.parse("2026-10-01T09:00:00Z")},{...deps,discoverTargets:async()=>{throw Error("dm-source-http-429")}});assert.equal(outage.accepted,100,"Even a first-request discovery failure must not block a healthy current-price service for persisted targets");assert.equal(pool.states.error,"dm-source-http-429");
 await assert.rejects(()=>Refresh.refresh({pool:database()},{...deps,discoverTargets:async()=>{throw Error("dm-source-http-429")}}),/dm-discovery-no-product-targets/);
 await assert.rejects(()=>Refresh.refresh({},deps),/database-required/);console.log("dm-price-refresh: autonomous persisted discovery, removed-SKU progress, bounded rotation, online-only ingestion and incomplete/transport freshness preservation OK");
}
main().catch(error=>{console.error(error);process.exitCode=1});
