const assert=require("assert"),C=require("../product-compatibility"),U=require("../unit-price"),R=require("../current-price-resolver");
assert.strictEqual(C.compatible("Rinderhack 500 g","Schweinehack 500 g").ok,false);
assert.strictEqual(C.compatible("Coca Cola Zero 1,5 L","Coca Cola Original 1,5 L").ok,true===false?true:false);
assert.strictEqual(C.compatible("Milch 1,5% 1L","Vollmilch 3,5% 1L").ok,false);
let p=U.parse("6 x 1,5 L");assert.strictEqual(p.amount,9000);assert.strictEqual(p.unit,"ml");
assert.strictEqual(U.unitPrice(3.99,"500 g").price,7.98);assert.strictEqual(U.unitPrice(6.99,"1 kg").price,6.99);
let leaders=R.leaders([{merchant:"A",price:3.99,unitPrice:7.98},{merchant:"B",price:6.99,unitPrice:6.99}]);assert.strictEqual(leaders.lowestCheckout.merchant,"A");assert.strictEqual(leaders.lowestUnitPrice.merchant,"B");
console.log("product compatibility/unit price: ok");