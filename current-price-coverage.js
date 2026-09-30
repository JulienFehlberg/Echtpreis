"use strict";
function summarize(results=[],opts={}){
 const total=results.length,known=results.filter(x=>x&&x.price>0),verified=known.filter(x=>x.state==="verified"),unknown=results.filter(x=>!x||x.state==="unknown");
 const asOf=new Date(String(opts.today||new Date().toISOString().slice(0,10)).slice(0,10)+"T23:59:59Z");
 const fresh=known.filter(x=>{if(!x.observedAt)return false;const d=new Date(x.observedAt);return Number.isFinite(d.getTime())&&(asOf-d)/864e5<=1&&(asOf-d)>=0});
 const bySource={};for(const x of known){const k=x.sourceType||x.source||"unknown";bySource[k]=(bySource[k]||0)+1}
 const byMerchant={};for(const x of results){if(!x?.merchant)continue;const m=x.merchant;byMerchant[m]??={total:0,known:0,verified:0};byMerchant[m].total++;if(x.price>0)byMerchant[m].known++;if(x.state==="verified")byMerchant[m].verified++}
 return{total,known:known.length,unknown:unknown.length,verified:verified.length,currentCoverage:total?known.length/total:0,verifiedCoverage:total?verified.length/total:0,fresh24hCoverage:total?fresh.length/total:0,missingMerchants:unknown.map(x=>x?.merchant).filter(Boolean),bySource,byMerchant}
}
function ready(s,gate={}){const min=gate.minCurrentCoverage??.8,minVerified=gate.minVerifiedCoverage??.4;const reasons=[];if(s.currentCoverage<min)reasons.push("current-coverage");if(s.verifiedCoverage<minVerified)reasons.push("verified-coverage");return{ready:!reasons.length,reasons}}
module.exports={summarize,ready};
