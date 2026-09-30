"use strict";
function view(plan={}){return Object.values(plan).map(x=>({source:x.source,type:x.type,budget:Number(x.budget||0),informationGain:Number(x.informationGain||0),sourceTrust:Number(x.sourceTrust||0),sourceSuccessRate:Number(x.sourceSuccessRate||0),requestCost:Number(x.requestCost||0)})).sort((a,b)=>b.informationGain-a.informationGain)}
module.exports={view};
