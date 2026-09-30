"use strict";
function norm(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim()}
function tokens(s){return new Set(norm(s).split(/\s+/).filter(x=>x.length>1))}
function jaccard(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/(A.size+B.size-hit)}
function productScore(pred,item){
 if(pred.gtin&&item.gtin&&String(pred.gtin)===String(item.gtin))return{score:1,reason:"gtin"};
 if(pred.productKey&&item.productKey&&pred.productKey===item.productKey)return{score:.98,reason:"canonical-key"};
 let s=jaccard(pred.productName||pred.productKey,item.productName||item.rawName);
 if(pred.packAmount&&item.packAmount){const d=Math.abs(Number(pred.packAmount)-Number(item.packAmount))/Math.max(Number(pred.packAmount),Number(item.packAmount));if(d<=.02)s+=.08;else if(d>.15)s-=.18}
 if(pred.packUnit&&item.packUnit&&norm(pred.packUnit)!==norm(item.packUnit))s-=.15;
 return{score:Math.max(0,Math.min(.94,s)),reason:"name-pack"};
}
function contextScore(pred,receipt){
 let score=0,reasons=[];
 if(pred.storeId&&receipt.storeId){if(pred.storeId===receipt.storeId){score+=.45;reasons.push("same-store")}else return{score:0,reasons:["different-store"]}}
 else if(norm(pred.merchant)===norm(receipt.merchant)){score+=.30;reasons.push("same-merchant")}
 if(pred.targetDate&&receipt.purchasedAt){const d=Math.abs(new Date(pred.targetDate+"T12:00:00Z")-new Date(receipt.purchasedAt))/864e5;if(d<=1){score+=.35;reasons.push("date<=1d")}else if(d<=3){score+=.20;reasons.push("date<=3d")}else if(d>7)return{score:0,reasons:["date>7d"]}}
 if(pred.region&&receipt.region&&norm(pred.region)===norm(receipt.region)){score+=.10;reasons.push("same-region")}
 return{score:Math.min(1,score),reasons};
}
function match(pred,item,receipt){
 const p=productScore(pred,item),c=contextScore(pred,receipt);let score=p.score*.72+c.score*.28;
 if(pred.priceType&&item.priceType&&pred.priceType!==item.priceType)score-=.12;
 const level=score>=.90?"ground-truth":score>=.80?"reviewable":"reject";
 return{score:Math.round(Math.max(0,score)*100)/100,level,productReason:p.reason,contextReasons:c.reasons};
}
function bestMatch(pred,items,receipt){return(items||[]).map(item=>({item,...match(pred,item,receipt)})).sort((a,b)=>b.score-a.score)[0]||null}
module.exports={norm,jaccard,productScore,contextScore,match,bestMatch};
