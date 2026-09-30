"use strict";
const Identity=require("./product-identity"),Compatibility=require("./product-compatibility");
function resolve(external={},products=[]){
 if(external.gtin&&Identity.gtinValid(external.gtin)){const exact=products.find(p=>String(p.gtin||"")===String(external.gtin));if(exact)return{state:"verified",productId:exact.id,confidence:1,reason:"gtin"}}
 const scored=[];for(const p of products){const m=Identity.match({rawName:external.product,brand:external.brand,pack:external.pack,gtin:external.gtin},{rawName:p.name,brand:p.brand,pack:p.pack,gtin:p.gtin});if(!Compatibility.compatible(external.product,p.name))continue;scored.push({product:p,match:m,score:Number(m.score||0)})}scored.sort((a,b)=>b.score-a.score);const best=scored[0],runner=scored[1];if(!best)return{state:"unresolved",productId:null,confidence:0,reason:"no-product-match"};if(best.score>=.92&&(!runner||best.score-runner.score>=.08))return{state:"verified",productId:best.product.id,confidence:best.score,reason:"strong-identity-match"};return{state:"review",productId:null,confidence:best.score,reason:runner&&best.score-runner.score<.08?"ambiguous-product-match":"weak-product-match",candidates:scored.slice(0,3).map(x=>({productId:x.product.id,score:x.score}))};
}
module.exports={resolve};
