"use strict";
const assert=require("assert/strict"),Basket=require("../german-basket-priorities");
function gtin(number){const body=String(400000000000+number),sum=[...body].reduce((total,digit,index)=>total+Number(digit)*(index%2?3:1),0);return body+(10-sum%10)%10}
function product(number,name,category,scans=0){return{code:gtin(number),product_name_de:name,countries_tags:["en:germany"],categories_tags:category?["en:"+category]:[],unique_scans_n:scans,quantity:"500 g",brands:"Actual brand"}}
assert.equal(Basket.FAMILIES.length,38);assert.equal(new Set(Basket.FAMILIES.map(value=>value.id)).size,38);
for(const [category,expected]of[["fresh-milks","milk_fresh"],["uht-milks","milk_uht"],["milks","milk"],["butters","butter"],["eggs","eggs"],["bread-rolls","rolls"],["breads","bread"],["quarks","quark"],["yogurts","yogurt"],["cheeses","cheese"],["pastas","pasta"],["rices","rice"],["flours","flour"],["sugars","sugar"],["vegetable-oils","cooking_oil"],["rolled-oats","oats"],["mueslis","muesli"],["waters","water"],["coffees","coffee"],["teas","tea"],["fruit-juices","juice"],["potatoes","potatoes"],["onions","onions"],["tomatoes","tomatoes"],["cucumbers","cucumbers"],["apples","apples"],["bananas","bananas"],["meats","meat"],["plain-tofu","tofu"],["frozen-vegetables","frozen_vegetables"],["frozen-fishes","frozen_fish"],["frozen-ready-made-meals","frozen_meals"],["pulses","legumes"],["plant-based-milk-alternatives","plant_drinks"],["creams","cream"],["tomato-pastes","tomato_products"],["salts","salt"],["detergents","household"]]){const row=product(1,"Catalog product",category);if(["milk_fresh","milk_uht","milk","plant_drinks","water","juice"].includes(expected))row.quantity="1 l";assert.equal(Basket.family(row),expected,category)}
assert.equal(Basket.family({...product(1,"H-Milch 3,5 %",null),quantity:"1 l"}),"milk_uht");assert.equal(Basket.family({...product(1,"Bio Frische Vollmilch",null),quantity:"1 l"}),"milk_fresh");assert.equal(Basket.family(product(1,"Freiland Eier",null)),"eggs");assert.equal(Basket.family(product(1,"10 frische Eier",null)),"eggs");
assert.equal(Basket.family({...product(1,"Actual brand Haferflocken",null),brands:"Actual brand"}),"oats");assert.equal(Basket.family(product(1,"Spülmittel",null)),"household");
for(const [name,category]of[["Schokoriegel mit Milch","milk-chocolates"],["Milchschokolade","milks"],["Vollmilch Schokoladenriegel","milks"],["Butterkeks","butters"],["Buttertoast",null],["Haferflocken Riegel","rolled-oats"],["Kartoffelchips","potatoes"],["Apfelsaft","apples"],["Lachsfilet",null]])assert.notEqual(Basket.family(product(1,name,category)),{"Schokoriegel mit Milch":"milk","Milchschokolade":"milk","Vollmilch Schokoladenriegel":"milk","Butterkeks":"butter","Buttertoast":"butter","Haferflocken Riegel":"oats","Kartoffelchips":"potatoes","Apfelsaft":"apples","Lachsfilet":"frozen_fish"}[name],name);
assert.equal(Basket.family(product(1,"Schokoriegel mit Milch","milk-chocolates")),null);assert.equal(Basket.family(product(1,"Milch mit Kakao","milks")),null);
for(const [name,category]of[["Butter Powder","butters"],["Butterpulver","butters"],["Egg powder","eggs"],["Eipulver","eggs"]])assert.equal(Basket.family(product(1,name,category)),null,name+" is not an ordinary basket pack");
const popular=product(1,"Naturjoghurt","yogurts",200),less=product(2,"Naturjoghurt","yogurts",2);assert(Basket.score(popular)>Basket.score(less));assert.equal(Basket.score({...popular,price:999}),Basket.score({...popular,price:.01}),"Price is outside catalogue ranking");
for(const row of[{...popular,countries_tags:["en:france"],countryCode:"DE"},{...popular,code:"invalid"},{...popular,code:"4000000000010"},{...popular,product_name_de:"",product_name:""},null])assert.equal(Basket.score(row),0);
assert.equal(Basket.german({...popular,countries_tags:["en:france","en:germany"]}),true);assert.equal(Basket.german({...popular,countries_tags:[],countryCode:"DE"}),true);
const input=[];let counter=100;
for(let index=0;index<100;index++)input.push(product(counter++,"Milch-Schokoriegel","chocolate-bars",100000));
for(let index=0;index<80;index++)input.push(product(counter++,"Naturjoghurt","yogurts",index));
for(let index=0;index<6;index++)input.push({...product(counter++,"Frischmilch","fresh-milks",index),quantity:"1 l"});
for(let index=0;index<6;index++)input.push(product(counter++,"Eier","eggs",index));
const original=JSON.stringify(input),selected=Basket.select(input,{limit:18,minPerFamily:6}),coverage=Basket.coverage(selected);assert.equal(selected.length,18);assert.equal(coverage.counts.yogurt,6);assert.equal(coverage.counts.milk_fresh,6);assert.equal(coverage.counts.eggs,6);assert.equal(coverage.unclassified,0);assert.equal(coverage.representedFamilies,3);assert.equal(JSON.stringify(input),original);
assert(selected.every(value=>input.includes(value)&&!("price"in value)),"Return genuine unchanged metadata rows");
assert.equal(Basket.select([popular,{...popular,unique_scans_n:300},less],{limit:100}).length,2);assert.equal(Basket.select(input,{limit:0}).length,0);assert.equal(Basket.select(input,{limit:200}).length,92);assert.equal(Basket.select(input,{limit:200,includeOther:true}).length,192);
assert.deepEqual(Basket.select([...input].reverse(),{limit:18,minPerFamily:6}).map(value=>value.code),selected.map(value=>value.code));
const bulk=[];for(let index=0;index<6000;index++){bulk.push(product(10000+index,"Naturjoghurt","yogurts",index));bulk.push(product(20000+index,"Spaghetti","pastas",index))}for(let index=0;index<10;index++){bulk.push(product(30000+index,"Eier","eggs"));bulk.push({...product(40000+index,"Frische Vollmilch","fresh-milks"),quantity:"1 l"})}
const large=Basket.select(bulk,{limit:5000,minPerFamily:60}),largeCoverage=Basket.coverage(large);assert.equal(large.length,5000,"Sparse families must not prevent the 5,000 catalogue target");assert.equal(largeCoverage.counts.eggs,10);assert.equal(largeCoverage.counts.milk_fresh,10);assert.equal(largeCoverage.counts.pasta,2490);assert.equal(largeCoverage.counts.yogurt,2490);
// These exact metadata conflicts were found in the real OFF snapshot audit.
const real=(code,name,quantity,categories)=>({code,product_name:name,quantity,countries_tags:["en:germany"],categories_tags:categories});
const auditCases=[
 ["20633257","Crema da pistacchio","190 g",["en:vegetable-oils"],null],
 ["10086988","Schar Maestro Cereale","300 g",["en:breads","en:frozen-pizzas"],null],
 ["20036881","Latte Macchiato Zero","330 ml",["en:milks","en:coffee-drinks","en:latte-macchiato"],null],
 ["20168933","Unsmoked Back Bacon Rashers","1 l",["en:fresh-milks","en:milks"],null],
 ["10189054","Spargelstangen","1 l",["en:uht-milks","en:milks"],null],
 ["0041570056707","Almondmilk","1.89 l",["en:milks","en:plant-based-milk-alternatives"],"plant_drinks"],
 ["20850449","Milk & Honey Snack Bars by Lidl","168 g(6x28g)",["en:snacks"],null],
 ["11555797","Vegan Bloc Butter","250 g",["en:breads","en:toasts"],null],
 ["20115685","chapelure","500 g",["en:breads","en:bread-crumbs"],null],
 ["10576403","Volvic Touch Wasser","1.5 l",["en:waters","en:flavored-waters","en:bottled-water-flavoured-with-sugar"],null],
 ["20003432","Mandeln gerieben","200 g",["en:flours","en:nut-flours"],null],
 ["20012182","Feine Speisestärke (Mais)","250 g",["en:flours"],null],
 ["20004330","Pepinillos/ Pepinos agridulces grandes","360 g",["en:cucumbers","en:pickled-cucumbers","en:pickles"],null],
 ["20487942","Sun-Dried Tomatoes with sea salt","100 g",["en:tomatoes","en:dried-products","en:dried-tomatoes"],null],
 ["0613008730758","Pomegranate green tea","500 ml",["en:teas"],null],
 ["2200299010980","APFEL & WALDBEERE SCHORLE","500 ml",["de:fruchtsaftschorle"],null],
 ["22544292","Apfel Naturtrüb","1 l",["en:getranke"],null],
 ["22135650","Bananen-Nektar","1 l",["en:banana-nectars","en:fruit-nectars"],null],
 ["20090180","Banane marille Milchreis Erdbeer","200 g",["en:plant-based-foods"],null],
 ["19071121","kuchenrolle erdbeer","300 g",[],null],
 ["2000000045030","Test Roast – Yummy Flavour","500 g",["en:coffees"],null],
 ["20757625","Frische Vollmilch","1 l",["en:fresh-milks","en:milks"],"milk_fresh"],
 ["20757601","Haltbare Vollmilch 3,5 %","1 l",["en:uht-milks","en:milks"],"milk_uht"],
 ["20179496","Eier (Bodenhaltung)","10 pcs",["en:eggs"],"eggs"],
 ["20006105","Roggen Vollkornbrot","500 g",["en:breads"],"bread"],
 ["20003142","Mehl Type 405","1000 g",["en:flours"],"flour"],
 ["20171124","Saskia mineralwasser","1.5 l",["en:waters","en:mineral-waters"],"water"]
];
for(const [code,name,quantity,categories,expected]of auditCases)assert.equal(Basket.family(real(code,name,quantity,categories)),expected,code+" "+name);
// Original OFF export row: chocolate-cereals and breakfast-cereals must not reclassify the confectionery after the bread conflict.
const originalKnusperFlocken={code:"01236279",product_name:"Knusper Flocken",brands:"Zetti",quantity:"300 g",countries_tags:["en:germany"],categories_tags:["en:plant-based-foods-and-beverages","en:plant-based-foods","en:breakfasts","en:cereals-and-potatoes","en:cereals-and-their-products","en:breakfast-cereals","en:breads","en:chocolate-cereals","en:flakes","en:cereal-flakes","en:extruded-flakes","en:rolled-flakes","en:crispbreads","en:rye-flakes"],popularity_tags:[],unique_scans_n:0,last_modified_t:1573155935,sourceUrl:"https://world.openfoodfacts.org/product/01236279"};
assert.equal(Basket.family(originalKnusperFlocken),null,"01236279 original export is confectionery, not bread or muesli");
assert.equal(Basket.select([originalKnusperFlocken]).length,0);
assert.equal(Basket.family(product(1,"Pizza Margherita","frozen-pizzas")),"frozen_meals");
assert.equal(Basket.family({...product(1,"Pizza Margherita","frozen-pizzas"),categories_tags:["en:breads","en:frozen-pizzas"]}),"frozen_meals");
assert.equal(Basket.family({...product(1,"Pistazienöl","vegetable-oils"),quantity:"250 ml"}),"cooking_oil");
assert.equal(Basket.family(real("0103300220977","Küchenrolle","1 pcs",[])),"household");
assert.equal(Basket.family(real("20007379","Toilettenpapier","1 g",[])),null);
assert.equal(Basket.family(real("0444214111112","Wasser Naturell","6 pcs",["en:waters"])),null);
assert.equal(Basket.family(real("20757625","Frische Vollmilch","1 pcs",["en:fresh-milks"])),null);
assert.equal(Basket.family(real("20223045","Извара","1 pcs",["en:milks","en:cheeses","en:quarks"])),"quark");
assert.equal(Basket.eligible(real("2000000045030","Test Roast – Yummy Flavour","500 g",["en:coffees"])),false);
console.log("german-basket-priorities: 38 staple families, exact taxonomy, conservative fallback, real DE/GTIN identity, popularity, diversity and 5,000-item selection OK");
