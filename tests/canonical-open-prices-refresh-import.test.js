"use strict";
const assert=require("assert/strict"),Refresh=require("../canonical-open-prices-refresh-import"),Canonical=require("../canonical-inventory-import"),Persist=require("../external-price-import");
const today="2026-09-30",code="3017620422003";
function row(id=1,patch={}){return{id,type:"PRODUCT",product_code:code,product:{code,product_name:"Nutella",brands:"Ferrero",quantity:"450 g"},location_id:12,location:{id:12,type:"OSM",osm_id:1234567,osm_type:"NODE",osm_tag_key:"shop",osm_tag_value:"supermarket",osm_brand:"EDEKA",osm_name:"EDEKA",osm_address_country_code:"DE",osm_address_country:"Deutschland",osm_address_city:"Berlin",osm_lat:52.52,osm_lon:13.4},price:3,currency:"EUR",date:today,proof_id:id+80,proof:{id:id+80,type:"PRICE_TAG",draft:false,date:today,currency:"EUR",location_id:12,location_osm_id:1234567,location_osm_type:"NODE",image_md5_hash:"a".repeat(32)},price_per:"UNIT",price_is_discounted:false,duplicate_of:null,...patch}}
function fakePool(){
 const state={products:[],stores:[],productMappings:[],storeMappings:[],links:[]},calls=[];let id=0;
 const result=(rows=[],rowCount=rows.length)=>({rows,rowCount});
 async function query(sql,args=[]){
  calls.push({sql,args});
  if(sql.includes("CREATE TABLE")||sql.startsWith("SELECT pg_advisory")||/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)/.test(sql))return result();
  if(sql.startsWith("SELECT id,name,normalized_name"))return result([{id:"merchant-edeka",name:"EDEKA",active:true}]);
  if(sql.startsWith("SELECT ep.product_id")){const m=state.productMappings.find(x=>x.externalProductId===args[1]);return result(m?[{...m,gtin:state.products.find(p=>p.id===m.productId)?.gtin}]:[])}
  if(sql.startsWith("SELECT id,gtin,name"))return result(state.products.filter(p=>p.gtin===args[0]));
  if(sql.startsWith("INSERT INTO products(")){const product={id:"product-"+(++id),gtin:args[1],name:args[2],brand:args[3],packAmount:args[4],packUnit:args[5],packCount:args[6]};state.products.push(product);return result([{id:product.id}])}
  if(sql.startsWith("INSERT INTO external_product_mappings")){if(state.productMappings.some(m=>m.externalProductId===args[1]))return result();state.productMappings.push({externalProductId:args[1],productId:args[2],status:"verified",confidence:1});return result([{product_id:args[2]}])}
  if(sql.startsWith("INSERT INTO product_identity_evidence"))return result([],1);
  if(sql.startsWith("SELECT em.store_id")){const m=state.storeMappings.find(x=>x.externalLocationId===args[1]);return result(m?[{...m,externalId:state.stores.find(s=>s.id===m.storeId)?.externalId}]:[])}
  if(sql.startsWith("SELECT id,merchant_id"))return result(state.stores.filter(s=>s.externalId===args[0]));
  if(sql.startsWith("INSERT INTO stores(")){const store={id:"store-"+(++id),merchantId:args[0],externalId:args[1],country:"DE",active:true,latitude:args[6],longitude:args[7]};state.stores.push(store);return result([{id:store.id}])}
  if(sql.startsWith("INSERT INTO external_store_mappings")){if(state.storeMappings.some(m=>m.externalLocationId===args[1]))return result();state.storeMappings.push({externalLocationId:args[1],storeId:args[2],status:"verified",confidence:1});return result([{store_id:args[2]}])}
  if(sql.startsWith("SELECT store_id AS"))return result(state.links.filter(l=>l.externalLocationId===args[1]));
  if(sql.startsWith("INSERT INTO canonical_store_sources")){if(!state.links.some(l=>l.externalLocationId===args[2]))state.links.push({storeId:args[0],externalLocationId:args[2],status:"verified"});return result([],1)}
  throw Error("Unexpected SQL: "+sql);
 }
 return{state,calls,query,connect:async()=>({query,release(){calls.push({sql:"RELEASE CONNECTION"})}})};
}
(async()=>{
 const input={today,productCode:code},good=row(),pool=fakePool();
 // Reuse an existing OFF identity; a targeted price creates only its exact new store/source mappings.
 pool.state.products.push({id:"catalog-product",gtin:code,name:"Catalog name",brand:"Ferrero",packAmount:450,packUnit:"g",packCount:1});
 const first=await Refresh.prepare(pool,{rawItems:[good],sourceUrl:"https://prices.openfoodfacts.org/api/v1/prices?product_code="+code,fetchedAt:"2026-09-30T12:00:00Z"},input);
 assert.equal(first.accepted.length,1);assert.equal(first.catalogCounts.productsCreated,0);assert.equal(first.catalogCounts.storesCreated,1);assert.equal(first.accepted[0].productId,"catalog-product");assert.equal(first.accepted[0].storeId,pool.state.stores[0].id);assert.equal(first.accepted[0].region,"Berlin, DE");assert.equal(first.accepted[0].externalLocationId,"openprices:12");assert.equal(first.accepted[0].truthEligible,true);assert.equal(pool.state.products[0].name,"Catalog name");
 const observed=Persist.observation(first.accepted[0],"batch");assert.equal(observed.status,"observed");assert.equal(observed.proof,"openprices:proof:81");assert.equal(observed.proofHash,"a".repeat(32));assert(!Object.hasOwn(observed,"proofVerified"));assert(!Object.hasOwn(first.accepted[0],"identityVerified"),"Canonical identity confidence must not claim verified price evidence");
 const again=await Refresh.prepare(pool,{rawItems:[good]},input);assert.equal(again.accepted.length,1);assert.equal(again.catalogCounts.storesCreated,0);assert.equal(pool.state.stores.length,1);
 const kg=row(2,{product:{...good.product,quantity:"2.0 x 175 g"},price_per:"KILOGRAM"}),kgPool=fakePool(),multipack=await Refresh.prepare(kgPool,{rawItems:[kg]},input);assert.equal(multipack.accepted.length,1);assert.equal(multipack.accepted[0].per,"kg");assert.equal(multipack.accepted[0].pack,"2 x 175 g");assert.equal(multipack.accepted[0].packAmount,350);assert.equal(multipack.accepted[0].packUnit,"g");assert.equal(kgPool.state.products[0].packCount,2);
 const invalid=[row(3,{date:"2026-09-22"}),row(4,{date:"2026-10-01"}),row(5,{currency:"USD"}),row(6,{location:{...good.location,osm_address_country_code:"FR"}}),row(7,{price:Infinity}),row(8,{proof:{...good.proof,id:88,draft:true}}),row(9,{proof_id:89,proof:{...good.proof,id:89,location_osm_id:999}}),row(10,{product_code:"4006381333931",product:{...good.product,code:"4006381333931"}}),row(11,{price_is_discounted:true,discount_type:"EXPIRES_SOON"})];
 const invalidPool=fakePool(),bad=await Refresh.prepare(invalidPool,{rawItems:invalid},input);assert.equal(bad.accepted.length,0);assert.equal(bad.rejected.length,invalid.length);assert.equal(invalidPool.calls.length,0,"Source/provider gates run before identity writes");
 for(const reason of ["date-outside-window","unsupported-currency","country-outside-DE","invalid-price","draft-proof","proof-location-mismatch","product-outside-scope","unsupported-discount-type"])assert(bad.rejected.some(x=>x.reasons.includes(reason)),reason);
 const wrongScope=await Refresh.prepare(fakePool(),{rawItems:[good]},{...input,locationId:"13"});assert.equal(wrongScope.accepted.length,0);assert(wrongScope.rejected[0].reasons.includes("location-outside-scope"));
 const conflicts=await Refresh.prepare(pool,{rawItems:[row(12,{product:{...good.product,quantity:"750 g"}})]},input);assert.equal(conflicts.accepted.length,0);assert(conflicts.rejected[0].reasons.includes("product-existing-pack-conflict"));assert.equal(pool.state.products[0].packAmount,450);
 pool.state.storeMappings[0].status="review";const review=await Refresh.prepare(pool,{rawItems:[good]},input);assert.equal(review.accepted.length,0);assert(review.rejected[0].reasons.includes("store-existing-mapping-needs-review"));assert.equal(pool.state.storeMappings[0].status,"review");
 const administrative=row(13,{location:{...good.location,id:13,osm_id:1234568,osm_tag_key:"boundary",osm_tag_value:"administrative"},location_id:13,proof:{...good.proof,id:93,location_id:13,location_osm_id:1234568}}),regionPool=fakePool(),region=await Refresh.prepare(regionPool,{rawItems:[administrative]},input);assert.equal(region.accepted.length,0);assert.equal(regionPool.state.stores.length,0);assert(region.rejected[0].reasons.includes("store-retail-osm-entity-required"));
 const repeated=await Refresh.prepare(fakePool(),{rawItems:[good,good]},input);assert.equal(repeated.accepted.length,1);assert.equal(repeated.rejected.length,1);assert(repeated.rejected[0].reasons.includes("duplicate-id"));
 await assert.rejects(()=>Refresh.prepare(pool,{accepted:first.accepted},input),/raw-source-payload-required/);assert.equal((await Refresh.prepare(pool,{rawItems:[]},input)).accepted.length,0);
 assert(pool.calls.some(q=>q.sql==="BEGIN"));assert(pool.calls.some(q=>q.sql==="COMMIT"));assert(!pool.calls.some(q=>/UPDATE (products|external_product_mappings|external_store_mappings)/.test(q.sql)));
 assert.equal(Canonical.SOURCE,Refresh.SOURCE);console.log("canonical-open-prices-refresh-import: real raw gates, OFF SKU reuse, exact OSM stores, review/pack protection, kg multipacks and observed-only evidence OK");
})().catch(error=>{console.error(error);process.exitCode=1});
