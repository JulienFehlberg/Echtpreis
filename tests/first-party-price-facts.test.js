const assert=require("assert"),R=require("../receipt-price-facts"),S=require("../shelf-price-facts");
assert.strictEqual(R.unitPaid({lineTotal:8.97,itemCount:3,price:8.97}),2.99);
let o=R.observation({id:"r1",merchant:"EDEKA",storeId:"s1",purchasedAt:"2026-09-30T10:00:00Z"},{rawName:"Rinderhack 500g",price:3.99,productId:"p1",priceType:"regular"});assert.strictEqual(o.price,3.99);assert.strictEqual(o.kind,"receipt");assert.strictEqual(o.status,"observed");assert.strictEqual(o.identityVerified,false);
assert.strictEqual(R.observation({id:"r1"},{rawName:"Pfand",price:.25,isDeposit:true}),null);
let sh=S.fact({product:"Rinderhack 500 g",storeId:"s1",price:3.99,proof:"photo:1",matchConfidence:.95,observedAt:"2026-09-30"});assert(sh.ok);assert.strictEqual(sh.value.status,"observed");
assert.strictEqual(S.fact({product:"Rinderhack",storeId:"s1",price:3.99,proof:"photo:2",matchConfidence:.5}).ok,false);
console.log("first-party price facts: ok");