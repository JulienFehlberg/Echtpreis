"use strict";
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function proofActor(r){return r.contributorId||r.deviceHash||r.receiptId||r.proof||null}
function independentGroups(rows=[]){const s=new Set();for(const r of rows){const actor=proofActor(r);if(!actor)continue;s.add([r.kind||"unknown",r.source||"unknown",actor].join("|"))}return s.size}
function median(xs){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function outliers(rows=[],opts={}){
 const xs=rows.filter(r=>Number(r.price)>0),center=median(xs.map(r=>Number(r.price)));if(!(center>0))return[];
 const deviations=xs.map(r=>Math.abs(Number(r.price)-center)),mad=median(deviations)||0,rel=opts.relativeThreshold||.25;
 return xs.filter(r=>{const d=Math.abs(Number(r.price)-center);return mad>0?d/(1.4826*mad)> (opts.robustZ||3.5):d/center>rel}).map(r=>({...r,outlierReason:"price-deviation",center}));
}
function health(stats={}){
 const received=Number(stats.received||0),accepted=Number(stats.accepted||0),rejected=Number(stats.rejected||0),proofRate=Number(stats.proofRate||0),gtinRate=Number(stats.gtinRate||0),freshHours=Number(stats.freshnessHours??9999),cal=stats.calibration||{};
 const acceptance=received?accepted/received:0;let score=100;
 score-=Math.min(35,(1-acceptance)*45);score-=Math.min(20,(1-proofRate)*25);score-=Math.min(10,(1-gtinRate)*10);
 if(freshHours>168)score-=25;else if(freshHours>72)score-=15;else if(freshHours>24)score-=5;
 if(cal.grade==="poor")score-=25;else if(cal.grade==="watch")score-=10;
 score=clamp(Math.round(score),0,100);return{score,state:score>=85?"healthy":score>=65?"watch":score>=40?"degraded":"quarantine",acceptance};
}
function refreshHealth(lastSuccessAt,expectedMs,now=Date.now()){if(!lastSuccessAt)return{state:"never",ageMs:null,penalty:-35};const ageMs=Math.max(0,now-new Date(lastSuccessAt).getTime()),ratio=ageMs/Math.max(60000,Number(expectedMs)||3600000);return ratio<=1.5?{state:"fresh",ageMs,penalty:0}:ratio<=3?{state:"late",ageMs,penalty:-10}:{state:"stale",ageMs,penalty:-30}}
function trustAdjustment(h){if(!h)return 0;if(h.state==="healthy")return Math.min(3,Math.round((h.score-85)/5));if(h.state==="watch")return-5;if(h.state==="degraded")return-15;return-35}
module.exports={proofActor,independentGroups,median,outliers,health,refreshHealth,trustAdjustment};
