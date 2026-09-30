"use strict";
const Sources=require("./price-sources");
const COST={pos_feed:.2,official_retailer:.6,retailer:.7,retailer_feed:.7,open_data:.35,aggregator:1.2,price_archive:.8,b2b_price_data:.5,aggregated_open_data:.45,product_catalog:.3,store_catalog:.25};
function profile(name,state={}){const s=Sources.SOURCES[name]||{},received=Number(state.lastReceived||0),accepted=Number(state.lastAccepted||0),success=received?Math.max(.05,Math.min(1,accepted/received)):state.consecutiveFailures?Math.max(.1,1/(1+Number(state.consecutiveFailures))):.8;return{source:name,sourceTrust:Number(s.baseTrust||50),sourceSuccessRate:success,requestCost:Number(s.requestCost||COST[s.type]||1),type:s.type||"unknown"}}
module.exports={COST,profile};
