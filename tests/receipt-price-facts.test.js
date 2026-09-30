const assert=require("assert"),R=require("../receipt-price-facts");
const receipt={id:"r1",merchant:"EDEKA",storeId:"s1",purchasedAt:"2026-09-30T10:00:00Z"};
const item={rawName:"Nutella 450g",productId:"p1",gtin:"4008400401627",price:3.99,matchConfidence:.99};
const unsafe=R.observation(receipt,item);assert.strictEqual(unsafe.status,"observed");assert.strictEqual(unsafe.trust,70);assert.strictEqual(R.eligibleForExact(unsafe),false);
const safe=R.observation(receipt,item,{identityVerified:true});assert.strictEqual(safe.status,"verified");assert.strictEqual(safe.trust,92);assert.strictEqual(R.eligibleForExact(safe),true);
console.log("receipt-price-facts: identity gate ok");

assert.strictEqual(R.unitPaid({lineTotal:2.49,price:3.99,itemCount:1}),2.49);
assert.strictEqual(R.unitPaid({lineTotal:5.98,itemCount:2}),2.99);
assert.strictEqual(R.unitPaid({price:2.49}),2.49);
for(const qty of [0,-1,1.5,1001,Infinity,"Infinity","invalid"]){
 assert.strictEqual(R.unitPaid({lineTotal:5.98,itemCount:qty}),null);
 assert.strictEqual(R.observation(receipt,{...item,lineTotal:5.98,itemCount:qty},{identityVerified:true}),null);
}
for(const lineTotal of [0,-1,Infinity,"Infinity","invalid"])
 assert.strictEqual(R.unitPaid({lineTotal,price:2.49}),null);
console.log("receipt-price-facts: paid amount and quantity regression ok");
