"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),Selector=require("../app/automatic-product-choice"),Products=require("../app/published-product-client");
const capture=require("./fixtures/retailers/automatic-choice-berlin-capture.json"),now=Date.parse(capture.ownApiCapturedAt),clone=x=>JSON.parse(JSON.stringify(x)),rows=name=>clone(capture.responses.find(r=>r.search===name).items);
const select=(raw,key,items,extra={})=>Selector.choose({wish:{raw,key,explicitAmount:null,...extra},items,now});
// Real archived API DTOs, frozen to the original capture time. No fixture is a
// claim of current live availability, a physical-store price or full coverage.
assert.equal(capture.currentPriceProof,false);
const milk=select("Milch","milch",rows("Milch")),cookies=select("Kekse","kekse",rows("Kekse")),nutella=select("Nutella","nutella",rows("Nutella"));
assert.equal(milk.selection.name,"Weihenstephan Haltbare Milch 1,5%, 1 l");assert.equal(milk.unitPrice,1.79);assert.equal(milk.unit,"l");
assert.equal(cookies.selection.name,"Lotus Biscoff Kekse, 150 g");assert.equal(cookies.unit,"kg");assert.equal(cookies.offer.price,2.39);
assert.equal(nutella.selection.pack,"750 g");assert.equal(nutella.offer.price,6.89);assert(nutella.unitPrice<4.79/.45,"750g has the cheaper unit price despite the larger ticket price");
for(const choice of[milk,cookies,nutella]){assert.equal(choice.scopeChannel,"online");assert.equal(choice.offer.merchant,"EDEKA");assert.equal(choice.offer.truthEligible,false);assert.equal(choice.reason,"cheapest-found-unit-price");assert(Products.selection(choice.selection));assert(!Object.hasOwn(choice.selection,"price"));assert(!Object.hasOwn(choice.selection,"productId"));}
assert.equal(select("Nutella 450g","nutella",rows("Nutella"),{explicitAmount:{amount:450,unit:"g",packCount:1}}).selection.pack,"450 g");
assert.equal(select("Nutella450g",null,rows("Nutella"),{explicitAmount:{amount:450,unit:"g",packCount:1}}).selection.pack,"450 g");
assert.equal(select("Milch 3,5%","milch",rows("Milch")),null,"The archived 3.5% variants are explicitly unavailable");
assert.equal(select("H-Milch 1,5%","milch",rows("Milch")).selection.name,"Weihenstephan Haltbare Milch 1,5%, 1 l");
assert.equal(select("Milch laktosefrei","milch",rows("Milch")),null,"An explicit missing property stays open");
assert.equal(select("Milch ohne Zucker","milch",rows("Milch")),null,"Unsupported negative wishes are not weakened");
assert.equal(select("Milch 500ml","milch",rows("Milch"),{explicitAmount:{amount:500,unit:"ml",packCount:1}}),null);
assert.equal(select("Milka Kekse","kekse",rows("Kekse")).selection.name,"Milka Choc & Choc Kekse, 175 g");
assert.equal(select("Lotus Kekse","kekse",rows("Kekse")).selection.name,"Lotus Biscoff Kekse, 150 g");
assert.equal(select("Nutella","nutella",rows("Nutella").filter(x=>x.name.includes("Biscuits")||x.name.includes("Go!")||x.name.includes("Ice Cream"))),null,"Other Nutella products never replace the named spread");
const cream=rows("Nutella")[0];cream.name="Nuss-Nougat-Creme";cream.offers=cream.offers.map(o=>({...o,name:cream.name,price:.50,displayedPrice:.50}));assert.equal(select("Nutella","nutella",[cream]),null);
// Synthetic mutations test boundaries; these are never imported as price facts.
for(const patch of[{current:false},{expiresAt:new Date(now).toISOString()},{capturedAt:new Date(now+1).toISOString()},{availability:"unavailable"},{priceType:"loyalty"},{priceType:"app"},{conditional:true,priceType:"unknown"},{minQuantity:2,priceType:"unknown"},{quantityRequired:2},{promotionStatus:"coupon"},{scopeCountry:"AT"},{truthEligible:true},{gtin:"4008452027588"},{pack:"600 g",packAmount:600,packUnit:"g"},{proofHash:"missing"}]){const item=rows("Milch").find(x=>x.name===milk.selection.name);item.offers=item.offers.map(o=>({...o,...patch}));assert.equal(select("Milch","milch",[item]),null,JSON.stringify(patch));}
const wrongHeadline=rows("Milch").find(x=>x.name===milk.selection.name);wrongHeadline.offers=wrongHeadline.offers.map(o=>({...o,name:"Elkos Reinigungsmilch, 1 l"}));assert.equal(select("Milch","milch",[wrongHeadline]),null,"Native offer title, not group title, governs semantic suitability");
assert.equal(select("Milch","milch",[rows("Milch")[2],rows("Milch")[2]]),null,"Duplicate identities cannot pick an arbitrary group");
assert.equal(select("Milch","milch",rows("Milch"),{ean:milk.selection.gtin}),null);assert.equal(select("Milch","milch",rows("Milch"),{selectedProduct:milk.selection}),null);
for(const amount of[{amount:NaN,unit:"ml",packCount:1},{amount:0,unit:"ml",packCount:1},{amount:1000,unit:"l",packCount:1},{amount:1000,unit:"ml",packCount:0}])assert.equal(select("Milch","milch",rows("Milch"),{explicitAmount:amount}),null);
const delivery=rows("Milch").find(x=>x.name===milk.selection.name),pickup=clone(delivery);
pickup.offers=pickup.offers.map(o=>({...o,sourceId:"REWE Berlin pickup",merchant:"REWE",nativeVenueId:null,nativeMarketId:"8321066",scopeChannel:"pickup",sourceUrl:"https://www.rewe.de/shop/p/test-milch/1234567",shop:{nativeMarketId:"8321066",name:"REWE Steven Horn oHG",address:"Hallesches Ufer 40",postalCode:"10963",city:"Berlin",country:"DE"},price:5,displayedPrice:5,deposit:null,payablePackPrice:null}));
const combined=clone(delivery);combined.offers.push(...pickup.offers);const separate=select("Milch","milch",[combined]);assert(separate);assert.equal(separate.offer.price,5);assert.equal(separate.scopeChannel,"pickup");assert.deepEqual(separate.channelAlternatives,["online"],"Channels are not ranked together by monetary amount");
const inputBefore=JSON.stringify(capture);select("Milch","milch",capture.responses[0].items);assert.equal(JSON.stringify(capture),inputBefore,"Choosing never mutates captured source evidence");
const browser={SparkorbPublishedProductClient:Products,SparkorbShoppingNeedMatcher:require("../shopping-need-matcher")};vm.runInNewContext(fs.readFileSync("app/automatic-product-choice.js","utf8"),{window:browser});assert.equal(browser.CaddyAutomaticProductChoice.choose({wish:{raw:"Nutella",key:"nutella",explicitAmount:null},items:rows("Nutella"),now}).selection.pack,"750 g","UMD browser and server share selection rules");
assert.equal(Selector.choose({wish:{raw:"Milch",key:"milch"},items:Array(21).fill(delivery),now}),null);
console.log("automatic-product-choice: archived Berlin milk/cookies/Nutella; unit prices, explicit wishes, native identities, channel/expiry/brand/pack boundaries OK");
