const assert=require("assert"),fs=require("fs"),path=require("path");
const s=fs.readFileSync(path.join(__dirname,"..","server.js"),"utf8"),x=fs.readFileSync(path.join(__dirname,"..","current-price-query-service.js"),"utf8");
assert(s.includes('CurrentPriceQuery.compareCurrentPrices(pool,b)'),"current price HTTP route must use the shared query service");
for(const field of ['AS "regularPrice"','AS "minQuantity"','AS "externalLocationId"','AS "externalProductId"','AS "proofActor"','AS "sourceType"'])assert(x.includes(field),"current price SQL missing "+field);
assert(!s.includes('resolveStore({merchant:clean(b.store),externalId:clean(b.storeExternalId)'));
assert(!s.includes('recordStoreAliasEvidence(receipt,store.id,clean(b.storeExternalId))'));
const bi=s.indexOf('req.url==="/v1/current-price-benchmark"'),benchmark=s.slice(bi,bi+900),bx=x;
const benchmarkService=fs.readFileSync(path.join(__dirname,"..","current-price-benchmark-service.js"),"utf8");
assert(benchmark.includes('PriceBenchmarkService.compare(pool,b)'),"benchmark must preserve exact product and store inputs through its shared service");
assert(benchmarkService.includes('query.compareCurrentPrices(pool,prepared.requests[index],{includeRefreshTargets:false})'),"benchmark must reuse the scoped price query without source requests");
console.log("current-price-api-contract: ok");

for(const section of [x,bx]){
 for(const field of [' AS brand',' AS pack','AS "proofHash"','LEFT JOIN products p ON p.id=po.product_id'])
  assert(section.includes(field),"current price path drops SKU or proof identity: "+field);
}
