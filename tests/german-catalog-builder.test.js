"use strict";
const assert=require("node:assert/strict"),Builder=require("../scripts/build-german-catalog");
const row={code:"4002971253504",product_name:"Grand Dessert Vanille",brands:"Ehrmann",quantity:"190 g",countries_tags:["en:germany"],categories_tags:["en:dairy-desserts"]};
assert.equal(Builder.usable(row),true);
assert.equal(Builder.obviousPlaceholder({...row,code:"2000000045030",product_name:"Test Roast – Yummy Flavour"}),true);
assert.equal(Builder.usable({...row,code:"2000000045030",product_name:"Test Roast – Yummy Flavour"}),false);
for(const name of ["TEST Roast","Fake Milk","Example flour","Dummy Eier","Milch (Test)","Testprodukt Wasser","Platzhalter","Unknown","Unbekannt","Produkt","N/A"]){
 assert.equal(Builder.obviousPlaceholder({...row,product_name:name}),true,name);
}
for(const code of ["0000000000000","1111111111116","0111111111117","12345670","1234567890128","0123456789012"]){
 assert.equal(Builder.obviousPlaceholder({...row,code}),true,code);
}
for(const name of ["Testa Olive Oil","Frische Vollmilch","Taste of Asia Rice","Feta in Salzlake"]){
 assert.equal(Builder.obviousPlaceholder({...row,product_name:name}),false,name);
}
assert.equal(Builder.obviousPlaceholder({...row,code:"20757625",product_name:"Frische Vollmilch"}),false);
assert.equal(Builder.usable({...row,countries_tags:["en:france"]}),false);
assert.equal(Builder.usable({...row,quantity:"unknown"}),false);
console.log("German catalog builder tests passed");
