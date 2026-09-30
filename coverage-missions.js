"use strict";
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function ageDays(x,today=new Date().toISOString().slice(0,10)){if(!x)return 999;return Math.max(0,(new Date(today)-new Date(String(x).slice(0,10)))/864e5)}
function value(cell={},ctx={}){
 const age=ageDays(cell.observedAt||cell.date,ctx.today),missing=!(Number(cell.price)>0),demand=clamp(Number(cell.demandScore??.5),0,1),vol=clamp(Number(cell.volatility??.15),0,1),coverageGap=clamp(Number(cell.coverageGap??(missing?1:.3)),0,1),proofGap=cell.proof?0:.6,locationGap=cell.storeId?0:.5;
 let score=(missing?35:0)+Math.min(25,age*1.5)+demand*15+vol*10+coverageGap*10+proofGap*3+locationGap*2;
 return Math.round(clamp(score,0,100));
}
function missionType(cell={}){if(!(Number(cell.price)>0))return"PRICE_AND_AVAILABILITY";if(!cell.storeId)return"STORE_PRICE";if(!cell.proof)return"PRICE_PROOF";return"REFRESH_PRICE"}
function rewardBand(score){if(score>=85)return"very-high";if(score>=70)return"high";if(score>=50)return"medium";if(score>=30)return"low";return"none"}
function prioritize(cells=[],ctx={}){return cells.map(c=>({...c,missionValue:value(c,ctx),missionType:missionType(c)})).filter(x=>x.missionValue>=Number(ctx.minScore??30)).sort((a,b)=>b.missionValue-a.missionValue).map((x,i)=>({...x,priority:i+1,rewardBand:rewardBand(x.missionValue)}))}
function observation(status,meta={}){const allowed=new Set(["PRICE","IN_STOCK","OUT_OF_STOCK","NOT_FOUND"]);if(!allowed.has(status))throw new Error("invalid availability observation");return{status,storeId:meta.storeId||null,productId:meta.productId||null,product:meta.product||null,price:Number(meta.price)>0?Number(meta.price):null,proof:meta.proof||null,observedAt:meta.observedAt||new Date().toISOString(),confidence:Number(meta.confidence||0)}}
module.exports={ageDays,value,missionType,rewardBand,prioritize,observation};
