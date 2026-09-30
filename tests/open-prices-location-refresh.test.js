const assert=require("assert"),R=require("../open-prices-location-refresh"),Locations=require("../open-prices-locations"),Catalog=require("../external-location-catalog"),Runner=require("../price-refresh-runner");
(async()=>{
 let calls=0;const queries=[],pool={query:async(sql,args=[])=>{queries.push({sql,args});if(sql.includes("RETURNING consecutive_failures"))return{rows:[{consecutive_failures:1}],rowCount:1};return{rows:[],rowCount:1}}};const fetchImpl=async()=>{calls++;if(calls<=3)throw new Error("network-down");return{ok:true,json:async()=>({page:1,pages:1,total:0,items:[]})}};const x=await R.refresh({pool,areas:[{key:"bad",lat:52,lon:13},{key:"good",lat:53,lon:13}],fetchImpl});assert.strictEqual(x.failedAreas,1);assert.strictEqual(x.succeededAreas,1);
 const originalNearby=Locations.nearby,originalUpsert=Catalog.upsert,areas=[{key:"area-a",lat:52,lon:13},{key:"area-b",lat:53,lon:13}];
 try{
  queries.length=0;Locations.nearby=async area=>{throw new Error("location-network-down-"+area.key)};Catalog.upsert=async()=>({upserted:0});
  await assert.rejects(()=>R.refresh({pool,areas}),error=>{assert(error instanceof AggregateError);assert.strictEqual(error.code,"open-prices-location-refresh-all-failed");assert.strictEqual(error.errors.length,2);assert.strictEqual(error.result.failedAreas,2);assert.strictEqual(error.result.succeededAreas,0);return true});
  assert.strictEqual(queries.filter(q=>q.sql.includes("RETURNING consecutive_failures")).length,2,"Every failed area must retain its failure and cooldown state");assert(queries.at(-1).sql.includes("SET cooldown_until"),"Failure bookkeeping must complete before complete failure is reported");
  const runner=await Runner.runOne("Open Prices locations",{}, {"Open Prices locations":()=>R.refresh({pool,areas})},{force:true});assert.strictEqual(runner.ok,false);assert.strictEqual(runner.state.consecutiveFailures,1);assert.strictEqual(runner.state.lastSuccessAt,undefined);
  Locations.nearby=async area=>{if(area.key==="area-a")throw new Error("one-area-down");return{items:[]}};const partial=await R.refresh({pool,areas});assert.strictEqual(partial.failedAreas,1);assert.strictEqual(partial.succeededAreas,1);assert.strictEqual(partial.received,0,"A successful empty area response must prevent an all-failed alert");
  Locations.nearby=async()=>({items:[]});const empty=await R.refresh({pool,areas:[areas[0]]});assert.strictEqual(empty.succeededAreas,1);assert.strictEqual(empty.failedAreas,0);assert.strictEqual((await R.refresh({pool,areas:[]})).areas,0);
 }finally{Locations.nearby=originalNearby;Catalog.upsert=originalUpsert}
 console.log("open-prices-location-refresh: mixed results, complete failure propagation after bookkeeping and successful empty areas OK");
})().catch(e=>{console.error(e);process.exit(1)});
