const assert=require("assert"),R=require("../current-price-resolver");
const today="2026-09-30",rows=[
{merchant:"EDEKA",product:"Rinderhack 500 g",brand:"Gut & Günstig",pack:"500 g",price:3.99,date:today,observedAt:today,priceType:"promotion",region:"Berlin",source:"edeka",proof:"a",sourceHealthScore:95},
{merchant:"ALDI",product:"Rinderhackfleisch 500 g",brand:"Meine Metzgerei",pack:"500 g",price:4.49,date:today,region:"Berlin",source:"aldi",proof:"b",sourceHealthScore:95},
{merchant:"LIDL",product:"Rinderhack 500 g",price:2.99,date:"2026-09-01",region:"Berlin",source:"lidl",proof:"old",sourceHealthScore:95},
{merchant:"REWE",product:"Veganes Hack 250 g",price:1.99,date:today,region:"Berlin",source:"rewe",proof:"v",sourceHealthScore:95}
];
let out=R.compare({name:"Rinderhack"},["EDEKA","ALDI","LIDL"],rows,{today,region:"Berlin",maxAgeDays:7});assert.strictEqual(out[0].price,3.99);assert.strictEqual(out[1].price,4.49);assert.strictEqual(out[2].state,"unknown");
assert.strictEqual(R.queryMode({name:"Hackfleisch"}),"category");assert.strictEqual(R.queryMode({name:"Nutella",brand:"Ferrero",pack:"450 g"}),"sku");
console.log("current-price-resolver: ok");