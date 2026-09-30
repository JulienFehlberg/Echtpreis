"use strict";
const Identity=require("./product-identity");
const REL={EXACT:"exact",VARIANT:"variant",EQUIVALENT:"equivalent",SUBSTITUTE:"substitute",CATEGORY:"category"};
function normalizePolicy(p={}){return{allowPrivateLabel:!!p.allowPrivateLabel,allowBrandSwap:!!p.allowBrandSwap,maxPackDelta:Number.isFinite(+p.maxPackDelta)?+p.maxPackDelta:.15,requireSameUnit:p.requireSameUnit!==false,allowedRoles:p.allowedRoles||[REL.EXACT,REL.EQUIVALENT]}}
function edgeScore(a,b,role,policy={}){
 const p=normalizePolicy(policy),ia=Identity.parsePack(a.pack||a.name),ib=Identity.parsePack(b.pack||b.name);
 let score=role===REL.EXACT?1:role===REL.VARIANT?.88:role===REL.EQUIVALENT?.80:role===REL.SUBSTITUTE?.68:.5;
 if(a.brand&&b.brand&&Identity.norm(a.brand)!==Identity.norm(b.brand)){if(!p.allowBrandSwap)return{score:0,allowed:false,reason:"brand-swap-blocked"};score-=.08}
 if(ia&&ib){if(p.requireSameUnit&&ia.total.unit!==ib.total.unit)return{score:0,allowed:false,reason:"unit-mismatch"};if(ia.total.unit===ib.total.unit){const d=Math.abs(ia.total.amount-ib.total.amount)/Math.max(ia.total.amount,ib.total.amount);if(d>p.maxPackDelta)return{score:0,allowed:false,reason:"pack-delta"};score-=d*.25}}
 const allowed=p.allowedRoles.includes(role);return{score:Math.max(0,Math.round(score*1000)/1000),allowed,reason:allowed?"policy-ok":"role-blocked"};
}
function comparisonPrice(obs,product){
 const price=Number(obs.price);if(!(price>0))return null;const pack=Identity.parsePack(product.pack||product.name);if(!pack||!pack.total||!(pack.total.amount>0))return{price,per:"piece",basis:1};
 if(pack.total.unit==="g")return{price:price/(pack.total.amount/1000),per:"kg",basis:pack.total.amount};
 if(pack.total.unit==="ml")return{price:price/(pack.total.amount/1000),per:"l",basis:pack.total.amount};
 if(pack.total.unit==="piece")return{price:price/pack.total.amount,per:"piece",basis:pack.total.amount};return{price,per:"piece",basis:1};
}
function candidate(queryProduct,candidateProduct,observation,role,policy){
 const edge=edgeScore(queryProduct,candidateProduct,role,policy);if(!edge.allowed)return{eligible:false,...edge};
 const unit=comparisonPrice(observation,candidateProduct);if(!unit)return{eligible:false,score:0,reason:"no-price"};
 return{eligible:true,relationship:role,relationshipScore:edge.score,comparisonPrice:unit.price,comparisonUnit:unit.per,observedPrice:Number(observation.price),productId:candidateProduct.id||null,observationId:observation.id||null};
}
module.exports={REL,normalizePolicy,edgeScore,comparisonPrice,candidate};
