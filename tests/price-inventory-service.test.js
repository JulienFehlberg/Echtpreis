"use strict";
const assert=require("assert/strict");
const Inventory=require("../price-inventory-service");
const Auth=require("../price-admin-auth");
const Import=require("../external-price-import");
const stamp=Date.parse("2026-09-30T12:00:00Z");
assert.equal(Inventory.due(null,stamp),true);
assert.equal(Inventory.due({status:"finished",finishedAt:"2026-09-30T11:30:00Z"},stamp),false);
assert.equal(Inventory.due({status:"partial",finishedAt:"2026-09-30T11:58:00Z"},stamp),true,"An unfinished bounded scan must resume without waiting an hour");
assert.equal(Inventory.due({status:"failed",finishedAt:"2026-09-30T11:58:00Z"},stamp),false,"A failed upstream must not be hammered each minute");
assert.equal(Inventory.due({status:"failed",finishedAt:"2026-09-30T11:54:00Z"},stamp),true);
const env={SPARKORB_INVENTORY_TOKEN:"inventory-only"};
for(const url of ["/v1/price-missions/verify","/v1/admin/open-prices/import","/v1/admin/product-store-coverage"]){const req={method:"POST",url,headers:{authorization:"Bearer inventory-only"}};assert.equal(Auth.protectedRoute(req),true);assert.equal(Auth.authorized(req,env),false)}
const req={method:"POST",url:"/v1/admin/price-inventory/refresh",headers:{authorization:"Bearer inventory-only"}};
assert.equal(Auth.authorized(req,env),true);assert.equal(Auth.authorized(req,{}),false);
assert.equal(Import.observation({price:5,per:"kg",product:"Known 250 g pack"},"batch").per,"kg","A unit-price observation must keep its basis until the resolver derives the package price");
assert.equal(Import.observation({price:5,product:"Known pack"},"batch").per,"item");
console.log("price-inventory-service: continuation/failure cadence, scoped admin token and unit-price persistence OK");
