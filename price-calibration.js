"use strict";
function pctError(predicted,actual){if(!(actual>0))return null;return Math.abs(predicted-actual)/actual*100}
function signedBias(predicted,actual){if(!(actual>0))return null;return (predicted-actual)/actual*100}
function median(xs){const a=xs.filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function summarize(rows=[]){
 const valid=rows.filter(x=>Number(x.predicted)>0&&Number(x.actual)>0);
 if(!valid.length)return{sampleCount:0,mae:null,medianApe:null,bias:null,within2pct:null,within5pct:null,rangeHitRate:null};
 const abs=valid.map(x=>Math.abs(Number(x.predicted)-Number(x.actual))),apes=valid.map(x=>pctError(Number(x.predicted),Number(x.actual))),biases=valid.map(x=>signedBias(Number(x.predicted),Number(x.actual)));
 const ranged=valid.filter(x=>Number.isFinite(Number(x.rangeMin))&&Number.isFinite(Number(x.rangeMax)));
 return{sampleCount:valid.length,mae:abs.reduce((a,b)=>a+b,0)/valid.length,medianApe:median(apes),bias:biases.reduce((a,b)=>a+b,0)/valid.length,within2pct:apes.filter(x=>x<=2).length/valid.length,within5pct:apes.filter(x=>x<=5).length/valid.length,rangeHitRate:ranged.length?ranged.filter(x=>Number(x.actual)>=Number(x.rangeMin)&&Number(x.actual)<=Number(x.rangeMax)).length/ranged.length:null};
}
function reliability(s){
 if(!s||s.sampleCount<10)return{grade:"insufficient-data",adjustment:0};
 let a=0;if(s.medianApe<=2)a+=4;else if(s.medianApe>=8)a-=8;if(s.within5pct>=.9)a+=3;else if(s.within5pct<.65)a-=5;if(Math.abs(s.bias)>5)a-=5;if(s.rangeHitRate!=null&&s.rangeHitRate<.75)a-=4;
 return{grade:a>=5?"excellent":a>=1?"good":a>=-3?"watch":"poor",adjustment:Math.max(-15,Math.min(5,a))};
}

function drift(current,baseline){
 if(!current||!baseline||current.sampleCount<10||baseline.sampleCount<20)return{detected:false,severity:"unknown",reasons:[]};
 const reasons=[];if(current.medianApe>baseline.medianApe*1.5&&current.medianApe-baseline.medianApe>=2)reasons.push("median_error_up");
 if(current.within5pct<baseline.within5pct-.15)reasons.push("within_5pct_down");
 if(Math.abs(current.bias)>Math.max(5,Math.abs(baseline.bias)+3))reasons.push("bias_shift");
 return{detected:reasons.length>0,severity:reasons.length>=2?"high":"medium",reasons};
}
function learningActions(s,baseline){
 const rel=reliability(s),d=drift(s,baseline),actions=[];
 if(s.sampleCount<10)actions.push("collect_more_evidence");
 if(rel.grade==="poor")actions.push("reduce_confidence");
 if(Math.abs(s.bias||0)>5)actions.push("inspect_systematic_bias");
 if(s.rangeHitRate!=null&&s.rangeHitRate<.75)actions.push("widen_or_recalibrate_range");
 if(d.detected)actions.push("source_drift_review");
 return{reliability:rel,drift:d,actions};
}
module.exports={pctError,signedBias,median,summarize,reliability,drift,learningActions};
