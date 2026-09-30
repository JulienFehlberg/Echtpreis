"use strict";
const assert=require("assert/strict"),Demand=require("../current-price-on-demand");
(async()=>{
 let time=1000,calls=0,saved=[],release;
 const target={sourceId:"Open Prices",productCode:"3017620422003",productId:"p",storeId:"s",locationId:"12"};
 const refresh=Demand.create({now:()=>time,fetchPage:async input=>{calls++;assert.equal(input.retries,0);assert.equal(input.timeoutMs,4500);if(release)await release;return{url:"https://example.test/",pages:3,accepted:[{gtin:target.productCode,externalLocationId:"openprices:12"},{gtin:target.productCode,externalLocationId:"openprices:99"},{gtin:"4008400401627",externalLocationId:"openprices:12"}],rejected:[]}},persist:async(_pool,page)=>{saved.push(page.accepted);return{accepted:page.accepted.length,duplicates:0}}});
 let result=await refresh.refresh({},[target]);assert.equal(calls,1);assert.equal(saved[0].length,1);assert.equal(result[0].remainingPages,2);
 result=await refresh.refresh({},[target]);assert.equal(calls,1);assert.equal(result[0].cached,true);
 time+=300001;let end;release=new Promise(resolve=>end=resolve);const a=refresh.refresh({},[target]),b=refresh.refresh({},[target]);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);end();await Promise.all([a,b]);release=null;
 await refresh.refresh({},[{...target,productCode:"12345678"},{...target,sourceId:"retailer"}]);assert.equal(calls,2);
 for(let i=0;i<20;i++)await refresh.refresh({},[{...target,locationId:String(100+i)}]);assert.equal(refresh.info().requests,12);assert.equal(refresh.info().inflight,0);
 const broken=Demand.create({now:()=>time,fetchPage:async()=>{throw Error("upstream")},persist:async()=>{throw Error("should never persist")}});assert.equal((await broken.refresh({},[target]))[0].state,"unavailable");assert.equal((await broken.refresh({},[target]))[0].cached,true);
 console.log("current-price-on-demand: bounded exact-pair refresh, cache, deduplication, backoff and request budget OK");
})().catch(error=>{console.error(error);process.exitCode=1});
