"use strict";
const Variant=require("./product-variant-identity"),Identity=require("./product-identity");
function edge(a={},b={},evidence={}){const c=Variant.compatibility(a,b);if(!c.ok)return{state:"reject",reason:c.reason,confidence:0};const ga=Variant.gtin(a.gtin||a.ean),gb=Variant.gtin(b.gtin||b.ean),sources=Math.max(0,Number(evidence.sources||0)),count=Math.max(0,Number(evidence.count||0)),base=ga&&gb&&ga===gb?1:Number(c.score||Identity.match(a,b).score||0),boost=Math.min(.06,sources*.02)+Math.min(.03,count*.003),confidence=Math.min(1,base+boost);if(ga&&gb&&ga===gb)return{state:"verified",reason:"gtin",confidence:1};if(confidence>=.95&&sources>=2)return{state:"verified",reason:"multi-source-compatible-alias",confidence};if(confidence>=.88)return{state:"review",reason:"compatible-alias",confidence};return{state:"observed",reason:"insufficient-alias-evidence",confidence}}
function mergeAllowed(edgeResult={}){return edgeResult.state==="verified"}
module.exports={edge,mergeAllowed};
