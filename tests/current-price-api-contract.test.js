const assert=require("assert"),fs=require("fs"),path=require("path");
const s=fs.readFileSync(path.join(__dirname,"..","server.js"),"utf8"),x=fs.readFileSync(path.join(__dirname,"..","current-price-query-service.js"),"utf8");
assert(s.includes('CurrentPriceQuery.compareCurrentPrices(pool,b)'),"current price HTTP route must use the shared query service");
for(const field of ['AS "regularPrice"','AS "minQuantity"','AS "externalLocationId"','AS "externalProductId"','AS "proofActor"','AS "sourceType"'])assert(x.includes(field),"current price SQL missing "+field);
assert(!s.includes('resolveStore({merchant:clean(b.store),externalId:clean(b.storeExternalId)'));
assert(!s.includes('recordStoreAliasEvidence(receipt,store.id,clean(b.storeExternalId))'));
const bi=s.indexOf('req.url==="/v1/current-price-benchmark"'),benchmark=s.slice(bi,bi+1700),bx=x;
assert(benchmark.includes('CurrentPriceQuery.compareCurrentPrices(pool,{product'),"benchmark must reuse the same scoped price query service");
console.log("current-price-api-contract: ok");

for(const section of [x,bx]){
 for(const field of [' AS brand',' AS pack','AS "proofHash"','LEFT JOIN products p ON p.id=po.product_id'])
  assert(section.includes(field),"current price path drops SKU or proof identity: "+field);
}
