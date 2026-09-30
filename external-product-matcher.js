"use strict";
const Identity=require("./product-identity"),Compatibility=require("./product-compatibility");
function resolve(external={},products=[]){
 const gtin=String(external.gtin||"").replace(/\D/g,"");
 if(gtin&&Identity.gtinValid(gtin)){
  const exact=products.find(p=>String(p.gtin||"").replace(/\D/g,"")===gtin);
  if(exact)return{state:"verified",productId:exact.id,confidence:1,reason:"gtin"};
 }
 const scored=[];
 for(const p of products){
  const externalName=external.product||external.name||"",candidateName=p.name||p.product||"";
  const compat=Compatibility.compatible(externalName,candidateName);
  if(!compat.ok)continue;
  const m=Identity.match({name:externalName,brand:external.brand,pack:external.pack,gtin:external.gtin},{name:candidateName,brand:p.brand,pack:p.pack,gtin:p.gtin});
  scored.push({product:p,match:m,compatibility:compat,score:Number(m.score||0)});
 }
 scored.sort((a,b)=>b.score-a.score);
 const best=scored[0],runner=scored[1];
 if(!best)return{state:"unresolved",productId:null,confidence:0,reason:"no-compatible-product-match"};
 if(best.score>=.92&&(!runner||best.score-runner.score>=.08))return{state:"verified",productId:best.product.id,confidence:best.score,reason:"strong-identity-match"};
 return{state:"review",productId:null,confidence:best.score,reason:runner&&best.score-runner.score<.08?"ambiguous-product-match":"weak-product-match",candidates:scored.slice(0,3).map(x=>({productId:x.product.id,score:x.score}))};
}
module.exports={resolve};
