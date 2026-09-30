const assert=require("assert"),T=require("../current-price-truth");
let x=T.fuse([{price:3.99,sourceType:"official_retailer",sourceId:"edeka",storeId:"s1"},{price:3.99,sourceType:"receipt",proof:"receipt:r1",storeId:"s1"},{price:4.99,sourceType:"third_party",sourceId:"x",storeId:"s1"}]);assert.strictEqual(x.price,3.99);assert(x.independentEvidence>=2);
x=T.fuse([{price:3.99,sourceType:"official_retailer",sourceId:"edeka",storeId:"s1"},{price:3.99,sourceType:"official_retailer",sourceId:"edeka",storeId:"s1"},{price:3.99,sourceType:"official_retailer",sourceId:"edeka",storeId:"s1"}]);assert.strictEqual(x.independentEvidence,1);
x=T.fuse([{price:3.99,sourceType:"official_retailer",sourceId:"a",storeId:"s1"},{price:3.99,sourceType:"receipt",proof:"receipt:r1",storeId:"s1"},{price:4.99,sourceType:"official_retailer",sourceId:"b",storeId:"s1"},{price:4.99,sourceType:"receipt",proof:"receipt:r2",storeId:"s1"}]);assert.strictEqual(x.state,"conflict");assert.strictEqual(x.price,null);
x=T.fuse([{price:3.99,sourceType:"receipt",proof:"42",proofActor:"u1",storeId:"s1",gtin:"4000000000015"},{price:3.99,sourceType:"receipt",proof:"42",proofActor:"u2",storeId:"s1",gtin:"4000000000015"}]);assert.strictEqual(x.independentEvidence,1);
x=T.fuse([{price:3.99,sourceType:"receipt",proof:"42",proofActor:"u1",storeId:"s1",gtin:"4000000000015"},{price:3.99,sourceType:"receipt",proof:"42",proofActor:"u1",storeId:"s1",gtin:"4000000000015"}]);assert.strictEqual(x.independentEvidence,1);
x=T.fuse([{price:3.99,sourceType:"receipt",proof:"r1",proofActor:"u1",storeId:"s1",registryTrust:99}]);assert.strictEqual(x.state,"observed");
x=T.fuse([{price:3.99,sourceType:"official_retailer",sourceId:"edeka",storeId:"s1"}]);assert.strictEqual(x.state,"supported");assert.strictEqual(x.reason,"authoritative-source");
x=T.fuse([{price:3.99,sourceType:"receipt",proof:"upload-a",proofHash:"same-bytes",proofActor:"u1",storeId:"s1",gtin:"4000000000015"},{price:3.99,sourceType:"receipt",proof:"upload-b",proofHash:"same-bytes",proofActor:"u2",storeId:"s1",gtin:"4000000000015"}]);assert.strictEqual(x.independentEvidence,1);
x=T.fuse([{price:3.99,sourceType:"receipt",proof:"upload-a",proofHash:"bytes-a",proofActor:"u1",storeId:"s1",gtin:"4000000000015"},{price:3.99,sourceType:"receipt",proof:"upload-b",proofHash:"bytes-b",proofActor:"u2",storeId:"s1",gtin:"4000000000015"}]);assert.strictEqual(x.independentEvidence,2);
assert.strictEqual(T.truthTier({sourceType:"pos_feed"}),1);assert.strictEqual(T.truthTier({sourceType:"official_retailer"}),2);assert.strictEqual(T.truthTier({sourceType:"open_data"}),3);
x=T.fuse([{price:1.39,sourceType:"pos_feed",storeId:"s",productId:"p"}]);assert.strictEqual(x.state,"supported");assert.strictEqual(x.reason,"authoritative-source");
x=T.fuse([{price:.01,source:"Open Food Facts",sourceType:"product_catalog",sourceId:"Open Food Facts",storeId:"s1"},{price:3.99,sourceType:"official_retailer",sourceId:"feed",storeId:"s1"}]);assert.strictEqual(x.price,3.99);assert.strictEqual(x.state,"supported");
x=T.fuse([{price:.01,source:"Open Food Facts",sourceType:"product_catalog",sourceId:"Open Food Facts",storeId:"s1"}]);assert.strictEqual(x.state,"unknown");assert.strictEqual(x.reason,"no-truth-eligible-evidence");
console.log("current-price-truth: ok");

{
 const a={price:2.49,sourceType:"official_retailer",storeId:"s",productId:"p",proof:"earlier",observedAt:"2026-09-30T09:00:00Z"},b={...a,price:2.50,proof:"later",observedAt:"2026-09-30T12:00:00Z"};
 const quote=T.fuse([a,b]);assert.strictEqual(quote.price,2.50,"fusion must select an evidenced price instead of manufacturing 2.495");assert.strictEqual(quote.representative.proof,"later");assert.strictEqual(T.fuse([b,a]).price,quote.price,"selection must not depend on ingestion order");
 const majority=T.fuse([a,{...a,proof:"independent"},b]);assert.strictEqual(majority.price,2.49,"greater support for an actual quote should win within a tolerance cluster");
 assert.strictEqual(T.fuse([{...a,price:Infinity}]).state,"unknown");assert.strictEqual(T.fuse([{...a,price:Infinity},a]).price,2.49);
}

{
 const receipt={price:2.49,sourceType:"receipt",storeId:"s",productId:"p",proof:"upload-1",proofHash:"same-image-bytes"},open={...receipt,sourceType:"open_data",proof:"open-prices-2"};
 const sameImage=T.fuse([receipt,open]);assert.strictEqual(sameImage.independentEvidence,1,"the same image imported through two source types is one piece of evidence");assert.strictEqual(sameImage.state,"observed");
 assert.strictEqual(T.independent([receipt,{...open,storeId:"other-store"}]),2,"hash identity must retain store scope");assert.strictEqual(T.independent([receipt,{...open,productId:"other-product"}]),2,"one image can contain separate product observations");
 assert.strictEqual(T.independent([{...receipt,proofHash:null},{...open,proofHash:null,proof:receipt.proof}]),2,"source-local proof IDs retain their namespace when no hash exists");
}
