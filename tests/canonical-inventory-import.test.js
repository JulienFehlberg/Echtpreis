"use strict";
const assert=require("assert/strict"),Inventory=require("../canonical-inventory-import");

const merchants=[{id:"m-edeka",name:"EDEKA",normalizedName:"edeka",active:true},{id:"m-lidl",name:"Lidl",normalizedName:"lidl",active:true},{id:"m-aldi-nord",name:"ALDI Nord",normalizedName:"aldi-nord",active:true},{id:"m-aldi-sued",name:"ALDI Süd",normalizedName:"aldi-sued",active:true},{id:"m-netto",name:"Netto Marken-Discount",normalizedName:"netto-marken-discount",active:true}];
function row(extra={}){return{id:77,product:{code:"3017620422003",product_name:"Nutella",brands:"Ferrero",quantity:"450 g"},location:{id:12,type:"OSM",osm_id:1234567,osm_type:"NODE",osm_tag_key:"shop",osm_tag_value:"supermarket",osm_brand:"EDEKA",osm_name:"EDEKA",osm_address_country_code:"DE",osm_address_road:"Teststraße",osm_address_house_number:"1",osm_address_postcode:"10115",osm_address_city:"Berlin",osm_lat:52.52,osm_lon:13.4},...extra}}
function fakePool(){
 let state={merchants:structuredClone(merchants),products:[],stores:[],productMappings:[],storeMappings:[],links:[],evidence:[]},serial=0;const calls=[];
 function query(sql,args=[]){
  calls.push({sql,args});const result=(rows=[],rowCount=rows.length)=>({rows,rowCount});
  if(sql.includes("CREATE TABLE")||sql.startsWith("SELECT pg_advisory"))return result();
  if(sql.startsWith("SELECT id,name,normalized_name"))return result(state.merchants);
  if(sql.startsWith("SELECT ep.product_id")){const mapping=state.productMappings.find(m=>m.sourceId===args[0]&&m.externalProductId===args[1]);return result(mapping?[{...mapping,gtin:state.products.find(p=>p.id===mapping.productId)?.gtin}]:[])}
  if(sql.startsWith("SELECT id,gtin,name"))return result(state.products.filter(p=>p.gtin===args[0]));
  if(sql.startsWith("INSERT INTO products(")){if(state.products.some(p=>p.gtin===args[1]||p.canonicalKey===args[0]))return result();const id="product-"+(++serial);state.products.push({id,canonicalKey:args[0],gtin:args[1],name:args[2],brand:args[3],packAmount:args[4],packUnit:args[5],packCount:args[6]});return result([{id}])}
  if(sql.startsWith("INSERT INTO external_product_mappings")){if(state.productMappings.some(m=>m.sourceId===args[0]&&m.externalProductId===args[1]))return result();state.productMappings.push({sourceId:args[0],externalProductId:args[1],productId:args[2],status:"verified",confidence:1});return result([{product_id:args[2]}])}
  if(sql.startsWith("INSERT INTO product_identity_evidence")){if(!state.evidence.some(e=>e.productId===args[0]&&e.rawName===args[1]&&e.proof===args[6]))state.evidence.push({productId:args[0],rawName:args[1],proof:args[6]});return result([],1)}
  if(sql.startsWith("SELECT em.store_id")){const mapping=state.storeMappings.find(m=>m.sourceId===args[0]&&m.externalLocationId===args[1]);return result(mapping?[{...mapping,externalId:state.stores.find(s=>s.id===mapping.storeId)?.externalId}]:[])}
  if(sql.startsWith("SELECT id,merchant_id"))return result(state.stores.filter(s=>s.externalId===args[0]).slice(0,2));
  if(sql.startsWith("INSERT INTO stores(")){const id="store-"+(++serial);state.stores.push({id,merchantId:args[0],externalId:args[1],address:args[2],postalCode:args[3],city:args[4],region:args[5],country:"DE",latitude:args[6],longitude:args[7],active:true});return result([{id}])}
  if(sql.startsWith("INSERT INTO external_store_mappings")){if(state.storeMappings.some(m=>m.sourceId===args[0]&&m.externalLocationId===args[1]))return result();state.storeMappings.push({sourceId:args[0],externalLocationId:args[1],storeId:args[2],status:"verified",confidence:1});return result([{store_id:args[2]}])}
  if(sql.startsWith("SELECT store_id AS"))return result(state.links.filter(l=>l.sourceId===args[0]&&l.externalLocationId===args[1]));
  if(sql.startsWith("INSERT INTO canonical_store_sources")){if(!state.links.some(l=>l.sourceId===args[1]&&l.externalLocationId===args[2]))state.links.push({storeId:args[0],sourceId:args[1],externalLocationId:args[2],status:"verified"});return result([],1)}
  throw new Error("Unexpected SQL: "+sql);
 }
 return{query:async(...args)=>query(...args),connect:async()=>{let before,savepoint;return{query:async(sql,args)=>{calls.push({sql,args});if(sql==="BEGIN"){before=structuredClone(state);return{rows:[]}}if(sql==="SAVEPOINT inventory_identity"){savepoint=structuredClone(state);return{rows:[]}}if(sql==="ROLLBACK TO SAVEPOINT inventory_identity"){state=structuredClone(savepoint);return{rows:[]}}if(sql==="ROLLBACK"){state=structuredClone(before);return{rows:[]}}if(sql==="COMMIT"||sql==="RELEASE SAVEPOINT inventory_identity")return{rows:[]};return query(sql,args)},release(){calls.push({sql:"RELEASE CONNECTION"})}}},get state(){return state},calls};
}

async function main(){
 const product=Inventory.productCandidate(row());assert.equal(product.ok,true);assert.equal(product.packParsed.total.amount,450);
 for(const code of ["bad3017620422003","3017620422004",null])assert.equal(Inventory.productCandidate(row({product:{...row().product,code}})).ok,false,"GTIN must be present and exact");
 assert.equal(Inventory.productCandidate(row({product:{...row().product,quantity:"",product_quantity:250,product_quantity_unit:"g"}})).packParsed.amount,250);
 assert.equal(Inventory.productCandidate(row({product:{...row().product,quantity:"2.0 x 175 g"}})).packParsed.count,2);
 assert.equal(Inventory.productCandidate(row({product:{...row().product,quantity:"2.0x175g"}})).packParsed.total.amount,350);
 assert.equal(Inventory.productCandidate(row({product:{...row().product,quantity:"2,0 × 175 g"}})).packParsed.total.amount,350);
 assert.equal(Inventory.productCandidate(row({product:{...row().product,quantity:"2.5x175g"}})).ok,false);
 assert.equal(Inventory.productCandidate(row({product:{...row().product,quantity:"6 Stück"}})).packParsed.count,1,"Piece quantity must not be multiplied twice");
 assert.equal(Inventory.productCandidate(row({product:{...row().product,quantity:"1pcs"}})).packParsed.total.amount,1);
 assert.equal(Inventory.productCandidate(row({product:{...row().product,quantity:"1.5pieces"}})).ok,false);
 assert.equal(Inventory.productCandidate(row({product:{...row().product,quantity:"0 g",product_quantity:null,product_quantity_unit:"g"}})).ok,false);
 assert.equal(Inventory.productCandidate(row({product:{...row().product,quantity:"",product_quantity:Infinity,product_quantity_unit:"g"}})).ok,false);

 const store=Inventory.storeCandidate(row(),merchants);assert.equal(store.ok,true);assert.equal(store.merchant.id,"m-edeka");assert.equal(store.canonicalExternalId,"osm:node:1234567");
 for(const patch of [{osm_lat:null},{osm_lon:""},{osm_lat:Infinity},{osm_lon:0},{osm_address_country_code:"FR",osm_address_country:"Deutschland"},{osm_type:"BAD"},{osm_id:0},{osm_id:Number.MAX_SAFE_INTEGER+1},{osm_tag_key:"boundary",osm_tag_value:"administrative"},{type:"ONLINE"},{osm_brand:"ALDI",osm_name:"ALDI"},{osm_brand:"Netto",osm_name:"Netto"}])assert.equal(Inventory.storeCandidate(row({location:{...row().location,...patch}}),merchants).ok,false,JSON.stringify(patch));
 assert.equal(Inventory.storeCandidate(row({location:{...row().location,osm_brand:"ALDI Süd",osm_name:"ALDI"}}),merchants).merchant.id,"m-aldi-sued");
 assert.equal(Inventory.storeCandidate(row({location:{...row().location,osm_address_road:null,osm_display_name:"Real source display address"}}),merchants).address,"Real source display address");

 const pool=fakePool(),first=await Inventory.prepare(pool,{items:[row()]},{sourceUrl:"https://prices.openfoodfacts.org/api/v1/prices/",fetchedAt:"2026-09-30T12:00:00Z"});
 assert.equal(first.accepted.length,1);assert.equal(first.counts.productsCreated,1);assert.equal(first.counts.storesCreated,1);assert.equal(first.accepted[0].proofVerified,false);assert.equal(first.accepted[0].identityVerified,true);assert(first.accepted[0].provenance.locationUrl.endsWith("node/1234567"));
 const second=await Inventory.prepare(pool,[row()],{sourceUrl:"https://prices.openfoodfacts.org/api/v1/prices/"});assert.equal(second.accepted[0].productId,first.accepted[0].productId);assert.equal(second.accepted[0].storeId,first.accepted[0].storeId);assert.equal(second.counts.productsCreated,0);assert.equal(second.counts.storesCreated,0);assert.equal(pool.state.productMappings.length,1);assert.equal(pool.state.storeMappings.length,1);assert.equal(pool.state.evidence.length,1);
 assert(!pool.calls.some(call=>/UPDATE (external_product_mappings|external_store_mappings|canonical_store_sources)/.test(call.sql)),"Canonical imports must never overwrite prior mappings");
 assert(pool.calls.some(call=>call.sql.includes("pg_advisory_xact_lock")));assert.equal(pool.calls.filter(call=>call.sql==="RELEASE CONNECTION").length,2);
 const multipack=await Inventory.prepare(fakePool(),[row({product:{...row().product,quantity:"2.0 x 175 g"}})]);assert.equal(multipack.accepted[0].pack,"2 x 175 g");assert.equal(multipack.accepted[0].packCount,2);assert.equal(multipack.accepted[0].packAmount,175);

 const partialPool=fakePool(),partial=await Inventory.prepare(partialPool,[row({product:{...row().product,quantity:"unknown"}})]);
 assert.equal(partial.accepted.length,0);assert.equal(partial.partial.length,1);assert.equal(partial.partial[0].productId,null);assert(partial.partial[0].storeId);assert.equal(partial.counts.storesCreated,1);assert.equal(partial.counts.productsCreated,0);assert(partial.rejected[0].reasons.includes("product-known-pack-required"));
 const noStore=await Inventory.prepare(fakePool(),[row({location:{...row().location,osm_address_country_code:"AT"}})]);assert.equal(noStore.accepted.length,0);assert.equal(noStore.partial[0].storeId,null);assert(noStore.partial[0].productId);

 pool.state.storeMappings[0].status="review";const needsReview=await Inventory.prepare(pool,[row()]);assert.equal(needsReview.accepted.length,0);assert(needsReview.rejected[0].reasons.includes("store-existing-mapping-needs-review"));assert.equal(pool.state.storeMappings[0].status,"review");assert.equal(pool.state.stores.length,1);
 pool.state.storeMappings[0].status="verified";pool.state.stores[0].externalId="osm:way:7654321";const foreignMapping=await Inventory.prepare(pool,[row()]);assert.equal(foreignMapping.accepted.length,0);assert(foreignMapping.rejected[0].reasons.includes("store-existing-mapping-needs-review"));assert.equal(pool.state.stores.length,1);
 const productPool=fakePool();await Inventory.prepare(productPool,[row()]);productPool.state.productMappings[0].confidence=.5;const untrusted=await Inventory.prepare(productPool,[row()]);assert.equal(untrusted.accepted.length,0);assert(untrusted.rejected[0].reasons.includes("product-existing-mapping-needs-review"));assert.equal(productPool.state.productMappings[0].confidence,.5);
 productPool.state.productMappings[0].confidence=1;productPool.state.products[0].gtin="4006381333931";const wrongProduct=await Inventory.prepare(productPool,[row()]);assert.equal(wrongProduct.accepted.length,0);assert(wrongProduct.rejected[0].reasons.includes("product-existing-mapping-needs-review"));assert.equal(productPool.state.products.length,1);
 const packPool=fakePool();await Inventory.prepare(packPool,[row()]);const conflict=await Inventory.prepare(packPool,[row({product:{...row().product,quantity:"750 g"}})]);assert.equal(conflict.accepted.length,0);assert(conflict.rejected[0].reasons.includes("product-existing-pack-conflict"));assert.equal(packPool.state.products[0].packAmount,450);
 const duplicatePool=fakePool();await Inventory.prepare(duplicatePool,[row()]);duplicatePool.state.stores.push({...duplicatePool.state.stores[0],id:"duplicate"});const duplicate=await Inventory.prepare(duplicatePool,[row()]);assert(duplicate.rejected[0].reasons.includes("store-duplicate-osm-identity"));
 const rollbackPool=fakePool();await Inventory.prepare(rollbackPool,[row()]);rollbackPool.state.links[0].storeId="wrong-store";const before=structuredClone(rollbackPool.state),badLink=await Inventory.prepare(rollbackPool,[row()]);assert.equal(badLink.accepted.length,0);assert(badLink.rejected[0].reasons.includes("store-existing-source-link-needs-review"));assert.deepEqual(rollbackPool.state.storeMappings,before.storeMappings);
 const bounded=await Inventory.prepare(fakePool(),[row(),row()],{limit:1});assert.equal(bounded.counts.processed,1);assert.equal(bounded.counts.truncated,true);
 await assert.rejects(()=>Inventory.prepare(fakePool(),[],{sourceId:"User"}),/source-not-supported/);
 console.log("canonical-inventory-import: exact GTIN/pack, actual German OSM retail entities, conservative mappings, transactions, provenance, partial catalog and idempotency OK");
}
main().catch(error=>{console.error(error);process.exitCode=1});
