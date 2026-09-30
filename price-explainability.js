"use strict";
function explainPrice({product,observation,source,confirmations=0,identity,calibration}={}){
 const reasons=[],warnings=[];let score=Number(observation?.confidenceScore??observation?.trust??0);
 if(identity?.reason==="gtin"||identity?.reason==="canonical-product-id"){score=Math.max(score,94);reasons.push("exact-product-identity")}else if(identity?.score>=.9)reasons.push("strong-product-match");else warnings.push("product-identity-not-exact");
 if(observation?.locationId){reasons.push("branch-specific")}else if(observation?.region){reasons.push("regional-only");warnings.push("not-branch-specific")}else warnings.push("location-unspecified");
 if(observation?.proof){reasons.push("proof-attached")}else warnings.push("proof-missing");
 if(confirmations>=2){score=Math.min(100,score+Math.min(5,confirmations));reasons.push("independent-confirmations:"+confirmations)}
 if(calibration?.grade==="poor"){score=Math.max(0,score-12);warnings.push("source-calibration-poor")}else if(calibration?.grade==="excellent"){score=Math.min(100,score+3);reasons.push("source-calibration-excellent")}
 return{productId:product?.id||observation?.productId||null,observationId:observation?.id||null,price:Number(observation?.price)||null,currency:observation?.currency||"EUR",priceType:observation?.priceType||"regular",score:Math.round(score),state:score>=90?"verified":score>=75?"strong":score>=60?"estimated":"weak",reasons,warnings,source:source?.name||observation?.source||null,proof:observation?.proof||null,observedAt:observation?.observedAt||observation?.date||null,validTo:observation?.validTo||null};
}
function trace(x){return{product:x.productId,price:x.price,currency:x.currency,type:x.priceType,state:x.state,confidence:x.score,source:x.source,proof:x.proof,observedAt:x.observedAt,validTo:x.validTo,reasons:x.reasons,warnings:x.warnings}}
module.exports={explainPrice,trace};
