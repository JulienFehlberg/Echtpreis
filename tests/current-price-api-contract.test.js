const assert=require("assert"),fs=require("fs"),path=require("path");
const s=fs.readFileSync(path.join(__dirname,"..","server.js"),"utf8"),i=s.indexOf('req.url==="/v1/current-prices"'),x=s.slice(i,i+3500);
for(const field of ['AS "regularPrice"','AS "minQuantity"','AS "externalLocationId"','AS "externalProductId"','AS "proofActor"','AS "sourceType"'])assert(x.includes(field),"current price SQL missing "+field);
assert(!s.includes('resolveStore({merchant:clean(b.store),externalId:clean(b.storeExternalId)'));
assert(!s.includes('recordStoreAliasEvidence(receipt,store.id,clean(b.storeExternalId))'));
console.log("current-price-api-contract: ok");
