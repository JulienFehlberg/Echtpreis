const assert=require("assert"),C=require("../current-price-connector"),R=require("../current-price-connectors"),B=require("../current-price-benchmark"),I=require("../external-price-import"),Resolver=require("../current-price-resolver");
let x=C.ingest(R.contracts.receipt,[{merchant:"EDEKA",product:"Milch 1L",price:"1,19",observedAt:"2026-09-30",proof:"receipt:1"}]);assert.strictEqual(x.accepted.length,1);assert.strictEqual(x.accepted[0].price,1.19);
let blocked=C.ingest(R.contracts.rewe,[{product:"Milch",price:1.09,proof:"x"}]);assert.strictEqual(blocked.accepted.length,0);assert.strictEqual(blocked.rejected[0].reasons[0],"connector-not-approved");
let m=B.matrix([{product:"Hackfleisch",merchant:"EDEKA",price:3.99,state:"observed"}],["Hackfleisch"],["EDEKA","Lidl"]);assert.strictEqual(m.totalCells,2);assert.strictEqual(m.knownCells,1);assert.strictEqual(m.currentCoverage,.5);assert.strictEqual(m.missing[0].merchant,"Lidl");
assert.strictEqual(R.contracts.openPrices.allowed,true);assert.strictEqual(R.contracts.openPrices.truthEligible,true);assert.strictEqual(R.contracts.openFoodFacts.allowed,false);assert.strictEqual(R.contracts.openFoodFacts.truthEligible,false);assert.strictEqual(R.contracts.openFoodFacts.termsStatus,"identity-only");assert.strictEqual(R.contracts.germanSupermarketDataset.allowed,false);assert.strictEqual(R.contracts.reweDailyDataset.truthEligible,false);
const radar=R.status();for(const k of ["preiszeiger","gkl","aggregatorAktionspreis","globus","hit","tegut","famila","combi","norma","dm","rossmann","mueller","alnatura","bioCompany","budni","denns","getraenkeHoffmann"])assert(radar.some(x=>x.key===k),k+" missing from source radar");
const row={merchant:"EDEKA",product:"Nutella",gtin:"3017620422003",storeId:"s1",price:3.99,observedAt:"2026-09-30",proof:"receipt:multi",priceType:"multi_buy",minQuantity:"3"};
const multi=C.ingest(R.contracts.receipt,[row]);assert.strictEqual(multi.accepted.length,1);assert.strictEqual(multi.accepted[0].minQuantity,3);
const observation=I.observation(multi.accepted[0],"batch",{source:"SPARKORB receipt"}),ctx={today:"2026-09-30",storeId:"s1"},query={name:"Nutella",gtin:row.gtin};
assert.strictEqual(observation.minQuantity,3);
assert.strictEqual(Resolver.resolveMerchant(query,"EDEKA",[observation],{...ctx,quantity:2}).state,"unknown");
assert.strictEqual(Resolver.resolveMerchant(query,"EDEKA",[observation],{...ctx,quantity:3}).price,3.99);
for(const minQuantity of [undefined,null,"",0,1,-2,2.5,Infinity,"NaN","three"]){const invalid=C.ingest(R.contracts.receipt,[{...row,minQuantity}]);assert.strictEqual(invalid.accepted.length,0,"invalid multi_buy quantity "+String(minQuantity));assert(invalid.rejected[0].reasons.includes("minQuantity"));}
const legacy=C.ingest(R.contracts.receipt,[{...row,minQuantity:undefined,quantityRequired:4}]);assert.strictEqual(legacy.accepted[0].minQuantity,4);
for(const priceType of ["unknown","club-price",""]){const invalid=C.ingest(R.contracts.receipt,[{...row,priceType}]);assert.strictEqual(invalid.accepted.length,0);assert(invalid.rejected[0].reasons.includes("priceType"));}
assert.strictEqual(C.ingest(R.contracts.receipt,[{...row,priceType:undefined,minQuantity:undefined}]).accepted[0].priceType,"regular");
console.log("current-price-connectors-benchmark: ok");
