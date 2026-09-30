const assert=require("assert"),S=require("../price-mission-submissions");
let x=S.submission({storeId:"s",productId:"p",price:3.99,proof:"photo:abc",observedAt:"2026-09-30T10:00:00Z"});assert(x.ok);assert.strictEqual(x.state,"submitted");assert.strictEqual(S.rewardable({...x,rewardPoints:70}),false);
let bad=S.verify(x,{storeMatch:true,productMatch:false,proofValid:true});assert.strictEqual(bad.state,"review");
let good=S.verify(x,{storeMatch:true,productMatch:true,proofValid:true,confidence:.95});assert(good.ok);assert.strictEqual(good.state,"verified");
assert.strictEqual(S.fingerprint({storeId:"s",productId:"p",proof:"a",observedAt:"2026-09-30"}),S.fingerprint({storeId:"s",productId:"p",proof:"a",observedAt:"2026-09-30T23:00:00Z"}));
console.log("price-mission-submissions: ok");