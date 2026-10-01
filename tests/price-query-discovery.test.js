"use strict";
const assert=require("assert/strict"),Discovery=require("../price-query-discovery");
const ids={product:"10000000-0000-4000-8000-000000000001",other:"10000000-0000-4000-8000-000000000002",store:"20000000-0000-4000-8000-000000000001",far:"20000000-0000-4000-8000-000000000002",rewe:"20000000-0000-4000-8000-000000000003"};
const product={id:ids.product,canonicalKey:"gtin:3017620422003",gtin:"3017620422003",name:"Nutella",brand:"Ferrero",packAmount:450,packUnit:"g",packCount:1,identityStatus:"verified"};
const store={id:ids.store,merchant:"EDEKA",merchantKey:"edeka",city:"Berlin",region:"Berlin",latitude:52.52,longitude:13.405,active:true,merchantActive:true};
const mapping={storeId:store.id,sourceId:"Open Prices",externalLocationId:"openprices:12",status:"verified",confidence:.98};
function database({products=[product],stores=[store],mappings=[mapping]}={}){
 const calls=[];
 return{calls,query:async(sql,args=[])=>{
  calls.push({sql,args});assert(/^SELECT\b/.test(sql),"Discovery must be read-only");
  if(sql.includes("FROM products")){
   if(sql.includes("WHERE lower(name)=lower($1)"))return{rows:products.filter(row=>row.name.toLowerCase()===args[0].toLowerCase())};
   if(sql.includes("WHERE id=$1"))return{rows:products.filter(row=>row.id===args[0])};
   if(sql.includes("WHERE gtin=$1"))return{rows:products.filter(row=>row.gtin===args[0])};
   return{rows:products};
  }
  if(sql.includes("FROM external_store_mappings"))return{rows:mappings};
  if(sql.includes("FROM stores s")){
   assert(sql.includes("s.active=true")&&sql.includes("m.active=true"));
   let rows=stores;
   if(sql.includes("s.id="))rows=rows.filter(row=>row.id===args[0]);
   const aliases=args.find(Array.isArray);
   if(aliases)rows=rows.filter(row=>aliases.includes(row.merchant.toLowerCase())||aliases.includes(row.merchantKey));
   return{rows};
  }
  throw new Error("Unexpected SQL: "+sql);
 }};
}
async function main(){
 assert(Discovery.validGtin(product.gtin));
 assert(!Discovery.validGtin("3017620422004"));
 assert(!Discovery.validGtin("EAN 3017620422003"));
 assert(Discovery.samePack(Discovery.pack("0,45 kg"),Discovery.pack("450 g")));
 assert(Discovery.samePack(Discovery.pack("6 × 0.5 l"),Discovery.pack("6 x 500 ml")));
 assert(!Discovery.samePack(Discovery.pack("3 x 150 g"),Discovery.pack("450 g")),"Equal total weight does not identify an identical pack");
 assert.equal(Discovery.pack("-450 g"),null);assert.equal(Discovery.pack("450 g / 500 g"),null);
 assert.equal(Discovery.openPricesLocationId("openprices:12"),"12");
 for(const value of ["osm:12","openprices:0","-12","12?store=3","12;DROP TABLE stores"]){assert.equal(Discovery.openPricesLocationId(value),null)}

 let pool=database(),result=await Discovery.resolveQuery(pool,{gtin:product.gtin,storeId:store.id,merchants:["EDEKA"]});
 assert.equal(result.ok,true);assert.equal(result.productResolution.state,"exact");assert.equal(result.product.id,product.id);
 assert.equal(result.storeResolution.state,"exact");assert.equal(result.stores[0].id,store.id);
 assert.equal(result.requiresProductSelection,false);assert.equal(result.requiresStoreSelection,false);
 assert.deepEqual(result.refreshTargets,[{sourceId:"Open Prices",productCode:product.gtin,productId:product.id,storeId:store.id,locationId:"12",priority:100,targetReason:"user-query-canonical-store"}]);
 assert(pool.calls.find(call=>call.sql.includes("external_store_mappings")).sql.includes("esm.status='verified'"));
 assert.equal(pool.calls[0].args[0],product.gtin);

 result=await Discovery.resolveQuery(database(),{productId:product.id,storeId:store.id});
 assert.equal(result.productResolution.mode,"id");assert.equal(result.product.id,product.id);
 for(const request of [{productId:product.id,pack:"500 g"},{gtin:product.gtin,pack:"3 x 150 g"},{productId:product.id,brand:"Other brand"}]){
  result=await Discovery.resolveQuery(database(),{...request,storeId:store.id});assert.equal(result.productResolution.state,"unknown");assert.equal(result.product,null);assert.equal(result.refreshTargets.length,0);
 }
 result=await Discovery.resolveQuery(database({products:[product,{...product,id:ids.other,name:"Butter",brand:"Other"}]}),{productId:product.id,product:"Butter",storeId:store.id});
 assert.equal(result.productResolution.reason,"product-name-conflict");assert.equal(result.product,null);
 result=await Discovery.resolveQuery(database(),{productId:product.id,product:"Schokocreme",storeId:store.id});
 assert.equal(result.productResolution.state,"exact","An unrecognized descriptive alias must not override an explicit canonical identifier");
 result=await Discovery.resolveQuery(database(),{productId:product.id,gtin:"4006381333931",storeId:store.id});
 assert.equal(result.ok,false);assert.deepEqual(result.errors,["product-identity-conflict"]);assert.equal(result.refreshTargets.length,0);
 for(const request of [{gtin:"3017620422004"},{gtin:"EAN 3017620422003"},{productId:"not-an-id"}]){
  pool=database();result=await Discovery.resolveQuery(pool,{...request,storeId:store.id});
  assert.equal(result.ok,false);assert.equal(result.product,null);assert.equal(result.refreshTargets.length,0);
  assert(!pool.calls.some(call=>call.sql.includes("FROM products")),"Invalid exact identifiers must not fall back to fuzzy matching");
 }

 result=await Discovery.resolveQuery(database(),{product:"Nutella",brand:"FERRERO",pack:"0,45 kg",merchants:["EDEKA"]});
 assert.equal(result.productResolution.state,"exact");assert.equal(result.productResolution.mode,"sku");assert.equal(result.product.pack,"450 g");
 assert.equal(result.requiresStoreSelection,true);assert.equal(result.stores[0].matchType,"candidate");
 result=await Discovery.resolveQuery(database(),{product:"Nutella",storeId:store.id});
 assert.equal(result.productResolution.state,"candidate");assert.equal(result.product,null);assert.equal(result.requiresProductSelection,true);assert.equal(result.refreshTargets.length,0);
 assert(result.products.every(row=>row.matchType==="candidate"),"A unique name/category suggestion must not be promoted to an exact product");
 result=await Discovery.resolveQuery(database(),{product:"Nutella",brand:"Ferrero",pack:"3 x 150 g",storeId:store.id});
 assert.equal(result.productResolution.state,"candidate");assert.equal(result.refreshTargets.length,0);
 result=await Discovery.resolveQuery(database({products:[product,{...product,id:ids.other,gtin:"4006381333931"}]}),{product:"Nutella",brand:"Ferrero",pack:"450 g",storeId:store.id});
 assert.equal(result.productResolution.state,"ambiguous");assert.equal(result.product,null);assert.equal(result.refreshTargets.length,0);
 assert(result.products.every(row=>row.matchType==="candidate"));

 const many=Array.from({length:6},(_,i)=>({...product,id:"10000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),name:"Nutella variant "+i}));
 result=await Discovery.resolveQuery(database({products:many}),{product:"Nutella",limit:2,storeId:store.id});
 assert.equal(result.products.length,2);assert.equal(result.refreshTargets.length,0);
 pool=database();await Discovery.resolveQuery(pool,{product:"Nutella_%' OR TRUE",storeId:store.id});
 const nameCall=pool.calls.find(call=>call.sql.includes("FROM products"));
 assert(nameCall.sql.includes("name ILIKE $1"));assert(!nameCall.sql.includes("OR TRUE"));assert.equal(nameCall.args[0],"%Nutella\\_\\%'%");

 const far={...store,id:ids.far,latitude:53.55,longitude:10},rewe={...store,id:ids.rewe,merchant:"REWE",merchantKey:"rewe"},inactive={...store,id:ids.far,active:false};
 pool=database({stores:[far,store,rewe,inactive]});result=await Discovery.resolveQuery(pool,{gtin:product.gtin,merchants:["EDEKA"],latitude:52.52,longitude:13.405,radiusKm:5});
 assert.deepEqual(result.stores.map(row=>row.id),[store.id]);assert.equal(result.stores[0].distanceKm,0);
 assert.equal(result.storeResolution.mode,"nearby");assert.equal(result.requiresStoreSelection,true);
 const nearbyCall=pool.calls.find(call=>call.sql.includes("FROM stores s"));
 assert(nearbyCall.sql.includes('WHERE "distanceKm"<='));assert(nearbyCall.args.includes(5));
 result=await Discovery.resolveQuery(database(),{gtin:product.gtin,storeId:store.id,merchants:["REWE"]});
 assert.equal(result.stores.length,0);assert.equal(result.refreshTargets.length,0,"An explicit store from a different requested merchant must not be selected");
 for(const request of [{latitude:NaN,longitude:13},{latitude:91,longitude:13},{latitude:52},{latitude:52,longitude:13,radiusKm:Infinity},{latitude:52,longitude:13,radiusKm:0},{storeId:"store-candidate"}]){
  result=await Discovery.resolveQuery(database(),{gtin:product.gtin,...request});
  assert.equal(result.ok,false);assert.equal(result.stores.length,0);assert.equal(result.refreshTargets.length,0);
 }
 assert.equal(Discovery.position({latitude:null,longitude:null}).point,null,"Missing coordinates must not be converted to 0,0");
 assert.deepEqual(Discovery.position({latitude:0,longitude:0}).point,{latitude:0,longitude:0});
 pool=database();await Discovery.resolveQuery(pool,{gtin:product.gtin,region:"Berlin",merchants:["EDEKA"]});
 const regionalCall=pool.calls.find(call=>call.sql.includes("FROM stores s"));assert(regionalCall.sql.includes("s.country"));assert(regionalCall.sql.includes('s.external_id AS "externalId"'));assert(regionalCall.sql.includes("lower(s.region)="));assert(regionalCall.sql.includes("lower(s.city)="));assert(regionalCall.args.includes("berlin"));

 const unsafeMappings=[{...mapping,status:"review"},{...mapping,confidence:.89},{...mapping,confidence:Infinity},{...mapping,confidence:99},{...mapping,externalLocationId:"osm:12"},{...mapping,sourceId:"Other"},{...mapping,storeId:ids.far}];
 result=await Discovery.resolveQuery(database({mappings:unsafeMappings}),{gtin:product.gtin,storeId:store.id});
 assert.equal(result.refreshTargets.length,0,"Refresh requires a verified Open Prices mapping to the selected canonical store");
 result=await Discovery.resolveQuery(database({mappings:[mapping,mapping,{...mapping,externalLocationId:"openprices:15",confidence:.95}]}),{gtin:product.gtin,storeId:store.id});
 assert.equal(result.refreshTargets.length,1,"Duplicate/multiple mappings should not multiply a store refresh target");
 pool=database();assert.deepEqual(await Discovery.buildRefreshTargets(pool,{...product,matchType:"candidate"},[{...store,canonical:true}]),[]);assert.equal(pool.calls.length,0);
 for(const request of [null,[],"Nutella"]){pool=database();result=await Discovery.resolveQuery(pool,request);assert.equal(result.ok,false);assert.deepEqual(result.errors,["invalid-body"]);assert.equal(pool.calls.length,0)}
 await assert.rejects(()=>Discovery.resolveQuery(null,{gtin:product.gtin}),/database-required/);
 console.log("price-query-discovery: canonical identity, safe suggestions, geographic scope and verified refresh targets OK");
}
main().catch(error=>{console.error(error);process.exitCode=1});
