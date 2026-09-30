const assert=require("assert"),S=require("../store-resolver");
const stores=[{id:"a",merchant:"EDEKA",externalId:"4711",address:"Seegefelder Str. 10",postalCode:"13583",city:"Berlin"},{id:"b",merchant:"EDEKA",externalId:"4712",address:"Klosterstr. 3",postalCode:"13581",city:"Berlin"},{id:"c",merchant:"REWE",address:"Seegefelder Str. 10",postalCode:"13583",city:"Berlin"}];
let x=S.resolve({merchant:"EDEKA",externalId:"4711"},stores);assert.strictEqual(x.storeId,"a");assert.strictEqual(x.state,"verified");
x=S.resolve({merchant:"EDEKA",address:"Seegefelder Str. 10",postalCode:"13583",city:"Berlin"},stores);assert.strictEqual(x.storeId,"a");assert(x.confidence>=.9);
x=S.resolve({merchant:"EDEKA"},stores);assert.strictEqual(x.storeId,null);assert(["review","unresolved"].includes(x.state));
x=S.resolve({merchant:"REWE",address:"Seegefelder Str. 10",postalCode:"13583",city:"Berlin"},stores);assert.strictEqual(x.storeId,"c");
console.log("store-resolver: ok");