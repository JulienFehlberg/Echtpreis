"use strict";
const Discovery=require("./price-query-discovery"),OpenPrices=require("./open-prices-client"),Canonical=require("./canonical-open-prices-refresh-import"),Import=require("./external-price-import");
function create(options={}){
 const cache=new Map(),pending=new Map(),now=options.now||Date.now,fetchPage=options.fetchPage||OpenPrices.fetchPage,prepare=options.prepare||Canonical.prepare,persist=options.persist||Import.persist;
 let windowStart=now(),requests=0;
 async function refresh(pool,targets=[]){
  const instant=now();if(instant-windowStart>=60000){windowStart=instant;requests=0}
  for(const [key,value]of cache)if(value.until<=instant)cache.delete(key);
  const tasks=[];
  for(const target of targets.slice(0,2)){
   if(!target||target.sourceId!=="Open Prices"||!Discovery.validGtin(target.productCode)||!Discovery.openPricesLocationId(target.locationId)||!target.storeId||!target.productId)continue;
   const locationId=Discovery.openPricesLocationId(target.locationId),key=target.productCode+"@"+locationId;
   if(cache.has(key)){tasks.push(Promise.resolve({...cache.get(key).value,cached:true}));continue}
   if(pending.has(key)){tasks.push(pending.get(key));continue}
   if(requests>=12||pending.size>=12){tasks.push(Promise.resolve({state:"deferred",reason:"refresh-budget"}));continue}
   requests++;
   const task=(async()=>{let value;try{
    const today=OpenPrices.todayBerlin(new Date(now())),input={productCode:target.productCode,locationId,today,page:1,size:100,orderBy:"-date",currency:"EUR",since:OpenPrices.normalizeInput({today}).since,timeoutMs:4500,retries:0};
    const page=await fetchPage(input),prepared=await prepare(pool,{...page,sourceUrl:page.sourceUrl||page.url},input);
    // The source's exact GTIN/OSM identity must also match the canonical pair selected for this user query.
    if(prepared.accepted.some(row=>String(row.gtin||"")!==target.productCode||Discovery.openPricesLocationId(row.externalLocationId)!==locationId||String(row.productId||"")!==String(target.productId)||String(row.storeId||"")!==String(target.storeId)))throw new Error("on-demand-canonical-target-mismatch");
    const saved=await persist(pool,prepared,{source:"Open Prices",sourceUrl:page.sourceUrl||page.url});
    value={state:"refreshed",accepted:saved.accepted||0,duplicates:saved.duplicates||0,rejected:saved.rejected||0,remainingPages:Math.max(0,(page.pages||1)-1)};
   }catch(_){value={state:"unavailable",reason:"source-unavailable"}}
   cache.set(key,{until:now()+(value.state==="unavailable"?60000:300000),value});while(cache.size>128)cache.delete(cache.keys().next().value);
   return value;
   })();
   pending.set(key,task);task.finally(()=>pending.delete(key));tasks.push(task);
  }
  return Promise.all(tasks);
 }
 return{refresh,info:()=>({entries:cache.size,inflight:pending.size,requests,maxRequestsPerMinute:12})};
}
module.exports={create};
