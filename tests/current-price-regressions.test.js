const assert=require("assert");
const Matcher=require("../external-product-matcher"),Truth=require("../current-price-truth"),R=require("../current-price-resolver");
const mark=xs=>xs.map(x=>x.sourceType?x:{...x,sourceType:"open_data"});
const vegan=Matcher.resolve({product:"Veganes Hack 500g"},[{id:"meat",name:"Rinder Hackfleisch 500g"},{id:"veg",name:"Veganes Hack 500g"}]);assert.notStrictEqual(vegan.productId,"meat");
const dup={price:2.49,sourceType:"retailer_feed",sourceId:"feed-a",storeId:"s",proof:"feed-row"};const fused=Truth.fuse([dup,{...dup},{...dup}]);assert.strictEqual(fused.independentEvidence,1);
assert.strictEqual(R.location({storeId:"other"},{storeId:"wanted"}).score,0);
const rows=[
 {merchant:"EDEKA",storeId:"s",productId:"p",product:"Butter 250g",price:2.49,priceType:"regular",observedAt:"2026-09-30",sourceType:"retailer_feed",sourceId:"a",proof:"a"},
 {merchant:"EDEKA",storeId:"s",productId:"p",product:"Butter 250g",price:1.99,priceType:"promotion",observedAt:"2026-09-30",sourceType:"official_retailer",sourceId:"b",proof:"b"}
];
const result=R.resolveMerchant({name:"Butter 250g"},"EDEKA",mark(rows),{today:"2026-09-30",storeId:"s"});assert(result.price>0);assert.notStrictEqual(result.reason,"conflicting-current-evidence");
const leaders=R.leaders([{price:2,unitPrice:4,unit:"kg"},{price:1,unitPrice:1,unit:"piece"}]);assert.strictEqual(leaders.lowestUnitPrice,null);assert.strictEqual(leaders.unitComparisonAvailable,false);
console.log("current-price-regressions: ok");
assert.strictEqual(R.location({externalLocationId:"openprices:12",region:"Berlin"},{storeId:"canonical-store",region:"Berlin"}).level,"external-store-unmapped");assert.strictEqual(R.location({externalLocationId:"openprices:12",region:"Berlin"},{storeId:"canonical-store",region:"Berlin"}).score,0);

{const rows=[{merchant:"REWE",product:"Nutella 750 g",brand:"Ferrero",pack:"750 g",price:5.49,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"750"},{merchant:"REWE",product:"Nutella 450 g",brand:"Ferrero",pack:"450 g",price:3.99,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"450"}];const x=R.resolveMerchant({name:"Nutella",brand:"Ferrero",pack:"450 g"},"REWE",mark(rows),{today:"2026-09-30",region:"Berlin"});assert.strictEqual(x.price,3.99,JSON.stringify(x));assert.strictEqual(x.product,"Nutella 450 g");}
{const rows=[{merchant:"REWE",product:"Nuss Nougat Creme 450 g",brand:"Eigenmarke",pack:"450 g",price:2.49,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"own"}];assert.strictEqual(R.resolveMerchant({name:"Nutella",brand:"Ferrero",pack:"450 g"},"REWE",mark(rows),{today:"2026-09-30",region:"Berlin"}).state,"unknown");}

{const rows=[{merchant:"EDEKA",product:"Rinderhack 250 g",pack:"250 g",price:2.79,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"small"},{merchant:"EDEKA",product:"Rinderhack 500 g",pack:"500 g",price:3.99,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"large"}];const x=R.resolveMerchant({name:"Rinderhack"},"EDEKA",mark(rows),{today:"2026-09-30",region:"Berlin"});assert.strictEqual(x.comparisonOnly,true);assert.strictEqual(x.product,"Rinderhack 500 g");assert.strictEqual(x.unit,"kg");}

{const rows=[{merchant:"EDEKA",product:"Rinderhack 500 g",pack:"500 g",price:3.99,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",sourceType:"receipt",proof:"same-id",proofActor:"u1"},{merchant:"EDEKA",product:"Rinderhack 500 g",pack:"500 g",price:5.49,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",sourceType:"receipt",proof:"same-id",proofActor:"u2"}];const x=R.resolveMerchant({name:"Rinderhack"},"EDEKA",mark(rows),{today:"2026-09-30",region:"Berlin"});assert.strictEqual(x.state,"unknown");assert.strictEqual(x.reason,"conflicting-current-evidence");}

{const rows=[{merchant:"EDEKA",product:"Cola 1 L",productId:"cola-1l",pack:"1 L",price:1.19,observedAt:"2026-09-30",region:"Berlin",priceType:"app",proof:"app"},{merchant:"EDEKA",product:"Cola 1 L",productId:"cola-1l",pack:"1 L",price:1.49,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"public"},{merchant:"EDEKA",product:"Cola 2 L",productId:"cola-2l",pack:"2 L",price:.99,observedAt:"2026-09-30",region:"Berlin",priceType:"promotion",proof:"other-pack"}];const x=R.resolveMerchant({name:"Cola",brand:"Coca-Cola",pack:"1 L"},"EDEKA",mark(rows).map(r=>r.productId==="cola-1l"?{...r,brand:"Coca-Cola"}:r),{today:"2026-09-30",region:"Berlin",eligibility:{app:true}});assert.strictEqual(x.price,1.19);assert.strictEqual(x.publicReferencePrice,1.49);}

{assert.strictEqual(R.active({validFrom:"not-a-date"},"2026-09-30"),false);assert.strictEqual(R.active({validFrom:"2026-10-05",validTo:"2026-10-01"},"2026-09-30"),false);assert.strictEqual(R.freshnessDays({observedAt:"2026-10-01"},"2026-09-30"),Infinity);assert.strictEqual(R.freshnessDays({observedAt:"bad"},"2026-09-30"),Infinity);}

{const rows=[{merchant:"EDEKA",product:"Cola 1 L",productId:"cola-1l",pack:"1 L",price:1.79,observedAt:"2026-09-30",region:"Berlin",priceType:"app",proof:"app-high"},{merchant:"EDEKA",product:"Cola 1 L",productId:"cola-1l",pack:"1 L",price:1.49,observedAt:"2026-09-30",region:"Berlin",priceType:"regular",proof:"public-low"}];const x=R.resolveMerchant({name:"Cola"},"EDEKA",mark(rows),{today:"2026-09-30",region:"Berlin",eligibility:{app:true}});assert.strictEqual(x.price,1.49);assert.strictEqual(x.conditional,false);}

{const rows=[{merchant:"REWE",storeId:"s",product:"Milch 1 L",productId:"milk-1",pack:"1 L",price:1.19,observedAt:"2026-09-30",priceType:"regular",sourceType:"open_data",proof:"open"},{merchant:"REWE",storeId:"s",product:"Milch 1 L",productId:"milk-1",pack:"1 L",price:1.29,observedAt:"2026-09-30",priceType:"regular",sourceType:"official_retailer",proof:"web"},{merchant:"REWE",storeId:"s",product:"Milch 1 L",productId:"milk-1",pack:"1 L",price:1.39,observedAt:"2026-09-30",priceType:"regular",sourceType:"pos_feed",proof:"pos"}];const x=R.resolveMerchant({name:"Milch 1 L"},"REWE",mark(rows),{today:"2026-09-30",storeId:"s"});assert.strictEqual(x.price,1.39);assert.strictEqual(x.priceAuthority,"pos-live");assert.strictEqual(x.truthTier,1);}
{const rows=[{merchant:"REWE",storeId:"s",product:"Milch 1 L",productId:"milk-1",pack:"1 L",price:1.19,observedAt:"2026-09-30",priceType:"regular",sourceType:"open_data",proof:"open"},{merchant:"REWE",storeId:"s",product:"Milch 1 L",productId:"milk-1",pack:"1 L",price:1.29,observedAt:"2026-09-30",priceType:"regular",sourceType:"official_retailer",proof:"web"}];const x=R.resolveMerchant({name:"Milch 1 L"},"REWE",mark(rows),{today:"2026-09-30",storeId:"s"});assert.strictEqual(x.price,1.29);assert.strictEqual(x.priceAuthority,"official-published");assert.strictEqual(x.truthTier,2);}

{
 const row={merchant:"REWE",storeId:"s",product:"Butter 250 g",brand:"Marke",pack:"250 g",price:2.49,observedAt:"2026-09-30",sourceType:"official_retailer",proof:"barcode"},query={name:row.product,brand:row.brand,pack:row.pack,gtin:"4000000000013"},ctx={today:"2026-09-30",storeId:"s"};
 assert.strictEqual(R.resolveMerchant(query,"REWE",[{...row,gtin:"4000000000020"}],ctx).state,"unknown","a different valid barcode must never answer an exact query");
 assert.strictEqual(R.resolveMerchant(query,"REWE",[row],ctx).state,"unknown","attribute similarity cannot replace a missing barcode for an exact query");
 assert.strictEqual(R.resolveMerchant(query,"REWE",[{...row,gtin:query.gtin}],ctx).price,2.49);
}

{
 const row={merchant:"REWE",storeId:"s",productId:"butter",product:"Butter 250 g",brand:"Marke",pack:"250 g",price:2.49,priceType:"regular",observedAt:"2026-09-30",sourceType:"official_retailer",proof:"regular"},query={name:row.product,brand:row.brand,pack:row.pack},ctx={today:"2026-09-30",storeId:"s"};
 const promotion={...row,price:1.99,priceType:"promotion",observedAt:"2026-09-29",validFrom:"2026-09-28",validTo:"2026-10-03",proof:"promotion"};
 const x=R.resolveMerchant(query,"REWE",[row,promotion],ctx);
 assert.strictEqual(x.payablePrice,1.99,"a current public promotion from the same authority must count as payable");assert.strictEqual(x.priceType,"promotion");assert.strictEqual(x.publicReferencePrice,2.49);assert.strictEqual(x.unitPrice,7.96);
 const official=R.resolveMerchant(query,"REWE",[row,{...promotion,sourceType:"receipt"}],ctx);assert.strictEqual(official.payablePrice,2.49,"a weaker source cannot replace a current authoritative price");
 const promotionOnly=R.resolveMerchant(query,"REWE",[promotion],ctx);assert.strictEqual(promotionOnly.publicReferencePrice,null,"a promotion must not serve as its own regular reference");
}

{
 const row={merchant:"REWE",storeId:"s",productId:"butter",product:"Butter 250 g",brand:"Marke",pack:"250 g",price:2.49,priceType:"regular",observedAt:"2026-09-30T09:00:00Z",sourceType:"official_retailer",proof:"earlier"},query={name:row.product,brand:row.brand,pack:row.pack};
 const x=R.resolveMerchant(query,"REWE",[row,{...row,price:2.50,observedAt:"2026-09-30T12:00:00Z",proof:"later"}],{today:"2026-09-30",storeId:"s"});
 assert.strictEqual(x.payablePrice,2.50,"consensus must retain an actual quoted checkout price");assert.strictEqual(x.proof,"later");assert.strictEqual(x.unitPrice,x.payablePrice/.25,"unit price must use the selected payable price");
 const finite=R.resolveMerchant(query,"REWE",[{...row,price:Infinity},row],{today:"2026-09-30",storeId:"s"});assert.strictEqual(finite.payablePrice,2.49);
 assert.strictEqual(R.resolveMerchant(query,"REWE",[{...row,price:Infinity}],{today:"2026-09-30",storeId:"s"}).state,"unknown");
}

{
 const row={merchant:"REWE",storeId:"s",product:"Butter 250 g",brand:"Marke",pack:"250 g",price:1.99,priceType:"promotion",sourceType:"official_retailer",proof:"pg-date",observedAt:new Date("2026-09-30T12:00:00Z"),validFrom:new Date("2026-09-28T00:00:00Z"),validTo:new Date("2026-10-03T00:00:00Z")};
 const x=R.resolveMerchant({name:row.product,brand:row.brand,pack:row.pack},"REWE",[row],{today:"2026-09-30",storeId:"s"});assert.strictEqual(x.payablePrice,1.99,"native PostgreSQL Date values must remain current evidence");
 assert.strictEqual(R.day(new Date("invalid")),null);assert.strictEqual(R.day("2026-02-30"),null);assert.strictEqual(R.freshnessDays(row,"2026-09-30"),0);
}

{
 for(const min of [undefined,null,0,1,-2,2.5,Infinity,NaN,"invalid"]){assert.strictEqual(R.eligible({priceType:"multi_buy",minQuantity:min},{quantity:10}).ok,false,"invalid multi-buy minimum must not grant a price");}
 for(const quantity of [0,-1,Infinity,NaN,"invalid"]){assert.strictEqual(R.eligible({priceType:"multi_buy",minQuantity:2},{quantity}).ok,false,"invalid requested quantity must not grant a price");}
 assert.strictEqual(R.eligible({priceType:"multi_buy",minQuantity:2},{quantity:1}).ok,false);assert.strictEqual(R.eligible({priceType:"multi_buy",minQuantity:2},{quantity:2}).ok,true);
}

{
 const row={merchant:"REWE",product:"Milch 1 L",price:1.19,observedAt:"2026-09-30",sourceType:"official_retailer",proof:"eur",currency:"EUR"};
 assert.strictEqual(R.resolveMerchant({name:"Milch"},"REWE",[row,{...row,price:.99,currency:"GBP",proof:"gbp"}],{today:"2026-09-30"}).price,1.19,"different currencies cannot compete as euro prices");
}
