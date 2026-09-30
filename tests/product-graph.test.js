const assert=require("assert"),G=require("../product-graph");
const nutella={id:"n",name:"Nutella 450 g",brand:"Ferrero",pack:"450 g"},own={id:"o",name:"Nuss Nougat Creme 400 g",brand:"Eigenmarke",pack:"400 g"};
let x=G.edgeScore(nutella,own,G.REL.SUBSTITUTE,{});assert.strictEqual(x.allowed,false);
x=G.edgeScore(nutella,own,G.REL.SUBSTITUTE,{allowBrandSwap:true,allowedRoles:["substitute"],maxPackDelta:.2});assert(x.allowed);
let u=G.comparisonPrice({price:3.6},nutella);assert.strictEqual(u.per,"kg");assert(Math.abs(u.price-8)<.001);
let c=G.candidate(nutella,own,{id:"obs",price:2.4},G.REL.SUBSTITUTE,{allowBrandSwap:true,allowedRoles:["substitute"],maxPackDelta:.2});assert(c.eligible);assert.strictEqual(c.comparisonUnit,"kg");
console.log("product-graph: ok");