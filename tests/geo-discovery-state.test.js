"use strict";
const assert=require("assert"),S=require("../geo-discovery-state"),Grid=require("../geo-discovery-grid"),Adaptive=require("../geo-adaptive-discovery"),Runner=require("../geo-discovery-runner"),Refresh=require("../open-prices-location-refresh");
const NOW=Date.parse("2026-10-01T18:00:00.123Z"),SOURCE="Open Prices";
function database(initial=[]){
 const cells=initial.map(cell=>({source:SOURCE,lastScannedAt:null,lastReceived:0,lastAccepted:0,scanCount:0,parentKey:null,cooldownUntil:null,...cell})),calls=[];
 const pool={cells,calls,query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith("CREATE"))return{rows:[]};
  if(sql.startsWith("INSERT")){
   const exists=cells.some(cell=>cell.source===args[0]&&cell.key===args[1]);
   if(!exists)cells.push({source:args[0],key:args[1],lat:args[2],lon:args[3],radiusKm:args[4],parentKey:args[5],lastScannedAt:null,lastReceived:0,lastAccepted:0,scanCount:0,cooldownUntil:null});
   return{rows:[],rowCount:exists?0:1};
  }
  if(sql.startsWith("SELECT")||sql.startsWith("WITH RECURSIVE")){
   const scoped=sql.startsWith("WITH RECURSIVE"),sourceRows=cells.filter(cell=>cell.source===args[0]);let candidates=sourceRows;
   if(scoped){
    assert.equal(args.length,3);assert(Array.isArray(args[2]));
    assert(sql.includes("parent_key IS NULL AND cell_key=ANY($3::text[])"));assert(sql.includes("WHERE child.source_id=$1"));assert(sql.includes("UNION\n"));assert(!sql.includes("UNION ALL"));
    const keys=new Set(sourceRows.filter(cell=>cell.parentKey===null&&args[2].includes(cell.key)).map(cell=>cell.key));let changed=true;
    while(changed){changed=false;for(const cell of sourceRows)if(cell.key.startsWith("adaptive:")&&keys.has(cell.parentKey)&&!keys.has(cell.key)){keys.add(cell.key);changed=true}}
    candidates=sourceRows.filter(cell=>keys.has(cell.key));
   }
   if(sql.includes("cooldown_until<=now()"))candidates=candidates.filter(cell=>!cell.cooldownUntil||new Date(cell.cooldownUntil).getTime()<=NOW);
   if(sql.includes("AND scan_count>0")){
    candidates=candidates.filter(cell=>cell.scanCount>0).sort((a,b)=>b.lastReceived-a.lastReceived||(new Date(b.lastScannedAt).getTime()-new Date(a.lastScannedAt).getTime())||a.key.localeCompare(b.key));
   }else candidates.sort((a,b)=>(a.lastScannedAt===null?-Infinity:new Date(a.lastScannedAt).getTime())-(b.lastScannedAt===null?-Infinity:new Date(b.lastScannedAt).getTime())||a.scanCount-b.scanCount||a.key.localeCompare(b.key));
   return{rows:candidates.slice(0,args[1]).map(({source,cooldownUntil,...cell})=>({...cell}))};
  }
  if(sql.startsWith("UPDATE")){
   const cell=cells.find(value=>value.source===args[0]&&value.key===args[1]);if(cell){cell.lastScannedAt=new Date(NOW);cell.lastReceived=args[2];cell.lastAccepted=args[3];cell.scanCount++}
   return{rows:[],rowCount:cell?1:0};
  }
  throw new Error("unexpected-query");
 }};return pool;
}
function productive(cell,extra={}){return{...cell,lastScannedAt:new Date(NOW-60000),scanCount:1,lastReceived:20,lastAccepted:8,...extra}}
function keys(rows){return rows.map(cell=>cell.key).sort()}
(async()=>{
 const legacy=database();assert.equal(await S.seed(legacy,SOURCE,[{key:"a",lat:1,lon:2,radiusKm:5}]),1);assert.equal(await S.seed(legacy,SOURCE,[{key:"a",lat:1,lon:2,radiusKm:5}]),0);assert.equal((await S.next(legacy,SOURCE,5)).length,1);
 await S.mark(legacy,SOURCE,"a",{received:3,accepted:2});assert.equal(legacy.cells[0].scanCount,1);assert.equal((await S.scanned(legacy,SOURCE,5))[0].lastAccepted,2);
 await S.next(legacy,SOURCE,99999);assert.equal(legacy.calls.at(-1).args[1],500);await S.scanned(legacy,SOURCE,99999);assert.equal(legacy.calls.at(-1).args[1],10000);assert(!legacy.calls.at(-1).sql.includes("WITH RECURSIVE"));

 const berlin=Grid.preset("berlin"),germany=Grid.preset("germany"),root=berlin[0],child=Adaptive.children(root)[0],grandchild=Adaptive.children(child)[0],other=germany[0],cooled={...Adaptive.children(root)[1],cooldownUntil:new Date(NOW+60000)},unrelated={key:"legacy-inside-berlin",lat:52.5,lon:13.4,radiusKm:6};
 assert(child.lat<Grid.PRESETS.berlin.minLat&&child.lon<Grid.PRESETS.berlin.minLon,"Legitimate boundary descendants extend outside the preset bounding rectangle");
 const db=database([productive(root),productive(child),productive(grandchild),productive(cooled),productive(other),productive(unrelated),productive({...root,source:"Foreign source"},{lastReceived:99999}),productive({...Adaptive.children(root)[2],source:"Foreign source"},{lastReceived:99999}),productive({key:"adaptive:cycle-a",parentKey:"adaptive:cycle-b",lat:52.5,lon:13.4,radiusKm:3}),productive({key:"adaptive:cycle-b",parentKey:"adaptive:cycle-a",lat:52.5,lon:13.4,radiusKm:3})]),scope={rootKeys:berlin.map(cell=>cell.key)};
 assert.deepEqual(keys(await S.next(db,SOURCE,10,scope)),keys([root,child,grandchild]));
 const beforeLimit=await S.scanned(db,SOURCE,10,scope);assert.equal((await S.scanned(db,SOURCE,1,scope))[0].key,beforeLimit[0].key,"Scope filtering precedes bounded density ordering");assert.deepEqual(keys(beforeLimit),keys([root,child,grandchild]));
 assert.equal((await S.next(db,SOURCE,10)).some(cell=>cell.key===other.key),true,"Legacy unscoped calls still include other regions");
 assert.deepEqual(await S.next(db,SOURCE,10,{rootKeys:[]}),[]);assert.deepEqual(await S.scanned(db,SOURCE,10,{rootKeys:[]}),[]);assert.equal(db.calls.at(-1).args[2].length,0,"An empty scope must reach SQL as an empty bound array");
 const impostor=database([{...root,parentKey:other.key},child]);assert.deepEqual(await S.next(impostor,SOURCE,10,{rootKeys:[root.key]}),[],"A root key attached to a different lineage is not a selected preset root");
 const injected="root'); DROP TABLE arbitrary; --",bound=database([{key:injected,lat:52,lon:13,radiusKm:6}]);assert.equal((await S.next(bound,SOURCE,1,{rootKeys:[injected]})).length,1);assert(!bound.calls.at(-1).sql.includes(injected));assert.deepEqual(bound.calls.at(-1).args,[SOURCE,1,[injected]]);
 for(const bad of [null,[],{}, {rootKeys:"berlin"},{rootKeys:["a","a"]},{rootKeys:[""]},{rootKeys:[" a"]},{rootKeys:["a".repeat(129)]},{rootKeys:["a"],region:"berlin"},{rootKeys:Array.from({length:2001},(_,i)=>"root:"+i)}]){const before=db.calls.length;await assert.rejects(()=>S.next(db,SOURCE,10,bad),/invalid-geo-discovery-scope/);assert.equal(db.calls.length,before)}
 for(const bad of [0,-1,501,Infinity,1.5,"2"]){const before=db.calls.length;await assert.rejects(()=>S.next(db,SOURCE,bad,scope),/invalid-geo-discovery-limit/);assert.equal(db.calls.length,before)}
 await assert.rejects(()=>S.scanned(db,SOURCE,10001,scope),/invalid-geo-discovery-limit/);

 const originalRefresh=Refresh.refresh;let lastAreas=[];
 try{
  Refresh.refresh=async({areas,fetchImpl})=>{lastAreas=areas;assert.equal(typeof fetchImpl,"function");return{received:0,accepted:0,areas:areas.length}};
  const noNetwork=()=>{throw new Error("unexpected-network-request")},untouchedOutside=structuredClone(db.cells.filter(cell=>[other.key,unrelated.key,cooled.key].includes(cell.key)));
  db.calls.length=0;const result=await Runner.refresh({pool:db,limit:500,fetchImpl:noNetwork});assert.equal(result.preset,"berlin");assert.equal(result.baseCells,berlin.length);assert.equal(result.adaptiveScanTruncated,false);assert(result.adaptiveCandidates>0);
  assert(!lastAreas.some(cell=>[other.key,unrelated.key,cooled.key].includes(cell.key)));assert(lastAreas.some(cell=>cell.key===child.key),"The runner includes actual descendants even outside geographic bounds");
  assert.deepEqual(db.cells.filter(cell=>[other.key,unrelated.key,cooled.key].includes(cell.key)),untouchedOutside,"Regional selection must not delete/reset outside cells or cooldowns");
  for(const query of db.calls.filter(call=>call.sql.startsWith("WITH RECURSIVE"))){assert.equal(query.args[0],SOURCE);assert.deepEqual(query.args[2],scope.rootKeys)}
  const invalidDb=database();for(const preset of ["unknown","constructor","__proto__",{},null])await assert.rejects(()=>Runner.refresh({pool:invalidDb,preset,fetchImpl:noNetwork}),/unknown-grid-preset/);await assert.rejects(()=>Runner.refresh({pool:invalidDb,preset:"berlin",limit:501,fetchImpl:noNetwork}),/invalid-geo-discovery-limit/);assert.equal(invalidDb.calls.length,0,"Invalid presets and limits fail before seeding or querying");
  const germanyDb=database([other,root]);const national=await Runner.refresh({pool:germanyDb,preset:"germany",limit:500,fetchImpl:noNetwork});assert.equal(national.baseCells,germany.length);assert(lastAreas.some(cell=>cell.key===other.key));assert(!lastAreas.some(cell=>cell.key===root.key));assert(germanyDb.calls.filter(call=>call.sql.startsWith("WITH RECURSIVE")).every(call=>call.args[2].length===germany.length));
  const coolingParent=productive(root,{cooldownUntil:new Date(NOW+60000)}),coolingDb=database([coolingParent]);const originalCooling=structuredClone(coolingDb.cells[0]);const cooling=await Runner.refresh({pool:coolingDb,limit:500,fetchImpl:noNetwork});assert.equal(cooling.adaptiveCandidates,0,"A cooling parent cannot produce substitute child requests");assert(!lastAreas.some(cell=>cell.key===root.key));assert.deepEqual(coolingDb.cells[0],originalCooling);
  const many=Array.from({length:1001},(_,i)=>productive({key:"adaptive:many:"+i,parentKey:root.key,lat:52.5,lon:13.4,radiusKm:1})),largeDb=database([root,...many,productive(other,{lastReceived:999999})]);const bounded=await Runner.refresh({pool:largeDb,limit:1,fetchImpl:noNetwork});assert.equal(bounded.adaptiveScanTruncated,true);assert.equal(bounded.adaptiveScanLimit,1000);assert.equal(bounded.adaptiveCandidates,0);assert.equal(largeDb.calls.find(call=>call.sql.includes("AND scan_count>0")).args[1],1001);assert.equal(bounded.selectedCells,1);assert.equal(bounded.complete,undefined,"A bounded adaptive sample must not imply regional discovery completeness");
 }finally{Refresh.refresh=originalRefresh}
 console.log("geo-discovery-state: bound recursive preset ancestry, legacy compatibility, cooldowns and Berlin/Germany runner scopes OK");
})().catch(error=>{console.error(error);process.exit(1)});
