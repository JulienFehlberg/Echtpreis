"use strict";
function median(xs){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function quantile(xs,q){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const i=(a.length-1)*q,l=Math.floor(i),h=Math.ceil(i);return l===h?a[l]:a[l]+(a[h]-a[l])*(i-l)}
function days(a,b){return Math.abs(new Date(a)-new Date(b))/864e5}
function windowRows(rows,ctx={},n=90){const end=ctx.today||new Date().toISOString().slice(0,10);return(rows||[]).filter(r=>Number(r.price)>0&&r.date&&days(r.date,end)<=n&&(!ctx.storeId||!r.storeId||String(r.storeId)===String(ctx.storeId))&&(!ctx.region||!r.region||String(r.region).toLowerCase()===String(ctx.region).toLowerCase()))}
function baseline(rows,ctx={}){
 const xs=windowRows(rows,ctx,ctx.windowDays||90).filter(r=>(r.priceType||"regular")==="regular"),prices=xs.map(r=>Number(r.price));
 if(!prices.length)return{samples:0,median:null,low:null,high:null,q25:null,q75:null,volatility:null};
 const med=median(prices),q25=quantile(prices,.25),q75=quantile(prices,.75),low=Math.min(...prices),high=Math.max(...prices),mad=median(prices.map(x=>Math.abs(x-med)));
 return{samples:prices.length,median:med,low,high,q25,q75,volatility:med?mad/med:null};
}
function dealStrength(price,base){
 if(!(price>0)||!base||!(base.median>0)||base.samples<3)return{grade:"unknown",discountPct:null,score:null};
 const discount=(base.median-price)/base.median*100;let score=50+discount*4;
 if(base.q25!=null&&price<=base.q25)score+=8;if(base.low!=null&&price<=base.low*1.01)score+=12;if(discount<=0)score=Math.min(score,35);
 score=Math.max(0,Math.min(100,Math.round(score)));
 return{grade:score>=90?"exceptional":score>=75?"strong":score>=55?"fair":score>=35?"weak":"not-a-deal",discountPct:Math.round(discount*10)/10,score};
}
function pricePosition(price,base){if(!base||!(base.median>0))return"unknown";if(price<=base.low*1.01)return"historical-low";if(price<=base.q25)return"low";if(price<base.median)return"below-normal";if(price===base.median)return"normal";if(price<=base.q75)return"above-normal";return"high"}
function changes(rows=[]){const a=rows.filter(r=>Number(r.price)>0&&r.date).sort((x,y)=>String(x.date).localeCompare(String(y.date))),out=[];for(let i=1;i<a.length;i++){const prev=Number(a[i-1].price),next=Number(a[i].price);if(prev===next)continue;out.push({from:prev,to:next,date:a[i].date,delta:next-prev,deltaPct:(next-prev)/prev*100,priceType:a[i].priceType||"regular"})}return out}
function analyze(current,history,ctx={}){const base=baseline(history,ctx),deal=dealStrength(Number(current?.price),base);return{baseline:base,deal,position:pricePosition(Number(current?.price),base),changes:changes(windowRows(history,ctx,ctx.windowDays||90)),current:Number(current?.price)||null}}
module.exports={median,quantile,windowRows,baseline,dealStrength,pricePosition,changes,analyze};
