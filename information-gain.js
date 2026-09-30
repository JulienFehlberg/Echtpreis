"use strict";
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number(n)||0));
function ageScore(last,now=Date.now()){if(!last)return 1;const h=Math.max(0,(now-new Date(last).getTime())/36e5);return clamp(h/168)}
function score(x={},now=Date.now()){const demand=clamp(x.demandScore),age=ageScore(x.lastObservedAt,now),productGap=x.observationCount?clamp(1/Math.sqrt(Number(x.observationCount))):1,storeGap=clamp(x.storeGap??(x.priceCount!=null?1/(1+Number(x.priceCount)/10):.5)),sourceQuality=clamp((Number(x.sourceTrust??75))/100),success=clamp(x.sourceSuccessRate??.8),cost=Math.max(.1,Number(x.requestCost||1));const value=.27*demand+.24*age+.2*productGap+.16*storeGap+.08*sourceQuality+.05*success;return Math.round(1000*value/cost)/10}
function explain(x={},now=Date.now()){return{informationGain:score(x,now),demand:clamp(x.demandScore),age:ageScore(x.lastObservedAt,now),productGap:x.observationCount?clamp(1/Math.sqrt(Number(x.observationCount))):1,storeGap:clamp(x.storeGap??.5),sourceQuality:clamp((Number(x.sourceTrust??75))/100),success:clamp(x.sourceSuccessRate??.8),requestCost:Math.max(.1,Number(x.requestCost||1))}}
module.exports={clamp,ageScore,score,explain};
