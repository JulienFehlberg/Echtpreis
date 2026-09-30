const assert=require("assert"),C=require("../current-price-coverage");
const s=C.summarize([{merchant:"EDEKA",price:3.99,state:"verified",observedAt:"2026-09-30T10:00:00Z",sourceType:"open_data"},{merchant:"EDEKA",price:null,state:"unknown"},{merchant:"REWE",price:2.49,state:"observed",observedAt:"2026-09-29T10:00:00Z",sourceType:"retailer_feed"}],{today:"2026-09-30"});
assert.strictEqual(s.bySource.open_data,1);assert.strictEqual(s.bySource.retailer_feed,1);assert.deepStrictEqual(s.byMerchant.EDEKA,{total:2,known:1,verified:1});assert.deepStrictEqual(s.byMerchant.REWE,{total:1,known:1,verified:0});
console.log("current-price-coverage: ok");
