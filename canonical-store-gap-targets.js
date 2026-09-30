"use strict";
const Info=require("./information-gain");
function rank(coverage={},opts={}){const sourceTrust=Number(opts.sourceTrust||78),requestCost=Number(opts.requestCost||1),productPriority=Number(opts.productPriority||50);return(coverage.stores||[]).filter(x=>!x.covered).map(x=>{const input={demandScore:Math.min(1,productPriority/100),lastObservedAt:x.lastObservedAt,observationCount:0,storeGap:1,sourceTrust,requestCost};return{storeId:x.storeId,merchant:x.merchant,address:x.address,postalCode:x.postalCode,city:x.city,productId:coverage.productId||null,gtin:coverage.gtin||null,priority:Math.round(Info.score(input)),informationGain:Info.explain(input)}}).sort((a,b)=>b.priority-a.priority)}
module.exports={rank};
