"use strict";
const T=require("./temporal-price-intelligence");
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function recencyWeight(date,target,halfLife=21){const d=Math.max(0,(new Date(target)-new Date(date))/864e5);return Math.pow(.5,d/halfLife)}
function weightedMean(rows,target,type="regular"){let n=0,d=0;for(const r of rows){if((r.priceType||"regular")!==type||!(Number(r.price)>0)||!r.date)continue;const w=recencyWeight(r.date,target);n+=Number(r.price)*w;d+=w}return d?n/d:null}
function trend(rows,target){
 const a=rows.filter(r=>(r.priceType||"regular")==="regular"&&Number(r.price)>0&&r.date).sort((x,y)=>String(x.date).localeCompare(String(y.date))).slice(-30);if(a.length<4)return{daily:0,samples:a.length};
 const t0=new Date(a[0].date),xs=a.map(r=>(new Date(r.date)-t0)/864e5),ys=a.map(r=>Number(r.price)),xm=xs.reduce((s,x)=>s+x,0)/xs.length,ym=ys.reduce((s,x)=>s+x,0)/ys.length;
 let num=0,den=0;for(let i=0;i<xs.length;i++){num+=(xs[i]-xm)*(ys[i]-ym);den+=(xs[i]-xm)**2}return{daily:den?num/den:0,samples:a.length};
}
function promotionPattern(rows,target){
 const promos=rows.filter(r=>r.priceType==="promotion"&&Number(r.price)>0&&r.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));if(promos.length<2)return{probability:0,samples:promos.length,medianPromo:null,cycleDays:null};
 const gaps=[];for(let i=1;i<promos.length;i++){const g=Math.abs((new Date(promos[i].date)-new Date(promos[i-1].date))/864e5);if(g>=5)gaps.push(g)}
 const cycle=T.median(gaps),last=promos.at(-1),since=Math.max(0,(new Date(target)-new Date(last.date))/864e5);let probability=0;if(cycle)probability=clamp(1-Math.abs(since-cycle)/Math.max(7,cycle),0,.85);
 return{probability,samples:promos.length,medianPromo:T.median(promos.map(x=>Number(x.price))),cycleDays:cycle};
}
function forecast(rows,ctx={}){
 const target=ctx.targetDate||ctx.today||new Date().toISOString().slice(0,10),hist=T.windowRows(rows,{...ctx,today:target},ctx.windowDays||180),base=T.baseline(hist,{...ctx,today:target,windowDays:ctx.baselineDays||90});
 if(base.samples<2)return{state:"unknown",price:null,min:null,max:null,confidence:0,reasons:["insufficient-history"]};
 const mean=weightedMean(hist,target),tr=trend(hist,target),daysAhead=Math.max(0,Number(ctx.daysAhead||0)),trendAdj=clamp(tr.daily*daysAhead,-base.median*.12,base.median*.12);
 const promo=promotionPattern(hist,target),regular=Math.max(.01,(mean||base.median)+trendAdj);let price=regular,reasons=["historical-baseline","recency-weighted"];
 if(Math.abs(trendAdj)>.005){reasons.push(trendAdj>0?"upward-trend":"downward-trend")}
 if(ctx.includePromotionProbability!==false&&promo.probability>=.55&&promo.medianPromo>0){price=regular*(1-promo.probability)+promo.medianPromo*promo.probability;reasons.push("promotion-cycle")}
 const vol=Number.isFinite(base.volatility)?base.volatility:.08,quality=clamp(base.samples/20,0,1),uncertainty=clamp(.025+vol*1.8+(1-quality)*.10+Math.min(daysAhead,30)*.003,.025,.30);
 let confidence=Math.round(clamp(94-uncertainty*120+(quality*8),25,97));if(promo.probability>.35&&promo.probability<.75)confidence-=6;
 price=Math.round(price*100)/100;return{state:"estimated",price,min:Math.round(price*(1-uncertainty)*100)/100,max:Math.round(price*(1+uncertainty)*100)/100,confidence:clamp(confidence,0,100),uncertainty,baseline:base.median,volatility:vol,trendPerDay:tr.daily,promotion:promo,reasons,samples:base.samples,targetDate:target};
}
module.exports={recencyWeight,weightedMean,trend,promotionPattern,forecast};
