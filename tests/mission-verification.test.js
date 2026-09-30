const assert=require("assert"),S=require("../shelf-price-facts"),V=require("../mission-verification");
let a=S.fact({product:"Butter 250g",productId:"p",storeId:"s",price:2.49,proof:"photo:x"});assert(a.ok);assert.strictEqual(a.value.status,"observed");assert.strictEqual(a.value.trust,65);
let v=V.validate({storeMatch:true,productMatch:true,proofValid:true,price:2.49,confidence:.95});assert(v.ok);
let b=S.fact({product:"Butter 250g",productId:"p",storeId:"s",price:2.49,proof:"photo:x"},v.verification);assert.strictEqual(b.value.status,"verified");assert.strictEqual(b.value.trust,90);
assert.strictEqual(V.points(90),100);assert.strictEqual(V.points(70),45);assert.strictEqual(V.points(20),0);
let replay=V.validate({storeMatch:true,productMatch:true,proofValid:true,price:2.49,confidence:.99,replayDetected:true});assert.strictEqual(replay.ok,false);assert(replay.errors.includes("replay"));assert.strictEqual(replay.verification.replayFree,false);
console.log("mission-verification: ok");