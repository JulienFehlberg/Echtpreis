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

{const rows=[{merchant:"REWE",product:"Nutella 750 g",brand:"Ferrero",pack:"750 g",price:5.49,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"750"},{merchant:"REWE",product:"Nutella 450 g",brand:"Ferrero",pack:"450 g",price:3.99,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"450"}];const x=R.resolveMerchant({name:"Nutella",brand:"Ferrero",pack:"450 g"},"REWE",rows,{today:"2026-09-30",region:"Berlin"});assert.strictEqual(x.price,3.99);assert.strictEqual(x.product,"Nutella 450 g");}
{const rows=[{merchant:"REWE",product:"Nuss Nougat Creme 450 g",brand:"Eigenmarke",pack:"450 g",price:2.49,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"own"}];assert.strictEqual(R.resolveMerchant({name:"Nutella",brand:"Ferrero",pack:"450 g"},"REWE",rows,{today:"2026-09-30",region:"Berlin"}).state,"unknown");}
