"use strict";
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ß/g,"ss");
const RULES={
 meat:{beef:["rind","rinder","beef"],pork:["schwein","schweine","pork"],mixed:["gemischt","halb halb","halb/halb"],poultry:["hahnchen","haehnchen","huhn","pute","geflugel"]},
 production:{organic:["bio","bioland","demeter","naturland"],conventional:[]},
 state:{frozen:["tiefkuhl","tiefgek","tk ","gefroren"],fresh:["frisch"]},
 sugar:{zero:["zero","zuckerfrei","ohne zucker"],regular:["original","classic","klassik"]},
 fat:{lowfat:["fettarm","light","1,5%","1.5%"],fullfat:["3,5%","3.5%","vollmilch"]}
};
function hasAny(s,words){const n=norm(s);return words.some(w=>n.includes(norm(w)))}
function feature(text,group){for(const[k,words]of Object.entries(RULES[group]||{}))if(words.length&&hasAny(text,words))return k;return null}
function extract(text){return Object.fromEntries(Object.keys(RULES).map(k=>[k,feature(text,k)]))}
function conflicts(query,candidate){
 const q=extract(query),c=extract(candidate),out=[];for(const k of Object.keys(RULES)){if(q[k]&&c[k]&&q[k]!==c[k])out.push({feature:k,query:q[k],candidate:c[k]})}
 return out;
}
function compatible(query,candidate,opts={}){
 const hard=conflicts(query,candidate);if(hard.length)return{ok:false,score:0,conflicts:hard,reasons:["hard-feature-conflict"]};
 const q=extract(query),c=extract(candidate);let score=1,reasons=[];for(const k of Object.keys(RULES)){if(q[k]&&!c[k]){score-=opts.missingFeaturePenalty??.08;reasons.push("candidate-"+k+"-unknown")}}
 return{ok:score>=(opts.minScore??.75),score:Math.max(0,score),conflicts:[],reasons,queryFeatures:q,candidateFeatures:c};
}
module.exports={RULES,norm,feature,extract,conflicts,compatible};
