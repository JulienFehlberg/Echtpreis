const assert=require("assert"),T=require("../temporal-price-intelligence");
const hist=[2.99,2.99,3.09,2.89,2.99,3.19,2.99,2.99].map((price,i)=>({price,date:"2026-09-"+String(20+i).padStart(2,"0"),priceType:"regular",storeId:"s1"}));
let b=T.baseline(hist,{today:"2026-09-30",storeId:"s1"});assert.strictEqual(b.samples,8);assert(b.median>2.9&&b.median<3.1);
let strong=T.dealStrength(2.39,b);assert(["strong","exceptional"].includes(strong.grade));assert(strong.discountPct>15);
let weak=T.dealStrength(2.89,b);assert.notStrictEqual(weak.grade,"exceptional");
assert.strictEqual(T.pricePosition(b.low,b),"historical-low");
let cs=T.changes([{price:2.99,date:"2026-09-20"},{price:3.19,date:"2026-09-21"},{price:3.19,date:"2026-09-22"}]);assert.strictEqual(cs.length,1);assert(cs[0].deltaPct>6);
console.log("temporal-price-intelligence: ok");