"use strict";
const assert=require("assert/strict");
const Inventory=require("../price-inventory-service");
const Auth=require("../price-admin-auth");
const Import=require("../external-price-import");
const Client=require("../open-prices-inventory-client"),Canonical=require("../canonical-inventory-import"),State=require("../price-refresh-state-store");
const stamp=Date.parse("2026-09-30T12:00:00Z");
assert.equal(Inventory.due(null,stamp),true);
assert.equal(Inventory.due({status:"finished",finishedAt:"2026-09-30T11:30:00Z"},stamp),false);
assert.equal(Inventory.due({status:"partial",finishedAt:"2026-09-30T11:58:00Z"},stamp),true,"An unfinished bounded scan must resume without waiting an hour");
assert.equal(Inventory.due({status:"failed",finishedAt:"2026-09-30T11:58:00Z"},stamp),false,"A failed upstream must not be hammered each minute");
assert.equal(Inventory.due({status:"failed",finishedAt:"2026-09-30T11:54:00Z"},stamp),true);
assert.equal(Inventory.due({status:"partial",finishedAt:new Date(stamp-60000+123)},stamp),false,"PostgreSQL Date objects must retain milliseconds at the continuation boundary");
const env={SPARKORB_INVENTORY_TOKEN:"inventory-only"};
for(const url of ["/v1/price-missions/verify","/v1/admin/open-prices/import","/v1/admin/product-store-coverage"]){const req={method:"POST",url,headers:{authorization:"Bearer inventory-only"}};assert.equal(Auth.protectedRoute(req),true);assert.equal(Auth.authorized(req,env),false)}
const req={method:"POST",url:"/v1/admin/price-inventory/refresh",headers:{authorization:"Bearer inventory-only"}};
assert.equal(Auth.authorized(req,env),true);assert.equal(Auth.authorized(req,{}),false);
assert.equal(Import.observation({price:5,per:"kg",product:"Known 250 g pack"},"batch").per,"kg","A unit-price observation must keep its basis until the resolver derives the package price");
assert.equal(Import.observation({price:5,product:"Known pack"},"batch").per,"item");
function fakePool(previous=null){
 const state={last:previous,queries:[],runs:[]},result=rows=>({rows,rowCount:rows.length});
 async function query(sql,args=[]){
  state.queries.push({sql,args});
  if(sql.includes("CREATE TABLE"))return result([]);
  if(sql.startsWith("SELECT id,source,country"))return result(state.last?[state.last]:[]);
  if(sql.startsWith("INSERT INTO price_inventory_runs")){const run={id:args[0],source:args[1],country:"DE",since:args[2],until:args[3],cursor:JSON.parse(args[4]),result:JSON.parse(args[5]),status:"running",startedAt:new Date(),finishedAt:null,error:null};state.runs.push(run);state.last=run;return result([])}
  if(sql.startsWith("UPDATE price_inventory_runs")){const run=state.runs.find(x=>x.id===args[0]);assert(run);if(sql.includes("status='failed'")){run.status="failed";run.error=args[1]}else{run.status=args[1];run.cursor=JSON.parse(args[2]);run.result=JSON.parse(args[3]);run.error=args[4]}run.finishedAt=new Date();return result([])}
  if(sql.startsWith("INSERT INTO price_source_registry")){assert(sql.includes("Regional price inventory"));assert(sql.includes("notes=EXCLUDED.notes"));return result([])}
  if(sql.startsWith("SELECT p.id AS"))return result(sql.includes("lower(btrim(s.city))")?[]:[{city:"München",date:"2026-09-30"}]);
  if(sql.includes("current_observations")){if(sql.includes("lower(btrim(s.city))")){assert.deepEqual(args.slice(2),[Client.BERLIN.minLat,Client.BERLIN.maxLat,Client.BERLIN.minLon,Client.BERLIN.maxLon]);return result([{stores:1,current_observations:0,current_products:0,current_stores:0,reviewed_observations:0}])}return result([{products:10,stores:2,current_observations:3,current_products:2,current_stores:1,reviewed_observations:0}])}
  throw Error("Unexpected fixture SQL: "+sql);
 }
 return{state,query};
}
const today="2026-09-30",since="2026-09-23",geo=Client.scopeMetadata("Berlin").geo;
function nativeRow(id,patch={}){return{id,type:"PRODUCT",product_code:"3017620422003",product:{code:"3017620422003",product_name:"Nutella",brands:"Ferrero",quantity:"450 g"},location_id:12,location:{id:12,type:"OSM",osm_id:1234567,osm_type:"NODE",osm_tag_key:"shop",osm_tag_value:"supermarket",osm_brand:"EDEKA",osm_name:"EDEKA",osm_address_country_code:"DE",osm_address_city:"Berlin",osm_lat:52.52,osm_lon:13.405},price:3,currency:"EUR",date:today,proof_id:id+80,proof:{id:id+80,type:"PRICE_TAG",draft:false,date:today,currency:"EUR",location_id:12,location_osm_id:1234567,location_osm_type:"NODE",image_md5_hash:"a".repeat(32)},price_per:"UNIT",price_is_discounted:false,duplicate_of:null,...patch}}
function response(items=[],page=1,pages=1,total=items.length){return{ok:true,status:200,json:async()=>({items,page,pages,size:100,total})}}
function previous(patch={}){return{id:"old-run",since,until:today,status:"partial",cursor:{nextPage:9,since,until:today,locationIds:""},result:{ok:true},finishedAt:new Date(Date.now()-120000),...patch}}
(async()=>{
 const original={prepare:Canonical.prepare,persist:Import.persist,acquire:State.acquire,release:State.release};let prepared=[],saved=[];
 try{
  State.acquire=async()=>true;State.release=async()=>{};
  Canonical.prepare=async(pool,rows)=>{prepared.push(rows);return{accepted:rows.map(raw=>({raw,merchant:"EDEKA",product:"Nutella",brand:"Ferrero",pack:"450 g",packAmount:450,packUnit:"g",packCount:1,region:"Berlin, DE",productId:"product-fixture",storeId:"store-fixture",gtin:raw.product_code,externalProductId:"openprices:"+raw.product_code,externalLocationId:"openprices:"+raw.location_id})),rejected:[],counts:{received:rows.length,processed:rows.length}}};
  Import.persist=async(pool,batch)=>{saved.push(batch);return{received:batch.accepted.length+batch.rejected.length,accepted:batch.accepted.length,rejected:batch.rejected.length,duplicates:0}};
  const legacy=previous({finishedAt:new Date(),status:"finished",cursor:null}),pool=fakePool(legacy),good=nativeRow(1),pot=nativeRow(2,{location:{...good.location,osm_address_city:"Potsdam"}}),unknown=nativeRow(3,{location:{...good.location,osm_address_city:undefined,osm_display_name:"EDEKA Berlin"}}),stale=nativeRow(4,{date:"2026-09-22"});
  const first=await Inventory.refresh(pool,{today,maxPages:1},{fetchImpl:async url=>{const p=new URL(url).searchParams;assert.equal(p.get("page"),"1","A recent nationwide scan must not block or resume the Berlin scan");assert.equal(p.get("lat"),"52.52");assert.equal(p.get("radius_km"),"35");assert.equal(p.get("location__type"),"OSM");assert.equal(pool.state.last.result.scope.region,"Berlin","The new run's scope is persisted before any request");return response([good,pot,unknown,stale],1,2,5)}});
  assert.equal(first.scope.region,"Berlin");assert.equal(first.scan.complete,false);assert.equal(first.scan.completenessBasis,"source-query-pagination");assert.equal(first.scan.sourceTotal,5);assert.equal(first.scan.worldwideTotal,null);assert.equal(first.scan.berlinPrices,1);assert.equal(first.assortmentComplete,false);assert.equal(first.physicalStoreAssortmentVerified,false);assert.equal(first.independentOfUserReceipts,true);assert.equal(first.cursor.nextPage,2);assert.equal(first.cursor.region,"Berlin");assert.deepEqual(prepared.pop(),[good],"Off-region or stale source data must be rejected before canonical identity writes");const persisted=saved.pop();assert.equal(persisted.accepted.length,1);assert.equal(Import.observation(persisted.accepted[0],"fixture-batch").date,good.date);assert.equal(persisted.accepted[0].proofHash,good.proof.image_md5_hash);assert.equal(first.scan.sourceRejected["location-outside-Berlin"],2);assert.equal(first.scan.sourceRejected["date-outside-window"],1);
  const restart=fakePool({...pool.state.last,finishedAt:new Date(Date.now()-120000),cursor:JSON.parse(JSON.stringify(first.cursor)),result:JSON.parse(JSON.stringify(first))});
  const next=await Inventory.refresh(restart,{today,maxPages:1},{fetchImpl:async url=>{assert.equal(new URL(url).searchParams.get("page"),"2");return response([nativeRow(5)],2,2,5)}});assert.equal(next.scan.complete,true);assert.equal(next.cursor,null);assert.equal(next.assortmentComplete,false);
  let freshCalls=0;const notDue=await Inventory.refresh(restart,{today},{fetchImpl:async()=>{freshCalls++;throw Error("Must not fetch a fresh same-region scan")}});assert.equal(notDue.skipped,"not-due");assert.equal(freshCalls,0);
  const oldPartial=fakePool(previous({finishedAt:new Date(),result:{ok:true}}));const changed=await Inventory.refresh(oldPartial,{today,maxPages:1},{fetchImpl:async url=>{assert.equal(new URL(url).searchParams.get("page"),"1","Legacy DE cursors are reset without changing their saved run");return response([])}});assert.equal(changed.scan.complete,true);assert.equal(changed.scan.sourceTotal,0);assert.equal(oldPartial.state.runs.length,1);
  const oldFailure=previous({finishedAt:new Date(),result:{ok:false},error:"open-prices-inventory-http-429"}),failurePool=fakePool(oldFailure);let deniedCalls=0;
  const cooldown=await Inventory.refresh(failurePool,{today},{fetchImpl:async()=>{deniedCalls++;throw Error("Source cooldown must survive a region change")}});assert.equal(cooldown.skipped,"not-due");assert.equal(deniedCalls,0);assert.strictEqual(failurePool.state.last,oldFailure);assert.equal(failurePool.state.runs.length,0);
  const actualPartialPool=fakePool();let deniedPageRequests=0;
  const actualPartial=await Inventory.refresh(actualPartialPool,{today,region:"DE",maxPages:2,force:true},{fetchImpl:async url=>{if(new URL(url).searchParams.get("page")==="1")return response([good],1,2,2);deniedPageRequests++;return{ok:false,status:429,headers:{get:()=>"0"}}}});
  assert.equal(actualPartial.ok,false);assert.equal(actualPartial.import.accepted,1);assert.equal(actualPartialPool.state.last.status,"partial");assert.equal(actualPartialPool.state.last.error,"open-prices-inventory-http-429");assert.equal(actualPartialPool.state.last.cursor.nextPage,2);assert(deniedPageRequests<=2,"The existing bounded retry budget remains unchanged");const beforeSwitch=actualPartialPool.state.last;
  const deniedSwitch=await Inventory.refresh(actualPartialPool,{today},{fetchImpl:async()=>{deniedCalls++;throw Error("Partial 429 cooldown cannot be bypassed by switching to Berlin")}});assert.equal(deniedSwitch.skipped,"not-due");assert.equal(deniedCalls,0);assert.strictEqual(actualPartialPool.state.last,beforeSwitch);assert.equal(actualPartialPool.state.runs.length,1);
  const failed=fakePool();await assert.rejects(()=>Inventory.refresh(failed,{today,maxPages:1},{fetchImpl:async()=>response([],2,2,0)}),/invalid-pagination/);assert.equal(failed.state.last.status,"failed");assert.equal(failed.state.last.result.scope.region,"Berlin");assert.equal(failed.state.last.cursor,null);
  const yesterday=fakePool(previous({until:"2026-09-29",result:{scope:Client.scopeMetadata("Berlin")},cursor:{nextPage:8,since:"2026-09-22",until:"2026-09-29",region:"Berlin",geo,locationIds:""}}));await Inventory.refresh(yesterday,{today,maxPages:1},{fetchImpl:async url=>{assert.equal(new URL(url).searchParams.get("page"),"1");return response([])}});
  const nationwide=fakePool();const de=await Inventory.refresh(nationwide,{today,region:"DE",maxPages:1},{fetchImpl:async url=>{assert.equal(new URL(url).searchParams.get("lat"),null);return response([])}});assert.equal(de.scope.region,"DE");assert.equal(de.scan.worldwideTotal,0);
  const normalized=Client.normalizeInput({today,region:"Berlin"});assert.equal(Inventory.sameRunScope({result:{scope:{...Client.scopeMetadata("Berlin"),geo:{radiusKm:35,lon:13.405,lat:52.52}}}},normalized),true,"JSONB object key order cannot invalidate the persisted query");
  const status=await Inventory.status(pool,{today});assert.equal(status.scope.region,"Berlin");assert.equal(status.coverage.current_observations,3);assert.equal(status.berlinCoverage.current_observations,0);assert.equal(status.berlinCoverage.stores,1);assert.deepEqual(status.berlinSamples,[]);assert.equal(status.samples[0].city,"München");assert.equal(status.assortmentComplete,false);
 }finally{Object.assign(Canonical,{prepare:original.prepare});Object.assign(Import,{persist:original.persist});Object.assign(State,{acquire:original.acquire,release:original.release})}
 console.log("price-inventory-service: Berlin-first native query, scope-bound cursors, preserved denial cadence, regional coverage and source dates OK");
})().catch(error=>{console.error(error);process.exitCode=1});
