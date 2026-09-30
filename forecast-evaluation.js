"use strict";
const C=require("./price-calibration");
function metrics(rows=[]){const s=C.summarize(rows);return{samples:s.sampleCount,mae:s.mae,medianApe:s.medianApe,within2pct:s.within2pct,within5pct:s.within5pct,rangeHitRate:s.rangeHitRate,bias:s.bias}}
function eligible(m,g={}){const min=g.minSamples||50;if(!m||m.samples<min)return{ok:false,reasons:["insufficient-samples"]};const r=[];if(m.medianApe==null||m.medianApe>(g.maxMedianApe??8))r.push("median-error");if(m.within5pct!=null&&m.within5pct<(g.minWithin5??.75))r.push("within5");if(m.rangeHitRate!=null&&m.rangeHitRate<(g.minRangeHit??.75))r.push("range-hit");if(m.bias!=null&&Math.abs(m.bias)>(g.maxAbsBias??5))r.push("bias");return{ok:!r.length,reasons:r}}
function compare(championRows,challengerRows,g={}){
 const a=metrics(championRows),b=metrics(challengerRows),gate=eligible(b,g);if(!gate.ok)return{promote:false,champion:a,challenger:b,reasons:gate.reasons};
 const minGain=g.minMedianApeGain??.05,maxRegression=g.maxWithin5Regression??.02;
 const apeGain=a.medianApe>0?(a.medianApe-b.medianApe)/a.medianApe:0,withinRegression=(a.within5pct??0)-(b.within5pct??0),rangeRegression=(a.rangeHitRate??0)-(b.rangeHitRate??0);
 const reasons=[];if(apeGain<minGain)reasons.push("insufficient-error-improvement");if(withinRegression>maxRegression)reasons.push("within5-regression");if(rangeRegression>(g.maxRangeRegression??.03))reasons.push("range-regression");if(Math.abs(b.bias??0)>Math.abs(a.bias??0)+(g.maxBiasRegression??1))reasons.push("bias-regression");
 return{promote:!reasons.length,champion:a,challenger:b,apeGain,withinRegression,rangeRegression,reasons};
}
function scope({merchant,storeId,category,productId,horizonDays}={}){return{merchant:merchant||"*",storeId:storeId||"*",category:category||"*",productId:productId||"*",horizonBucket:horizonDays==null?"*":horizonDays<=1?"0-1":horizonDays<=7?"2-7":horizonDays<=30?"8-30":"31+"}}
function scopeKey(x){const s=scope(x);return[s.merchant,s.storeId,s.category,s.productId,s.horizonBucket].join("|")}
module.exports={metrics,eligible,compare,scope,scopeKey};
