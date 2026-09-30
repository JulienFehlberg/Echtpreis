const assert=require("assert");
const Matcher=require("../external-product-matcher"),Truth=require("../current-price-truth"),R=require("../current-price-resolver");
const vegan=Matcher.resolve({product:"Veganes Hack 500g"},[{id:"meat",name:"Rinder Hackfleisch 500g"},{id:"veg",name:"Veganes Hack 500g"}]);assert.notStrictEqual(vegan.productId,"meat");
const dup={price:2.49,sourceType:"retailer_feed",sourceId:"feed-a",storeId:"s",proof:"feed-row"};const fused=Truth.fuse([dup,{...dup},{...dup}]);assert.strictEqual(fused.independentEvidence,1);
assert.strictEqual(R.location({storeId:"other"},{storeId:"wanted"}).score,0);
const rows=[
 {merchant:"EDEKA",storeId:"s",productId:"p",product:"Butter 250g",price:2.49,priceType:"regular",observedAt:"2026-09-30",sourceType:"retailer_feed",sourceId:"a",proof:"a"},
 {merchant:"EDEKA",storeId:"s",productId:"p",product:"Butter 250g",price:1.99,priceType:"promotion",observedAt:"2026-09-30",sourceType:"official_retailer",sourceId:"b",proof:"b"}
];
const result=R.resolveMerchant({name:"Butter 250g"},"EDEKA",rows,{today:"2026-09-30",storeId:"s"});assert(result.price>0);assert.notStrictEqual(result.reason,"conflicting-current-evidence");
const leaders=R.leaders([{price:2,unitPrice:4,unit:"kg"},{price:1,unitPrice:1,unit:"piece"}]);assert.strictEqual(leaders.lowestUnitPrice,null);assert.strictEqual(leaders.unitComparisonAvailable,false);
console.log("current-price-regressions: ok");
assert.strictEqual(R.location({externalLocationId:"openprices:12",region:"Berlin"},{storeId:"canonical-store",region:"Berlin"}).level,"external-store-unmapped");assert.strictEqual(R.location({externalLocationId:"openprices:12",region:"Berlin"},{storeId:"canonical-store",region:"Berlin"}).score,0);

{const rows=[{merchant:"REWE",product:"Nutella 750 g",brand:"Ferrero",pack:"750 g",price:5.49,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"750"},{merchant:"REWE",product:"Nutella 450 g",brand:"Ferrero",pack:"450 g",price:3.99,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"450"}];const x=R.resolveMerchant({name:"Nutella",brand:"Ferrero",pack:"450 g"},"REWE",rows,{today:"2026-09-30",region:"Berlin"});assert.strictEqual(x.price,3.99,JSON.stringify(x));assert.strictEqual(x.product,"Nutella 450 g");}
{const rows=[{merchant:"REWE",product:"Nuss Nougat Creme 450 g",brand:"Eigenmarke",pack:"450 g",price:2.49,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"own"}];assert.strictEqual(R.resolveMerchant({name:"Nutella",brand:"Ferrero",pack:"450 g"},"REWE",rows,{today:"2026-09-30",region:"Berlin"}).state,"unknown");}

{const rows=[{merchant:"EDEKA",product:"Rinderhack 250 g",pack:"250 g",price:2.79,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"small"},{merchant:"EDEKA",product:"Rinderhack 500 g",pack:"500 g",price:3.99,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"large"}];const x=R.resolveMerchant({name:"Rinderhack"},"EDEKA",rows,{today:"2026-09-30",region:"Berlin"});assert.strictEqual(x.comparisonOnly,true);assert.strictEqual(x.product,"Rinderhack 500 g");assert.strictEqual(x.unit,"kg");}

{const rows=[{merchant:"EDEKA",product:"Rinderhack 500 g",pack:"500 g",price:3.99,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",sourceType:"receipt",proof:"same-id",proofActor:"u1"},{merchant:"EDEKA",product:"Rinderhack 500 g",pack:"500 g",price:5.49,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",sourceType:"receipt",proof:"same-id",proofActor:"u2"}];const x=R.resolveMerchant({name:"Rinderhack"},"EDEKA",rows,{today:"2026-09-30",region:"Berlin"});assert.strictEqual(x.state,"unknown");assert.strictEqual(x.reason,"conflicting-current-evidence");}

{const rows=[{merchant:"EDEKA",product:"Cola 1 L",productId:"cola-1l",pack:"1 L",price:1.19,observedAt:"2026-09-30",region:"Berlin",priceType:"app",proof:"app"},{merchant:"EDEKA",product:"Cola 1 L",productId:"cola-1l",pack:"1 L",price:1.49,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"public"},{merchant:"EDEKA",product:"Cola 2 L",productId:"cola-2l",pack:"2 L",price:.99,observedAt:"2026-09-30",region:"Berlin",priceType:"promotion",proof:"other-pack"}];const x=R.resolveMerchant({name:"Cola"},"EDEKA",rows,{today:"2026-09-30",region:"Berlin",eligibility:{app:true}});assert.strictEqual(x.price,1.19);assert.strictEqual(x.publicReferencePrice,1.49);}
