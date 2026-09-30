const assert=require("assert"),R=require("../receipt-price-facts");
const receipt={id:"r1",merchant:"EDEKA",storeId:"s1",purchasedAt:"2026-09-30T10:00:00Z"};
const item={rawName:"Nutella 450g",productId:"p1",gtin:"4008400401627",price:3.99,matchConfidence:.99};
const unsafe=R.observation(receipt,item);assert.strictEqual(unsafe.status,"observed");assert.strictEqual(unsafe.trust,70);assert.strictEqual(R.eligibleForExact(unsafe),false);
const safe=R.observation(receipt,item,{identityVerified:true,proofVerified:true});assert.strictEqual(safe.status,"verified");assert.strictEqual(safe.trust,92);assert.strictEqual(R.eligibleForExact(safe),true);
const identityOnly=R.observation(receipt,item,{identityVerified:true});assert.strictEqual(identityOnly.status,"observed");assert.strictEqual(identityOnly.proofVerified,false);
console.log("receipt-price-facts: identity gate ok");
