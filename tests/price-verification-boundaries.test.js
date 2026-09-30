"use strict";
const assert=require("assert/strict"),Admin=require("../price-admin-auth"),Identity=require("../receipt-product-verification"),Receipt=require("../receipt-price-facts"),Shelf=require("../shelf-price-facts"),Mission=require("../mission-verification");
const env={ECHTPREIS_ADMIN_TOKEN:"private-admin-test",PRICE_IMPORT_TOKEN:"legacy-import-test"};
assert.equal(Admin.authorized({url:"/v1/price-missions/verify",headers:{authorization:"Bearer private-admin-test"}},env),true);
assert.equal(Admin.authorized({url:"/v1/price-missions/verify",headers:{"x-price-import-token":"legacy-import-test"}},env),false);
assert.equal(Admin.authorized({url:"/v1/admin/open-prices/import",headers:{"x-price-import-token":"legacy-import-test"}},env),true);
for(const headers of [{},{authorization:"Bearer incorrect"},{authorization:"Bearer undefined"},{authorization:["Bearer private-admin-test"]}])assert.equal(Admin.authorized({headers},env),false);
assert.equal(Admin.sameToken("",""),false);assert.equal(Admin.authorized({headers:{authorization:"Bearer x"}},{}),false);
for(const url of ["/v1/price-missions/verify","/v1/admin/open-prices/import","/v1/admin/future-path"])assert.equal(Admin.protectedRoute({method:"POST",url}),true);
const product={id:"canonical",name:"Nutella",brand:"Ferrero",gtin:"3017620422003",packAmount:450,packUnit:"g",packCount:1};
assert.equal(Identity.verify({productId:"canonical",rawName:"Butter 250g"},product),false);
assert.equal(Identity.verify({gtin:product.gtin},product),true);
assert.equal(Identity.verify({gtin:"garbage"+product.gtin},product),false);
assert.equal(Identity.verify({rawName:"Ferrero Nutella 450 g"},product),true);
assert.equal(Identity.verify({rawName:"Ferrero Nutella 750 g"},product),false);
assert.equal(Identity.verify({rawName:"Ferrero Nutella 1980 ml"},{...product,packAmount:330,packUnit:"ml",packCount:6}),false);
assert.equal(Receipt.unitPaid({itemCount:1,lineTotal:2.49,price:3.99}),2.49);
for(const itemCount of [NaN,Infinity,0,-1,1.5])assert.equal(Receipt.unitPaid({itemCount,lineTotal:2.49,price:3.99}),null);
const stamp=new Date("2026-09-30T10:00:00Z"),receipt={id:"receipt",merchant:"EDEKA",storeId:"store",purchasedAt:stamp},item={rawName:"Nutella 450 g",price:3.99};
const observed=Receipt.observation(receipt,item,{identityVerified:true});assert.equal(observed.status,"observed");assert.equal(observed.date,"2026-09-30");assert.equal(observed.proofVerified,false);
assert.equal(Receipt.observation(receipt,item,{identityVerified:true,proofVerified:true}).status,"verified");
assert.equal(Receipt.observation({...receipt,purchasedAt:"2026-02-30"},item),null);
for(const value of [NaN,Infinity,-1,0]){assert.equal(Receipt.observation(receipt,{...item,price:value}),null);assert.equal(Shelf.fact({product:"Nutella",productId:"p",storeId:"s",price:value,proof:"photo"}).ok,false);assert.equal(Mission.validate({storeMatch:true,productMatch:true,proofValid:true,price:value}).ok,false)}
const shelf=Shelf.fact({product:"Nutella",productId:"p",storeId:"s",price:3.99,proof:"photo",observedAt:stamp},{store:true,product:true,proof:true}).value;
assert.equal(shelf.date,"2026-09-30");assert.equal(shelf.identityVerified,true);assert.equal(shelf.proofVerified,true);
assert.equal(Mission.validate({storeMatch:"true",productMatch:1,proofValid:"true",price:3.99}).ok,false);
(async()=>{
 const api=require("../server");await new Promise(resolve=>api.server.listen(0,"127.0.0.1",resolve));
 try{for(const path of ["/v1/price-missions/verify","/v1/admin/open-prices/import","/v1/admin/future-path"]){const response=await fetch("http://127.0.0.1:"+api.server.address().port+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({storeMatch:true,productMatch:true,proofValid:true})});assert.equal(response.status,403);assert.equal((await response.json()).error,"forbidden");assert(response.headers.get("access-control-allow-headers").includes("Authorization"))}}
 finally{await new Promise(resolve=>api.server.close(resolve));await api.closeDb()}
 console.log("price-verification-boundaries: canonical receipt identity, server proof flags, native dates, finite prices and HTTP admin authorization OK");
})().catch(error=>{console.error(error);process.exitCode=1});
