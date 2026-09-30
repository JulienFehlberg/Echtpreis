const assert=require("assert"),G=require("../prediction-ground-truth");
const receipt={merchant:"REWE",storeId:"s1",purchasedAt:"2026-09-30T10:00:00Z",region:"Berlin"};
let p={gtin:"4008400401627",merchant:"REWE",storeId:"s1",targetDate:"2026-09-30",productName:"Nutella 450g",packAmount:450,packUnit:"g"};
let item={gtin:"4008400401627",rawName:"NUTELLA 450G",price:2.99,packAmount:450,packUnit:"g"};
assert.strictEqual(G.match(p,item,receipt).level,"ground-truth");
assert.strictEqual(G.productScore(p,item).reason,"gtin");
let wrong={...receipt,storeId:"other"};assert.strictEqual(G.match(p,item,wrong).level,"reject");
let fuzzy=G.match({...p,gtin:null,storeId:null},{...item,gtin:null},receipt);assert(fuzzy.score<1);
console.log("prediction-ground-truth: ok");