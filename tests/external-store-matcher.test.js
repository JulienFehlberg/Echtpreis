const assert=require("assert"),M=require("../external-store-matcher");
const stores=[{id:"s1",merchant:"EDEKA",address:"Seegefelder Str. 10",postalCode:"13583",city:"Berlin"},{id:"s2",merchant:"EDEKA",address:"Klosterstr. 3",postalCode:"13581",city:"Berlin"}];
let x=M.resolve({merchant:"EDEKA",address:"Seegefelder Str. 10",postalCode:"13583",city:"Berlin"},stores);assert.strictEqual(x.state,"verified");assert.strictEqual(x.storeId,"s1");
x=M.resolve({merchant:"EDEKA",postalCode:"13583",city:"Berlin"},stores);assert.notStrictEqual(x.state,"verified");assert.strictEqual(x.storeId,null);
let row=M.apply({price:3.99,externalLocationId:"openprices:12"},x);assert.strictEqual(row.storeId,null);
row=M.apply({price:3.99},{state:"verified",storeId:"s1",confidence:.98});assert.strictEqual(row.storeId,"s1");
console.log("external-store-matcher: ok");