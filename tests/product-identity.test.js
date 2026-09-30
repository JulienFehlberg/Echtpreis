const assert=require("assert"),P=require("../product-identity");
assert(P.gtinValid("4008400401627"));
assert(!P.gtinValid("4008400401628"));
let p=P.parsePack("Nutella 2 x 450 g");assert.strictEqual(p.total.amount,900);assert.strictEqual(p.total.unit,"g");
assert.strictEqual(P.parsePack("Milch 1 L").total.amount,1000);assert.strictEqual(P.parsePack("Cola 1,5 L").total.amount,1500);assert.strictEqual(P.parsePack("Joghurt 0,5 kg").total.amount,500);
let exact=P.match({gtin:"4008400401627",name:"Nutella 450 g"},{gtin:"4008400401627",name:"Ferrero Nutella 450 g"});assert.strictEqual(P.identityClass(exact),"ground-truth");
let different=P.match({name:"Nutella 450 g",brand:"Ferrero"},{name:"Nuss Nougat Creme 400 g",brand:"Eigenmarke"});assert.notStrictEqual(P.identityClass(different),"ground-truth");
assert(P.canonicalId({gtin:"4008400401627",name:"Nutella"}).startsWith("gtin:"));
console.log("product-identity: ok");