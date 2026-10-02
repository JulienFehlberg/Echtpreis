"use strict";
const assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path"),Pack=require("../wolt-sales-pack-validation"),Client=require("../wolt-retailer-price-client"),Service=require("../wolt-retailer-price-service"),Current=require("../app/current-price-client");
const original=require("./fixtures/retailers/wolt-elinas-original-multipack.json"),fixture=require("./fixtures/retailers/wolt-edeka-berlin.json");
const cases=[
 ["Elinas Joghurt Natur 9,4%, 4 x 150 g",600,"g",1,true],
 ["Elinas Joghurt Natur 9,4%, 4 x 150 g",150,"g",4,false],
 ["Joghurt 4 x 150 g",100,"g",6,true],
 ["Joghurt ４ × １５０ ｇ",150,"g",4,false],
 ["Joghurt 4 x 0,15 kg",150,"g",4,false],
 ["Wasser 6 x 0.5 l",500,"ml",6,false],
 ["Wasser 6 X 50 CL",3000,"ml",1,true],
 ["Tücher 3 x 4 Stück",4,"piece",3,false],
 ["Tücher 3 x 4 Stück",12,"piece",1,true],
 ["Joghurt 4 x 150 g",149.85,"g",4,false],
 ["Joghurt 4 x 150 g",149.84,"g",4,true],
 ["SYNTHETIC zero amount 1 x 0 g",.001,"g",1,true],
 ["Joghurt 4 x 150 g und 6 x 100 g",150,"g",4,true],
 ["Dose 20 x 30 cm, 37 g",37,"g",1,false],
 ["Produktmodell X5 37 g",37,"g",1,false],
 ["Rezeptbuch für 6 Personen, 37 g",37,"g",1,false],
 ["Snack 2,5x37g",37,"g",1,false],
 ["Snack 5x37grams",37,"g",1,false]
];
const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../wolt-sales-pack-validation.js"),"utf8"),sandbox);
for(const[name,amount,unit,count,expected]of cases){assert.equal(Pack.structureUnresolved(name,amount,unit,count),expected,name);assert.equal(sandbox.window.CaddyWoltSalesPackValidator.structureUnresolved(name,amount,unit,count),expected,"browser: "+name);}
assert.equal(Pack.multipackConflict(cases[0][0],600,"g",1),false,"Aggregate arithmetic alone cannot establish the sales pack");
assert.equal(original.evidenceKind,"archived-original-native-item");assert.equal(original.currentPriceProof,false);assert.equal(original.nativeItem.id,"f4f809d32c853e0e4edf784c");assert.equal(original.nativeItem.barcode_gtin,"4003490323600");assert.equal(original.nativeItem.unit_info,"600 g");assert.equal(original.nativeItem.name,cases[0][0]);
const shop=Client.parseVenue('<script type="application/json" class="query-state">'+JSON.stringify(fixture.venueState)+'</script>',{capturedAt:fixture.capturedAt}),now=Date.parse(fixture.capturedAt),proof={shop,capturedAt:fixture.capturedAt,sourceResponseUrl:Client.API_ORIGIN+Client.API_PATH+"/categories/slug/test-native-category",sourceResponseHash:original.sourceFileSha256},snapshot=JSON.stringify(original);
const held=Client.parseItems([original.nativeItem],proof);assert.equal(held.received,1);assert.equal(held.offers.length,0);assert(held.rejected[0].reasons.includes("wolt-native-sales-pack-structure-unresolved"));assert.equal(JSON.stringify(original),snapshot,"Archived original data stays untouched; historical capture is not current proof");
const synthetic={...original.nativeItem,unit_info:"4 x 150 g"},parsed=Client.parseItems([synthetic],proof);assert.equal(parsed.offers.length,1,"Synthetic test with explicit native structure can be admitted");const admitted=Service.validateOffer(parsed.offers[0],{now});assert.equal(admitted.ok,true,JSON.stringify(admitted.reasons));assert.equal(admitted.offer.packCount,4);assert.equal(admitted.offer.packAmount,150);assert.equal(admitted.offer.price,2.59);
const quote={...admitted.offer,state:"published",current:true},context={now,today:fixture.capturedAt.slice(0,10)},query={gtin:quote.gtin,pack:"4 x 150 g"};assert(Current.normalizePublishedAlternative(quote,query,context));assert(Current.normalizePublishedReference(quote,context));assert.equal(Current.normalizePublishedAlternative(quote,{...query,pack:"600 g"},context),null,"Equal totals do not match single and multipack requests");
const aggregate={...quote,pack:"600 g",packAmount:600,packCount:1};assert.equal(Current.normalizePublishedAlternative(aggregate,{...query,pack:"600 g"},context),null);assert.equal(Current.normalizePublishedReference(aggregate,context),null,"An unsafe DTO cannot leak into a Berlin reference");
const different={...quote,pack:"6 x 100 g",packAmount:100,packCount:6};assert.equal(Current.normalizePublishedReference(different,context),null,"Equal total with different structure stays held");
const bars={...quote,name:"SYNTHETIC Müsliriegel 8 x 25 g",pack:"200 g",packAmount:200,packCount:1};assert.equal(Current.normalizePublishedReference(bars,context),null);
const currentSource=fs.readFileSync(path.join(__dirname,"../app/current-price-client.js"),"utf8"),browser={window:{},URL};vm.runInNewContext(currentSource,browser);assert.equal(browser.window.SparkorbCurrentPriceClient.normalizePublishedReference(quote,context),null,"Missing browser validator fails closed");
sandbox.URL=URL;vm.runInNewContext(currentSource,sandbox);assert(sandbox.window.SparkorbCurrentPriceClient.normalizePublishedReference(quote,context));assert.equal(sandbox.window.SparkorbCurrentPriceClient.normalizePublishedReference(aggregate,context),null,"Browser uses the shared original-structure predicate");
console.log("wolt-sales-pack-validation: archived original Elinas aggregate held, native individual count/quantity required, equal-total variants excluded in browser/current/Berlin references, units/NFKC/tolerance shared, no inferred pack or renewed capture OK");
