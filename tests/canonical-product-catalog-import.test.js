"use strict";
const assert=require("assert/strict"),Catalog=require("../canonical-product-catalog-import");
function product(extra={}){return{code:"3017620422003",product_name:"Nutella",product_name_de:"Nuss-Nougat-Creme",brands:"Ferrero",quantity:"450 g",countries_tags:["en:germany","en:france"],...extra}}
function gtin(index){const base=String(900000000000+index);let sum=0,odd=true;for(let i=base.length-1;i>=0;i--){sum+=Number(base[i])*(odd?3:1);odd=!odd}return base+((10-sum%10)%10)}
function fakePool(){
 let state={products:[],mappings:[],evidence:[]},serial=0,failEvidence=false;const calls=[];
 function query(sql,args=[]){
  calls.push({sql,args});const result=(rows=[],rowCount=rows.length)=>({rows,rowCount});
  if(sql.startsWith("SELECT pg_advisory"))return result();
  if(sql.startsWith("SELECT id,canonical_key"))return result(state.products.filter(p=>args[0].includes(p.gtin)||args[1].includes(p.canonicalKey)));
  if(sql.startsWith("SELECT ep.external_product_id"))return result(state.mappings.filter(m=>m.sourceId===args[0]&&args[1].includes(m.externalProductId)).map(m=>({...m,gtin:state.products.find(p=>p.id===m.productId)?.gtin})));
  if(sql.startsWith("INSERT INTO products(")){const created=[];for(const p of JSON.parse(args[0]))if(!state.products.some(x=>x.gtin===p.gtin||x.canonicalKey===p.canonicalKey)){const id="product-"+(++serial);state.products.push({id,...p});created.push({id,gtin:p.gtin})}return result(created)}
  if(sql.startsWith("INSERT INTO external_product_mappings")){const created=[];for(const link of JSON.parse(args[0]))if(!state.mappings.some(m=>m.sourceId===args[1]&&m.externalProductId===link.externalProductId)){state.mappings.push({...link,sourceId:args[1],status:"verified",confidence:1});created.push({external_product_id:link.externalProductId})}return result(created)}
  if(sql.startsWith("INSERT INTO product_identity_evidence")){if(failEvidence)throw new Error("fixture-evidence-failed");const created=[];for(const e of JSON.parse(args[0]))if(!state.evidence.some(x=>x.productId===e.productId&&x.name===e.name&&x.sourceId===args[1]&&x.proof===e.proof)){state.evidence.push({...e,sourceId:args[1]});created.push({id:"evidence-"+(++serial)})}return result(created)}
  throw new Error("Unexpected catalog SQL: "+sql);
 }
 return{connect:async()=>{let before;return{query:async(sql,args)=>{if(sql==="BEGIN"){calls.push({sql});before=structuredClone(state);return{rows:[]}}if(sql==="ROLLBACK"){calls.push({sql});state=structuredClone(before);return{rows:[]}}if(sql==="COMMIT"){calls.push({sql});return{rows:[]}}return query(sql,args)},release(){calls.push({sql:"RELEASE CONNECTION"})}}},get state(){return state},get failEvidence(){return failEvidence},set failEvidence(value){failEvidence=value},calls};
}
async function main(){
 const candidate=Catalog.productCandidate(product());assert.equal(candidate.ok,true);assert.equal(candidate.name,"Nuss-Nougat-Creme");assert.equal(candidate.externalProductId,"off:3017620422003");assert.equal(candidate.truthEligible,false);assert.equal(candidate.purpose,"identity");
 assert.equal(Catalog.productCandidate(product({countries_tags:["en:austria"]})).ok,false);
 assert.equal(Catalog.productCandidate(product({countries_tags:"en:germany"})).ok,false,"Reader must parse CSV country tags before passing the source record");
 assert.equal(Catalog.productCandidate(product({code:"bad3017620422003"})).ok,false);
 assert.equal(Catalog.productCandidate(product({code:"3017620422004"})).ok,false);
 assert.equal(Catalog.productCandidate(product({_id:"4006381333931"})).ok,false);
 assert.equal(Catalog.productCandidate(product({code:undefined,_id:"3017620422003"})).ok,true);
 assert.equal(Catalog.productCandidate(product({quantity:"",product_quantity:250,product_quantity_unit:"g"})).packParsed.amount,250);
 assert.equal(Catalog.productCandidate(product({quantity:"2.0 x 175 g"})).packParsed.count,2);
 assert.equal(Catalog.productCandidate(product({quantity:"2.5x175g"})).ok,false);
 assert.equal(Catalog.productCandidate(product({product_name_de:"",product_name:"123456789"})).ok,false);
 assert.equal(Catalog.productCandidate(product({quantity:"unknown",product_quantity:Infinity,product_quantity_unit:"g"})).ok,false);

 const pool=fakePool(),first=await Catalog.importBatch(pool,[product()],{sourceId:"Open Food Facts",sourceUrl:"https://world.openfoodfacts.org/api/v2/search",fetchedAt:"2026-09-30T12:00:00Z"});
 assert.equal(first.counts.created,1);assert.equal(first.counts.accepted,1);assert.equal(first.counts.mappingsCreated,1);assert.equal(first.counts.evidenceCreated,1);assert.equal(first.accepted[0].proofVerified,false);assert.equal(first.accepted[0].pack,"450 g");assert.equal(first.purpose,"identity");assert.equal(first.truthEligible,false);assert.equal(first.attribution.license,"ODbL-1.0");
 const again=await Catalog.prepare(pool,{products:[product()]});assert.equal(again.counts.created,0);assert.equal(again.counts.reused,1);assert.equal(again.counts.mappingsCreated,0);assert.equal(again.counts.evidenceCreated,0);assert.equal(again.accepted[0].productId,first.accepted[0].productId);
 assert(!pool.calls.some(c=>/price_observations|INSERT INTO stores|UPDATE (products|external_product_mappings)/.test(c.sql)),"Identity-only catalog ingestion may not create prices, stores or overwrite metadata/mappings");

 const existingPool=fakePool();existingPool.state.products.push({id:"existing-openprices",canonicalKey:"gtin:3017620422003",gtin:"3017620422003",name:"Existing canonical name",brand:"Ferrero",packAmount:450,packUnit:"g",packCount:1});
 const reused=await Catalog.importBatch(existingPool,[product()]);assert.equal(reused.counts.created,0);assert.equal(reused.accepted[0].productId,"existing-openprices");assert.equal(reused.accepted[0].name,"Existing canonical name");assert.equal(existingPool.state.products.length,1);
 const packConflict=await Catalog.importBatch(existingPool,[product({quantity:"750 g"})]);assert.equal(packConflict.counts.accepted,0);assert(packConflict.rejected[0].reasons.includes("catalog-existing-pack-conflict"));assert.equal(existingPool.state.products[0].packAmount,450);
 existingPool.state.mappings[0].status="review";const mappingConflict=await Catalog.importBatch(existingPool,[product()]);assert.equal(mappingConflict.counts.accepted,0);assert(mappingConflict.rejected[0].reasons.includes("catalog-existing-mapping-needs-review"));assert.equal(existingPool.state.mappings[0].status,"review");
 existingPool.state.mappings[0].status="verified";existingPool.state.mappings[0].confidence=.5;assert.equal((await Catalog.importBatch(existingPool,[product()])).counts.accepted,0);
 existingPool.state.mappings[0].confidence=1;existingPool.state.products[0].gtin="4006381333931";const wrongGtin=await Catalog.importBatch(existingPool,[product()]);assert.equal(wrongGtin.counts.accepted,0);assert(wrongGtin.rejected[0].reasons.includes("catalog-existing-mapping-needs-review"));

 const duplicatePool=fakePool(),duplicate=await Catalog.importBatch(duplicatePool,[product(),product()]);assert.equal(duplicate.counts.accepted,1);assert.equal(duplicate.counts.duplicates,1);assert.equal(duplicatePool.state.products.length,1);
 const contradictory=await Catalog.importBatch(fakePool(),[product(),product({quantity:"500 g"})]);assert.equal(contradictory.counts.accepted,0);assert.equal(contradictory.counts.rejected,2);assert(contradictory.rejected.every(r=>r.reasons.includes("catalog-conflicting-duplicate-gtin")));
 const multipack=await Catalog.importBatch(fakePool(),[product({quantity:"2.0 x 175 g"})]);assert.equal(multipack.accepted[0].pack,"2 x 175 g");assert.equal(multipack.accepted[0].packCount,2);
 const bounded=await Catalog.importBatch(fakePool(),[product(),product({code:gtin(1),product_name_de:"Testprodukt"})],{limit:1});assert.equal(bounded.counts.processed,1);assert.equal(bounded.counts.truncated,true);
 await assert.rejects(()=>Catalog.importBatch(fakePool(),[],{sourceId:"Other"}),/catalog-source-not-supported/);

 const bulkPool=fakePool(),products=Array.from({length:1001},(_,i)=>product({code:gtin(i),product_name_de:"Katalogartikel "+i})),bulk=await Catalog.importBatch(bulkPool,products,{limit:1001});
 assert.equal(bulk.counts.created,1001);assert.equal(bulk.counts.accepted,1001);assert.equal(bulkPool.state.products.length,1001);assert.equal(bulkPool.calls.filter(c=>c.sql==="BEGIN").length,3);assert.equal(bulkPool.calls.filter(c=>c.sql==="RELEASE CONNECTION").length,3);
 assert(bulkPool.calls.length<45,"1001 products must use bounded bulk queries instead of per-product SQL");
 for(const call of bulkPool.calls.filter(c=>c.sql.startsWith("INSERT INTO products(")))assert(JSON.parse(call.args[0]).length<=500);
 const failingPool=fakePool();failingPool.failEvidence=true;await assert.rejects(()=>Catalog.importBatch(failingPool,[product()]),/fixture-evidence-failed/);assert.equal(failingPool.state.products.length,0);assert.equal(failingPool.state.mappings.length,0);assert(failingPool.calls.some(c=>c.sql==="ROLLBACK"));assert(failingPool.calls.some(c=>c.sql==="RELEASE CONNECTION"));
 console.log("canonical-product-catalog-import: German market GTIN/pack identities, bulk transactions, idempotency, Open Prices reuse, conflict review and identity-only provenance OK");
}
main().catch(error=>{console.error(error);process.exitCode=1});
