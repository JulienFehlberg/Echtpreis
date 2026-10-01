"use strict";
const assert=require("node:assert/strict"),Filters=require("../retailer-product-search-filters"),Discovery=require("../published-product-discovery"),Inventory=require("../published-retailer-inventory");
const Dm=require("../published-price-service"),Wolt=require("../wolt-retailer-price-service"),Rewe=require("../rewe-retailer-price-service"),Aldi=require("../aldi-assortment-price-service"),Hit=require("../hit-product-discovery");
const now=Date.parse("2026-10-02T00:00:00Z");
assert.deepEqual(Filters.salesPack("1 l"),{amount:1000,unit:"ml",count:1});assert.deepEqual(Filters.salesPack("0,5 kg"),{amount:500,unit:"g",count:1});
assert.deepEqual(Filters.salesPack("2 × 500 ml"),{amount:500,unit:"ml",count:2});
assert(Filters.matchesPack({packAmount:1,packUnit:"l",packCount:1},Filters.salesPack("1000 ml")));
assert(!Filters.matchesPack({packAmount:500,packUnit:"ml",packCount:2},Filters.salesPack("1 l")),"An equal total volume cannot substitute a different sales pack");
assert(Filters.matchesPack({packAmount:4.9,packUnit:"g",packCount:1},Filters.salesPack("0.0049 kg")));assert(Filters.matchesPack({packAmount:4.1,packUnit:"g",packCount:1},Filters.salesPack("0.0041 kg")));
for(const value of[null,true,{},[],""," ","ca. 1 kg","500 g OR 1=1","0 g","1001 x 1 g","1 l".repeat(40)])assert.throws(()=>Filters.salesPack(value),/invalid-product-pack/);
for(const value of[null,true,"store","mixed","","online OR 1=1"])assert.throws(()=>Filters.channel(value),/invalid-scope-channel/);
for(const service of[Dm,Wolt,Wolt.createService("nahkaufWrangelBerlin"),Rewe,Aldi,Hit]){
 const options={now,search:"Milch",limit:20},base=(service.querySpec||service.searchSpec)(options),single=(service.querySpec||service.searchSpec)({...options,pack:"1 l"}),equivalent=(service.querySpec||service.searchSpec)({...options,pack:"1000 ml"}),multi=(service.querySpec||service.searchSpec)({...options,pack:"2 x 500 ml"});
 assert.deepEqual(single,equivalent,"Unit notation cannot change exact SQL pack identity");
 assert(single.sql.includes("pack_amount-")&&single.sql.includes("pack_unit=")&&single.sql.includes("pack_count="));assert(single.sql.indexOf("pack_amount-")<single.sql.lastIndexOf(" ORDER BY "),"Pack filtering must happen before the bounded SQL lookup");assert(single.sql.includes("*0.000000001"));
 const start=service===Hit?base.params.length:base.params.length-1;assert.deepEqual(single.params.slice(start,start+3),[1000,"ml",1]);assert.deepEqual(multi.params.slice(start,start+3),[500,"ml",2]);assert.equal(single.params[service===Hit?6:single.params.length-1],20);
 assert.throws(()=>(service.querySpec||service.searchSpec)({...options,pack:"ca. 1 l"}),/invalid-product-pack/);
}
async function main(){
 const calls=[],services=Object.fromEntries(["dm","wolt","woltNahkauf","rewe","aldi"].map(key=>[key,{search:async(pool,options)=>{calls.push({key,options});return{items:[]};}}]));
 await Inventory.search({}, {search:"Milch",pack:"1 l",scopeChannel:"pickup",now},services);assert.deepEqual(calls.map(c=>c.key),["rewe"]);assert.equal(calls[0].options.pack,"1 l");
 calls.length=0;await Inventory.search({}, {search:"Milch",scopeChannel:"physical-store",now},services);assert.deepEqual(calls,[]);assert.deepEqual((await Inventory.search({}, {search:"Milch",scopeChannel:"online",now},services)).items,[]);assert.deepEqual(calls.map(c=>c.key),["dm","wolt","woltNahkauf"]);
 let reads=0;const never={search:async()=>{reads++;throw Error("unexpected source read");}};
 for(const service of[Dm,Wolt,Wolt.createService("nahkaufWrangelBerlin"),Rewe,Aldi,Hit]){
  const empty=await service.search({query:async()=>{reads++;throw Error("Unexpected wrong-channel SQL");}},{search:"Milch",pack:"1 l",scopeChannel:service===Hit?"online":"physical-store",now});assert.deepEqual(empty.items,[]);
  await assert.rejects(()=>service.search({query:async()=>{reads++;throw Error("Unexpected invalid-filter SQL");}},{search:"Milch",scopeChannel:"invented",now}),/invalid-scope-channel/);
 }
 for(const options of[{pack:"unknown"},{pack:null},{scopeChannel:"mixed"},{scopeChannel:"assortment-publication"},{merchant:true},{merchant:" "}])await assert.rejects(()=>Discovery.search({}, {search:"Milch",now,...options},never,never),/invalid-/);
 assert.equal(reads,0,"Invalid filters must not reach either database provider");
 await assert.rejects(()=>Inventory.search({}, {scopeChannel:"mixed"},services),/invalid-scope-channel/);
 const empty={search:async()=>({items:[]})};await Discovery.search({}, {search:"Milch",scopeChannel:"physical-store",now},never,empty);await Discovery.search({}, {search:"Milch",scopeChannel:"online",now},empty,never);assert.equal(reads,0,"Unrequested channels do not execute their providers");
 console.log("retailer-product-search-filters: exact pack SQL before caps, equivalent units, distinct multipacks, closed channel scope and no reads for invalid filters OK");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
