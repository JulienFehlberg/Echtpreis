"use strict";
const crypto=require("crypto");
const FactDate=require("./price-fact-date");
function unitPaid(item={}){const qty=Number(item.itemCount??item.count??1),line=Number(item.lineTotal),price=Number(item.price);if(!Number.isSafeInteger(qty)||qty<1)return null;if(Number.isFinite(line)&&line>0)return line/qty;if(Number.isFinite(price)&&price>0)return price;return null}
function observation(receipt,item,opts={}){
 if(!receipt||!item||item.isAdjustment||item.isDeposit)return null;const price=unitPaid(item);if(!Number.isFinite(price)||!(price>0))return null;
 const purchased=receipt.purchasedAt||receipt.purchased_at||receipt.createdAt||new Date().toISOString(),name=String(item.rawName||item.name||item.product||"").trim();if(!name)return null;const timestamp=FactDate.date(purchased);if(!timestamp)return null;
 const productId=item.productId||null,gtin=item.gtin||null,key=item.productKey||item.key||null,identityConfidence=Number(item.matchConfidence||0);
 return{id:crypto.randomUUID(),productId,gtin,key:key||("receipt:"+name.toLowerCase().replace(/\s+/g,"-").slice(0,80)),product:name,store:String(receipt.merchant||receipt.merchantName||receipt.store||"").trim(),storeId:receipt.storeId||null,region:receipt.region||null,price,per:"piece",date:timestamp.date,observedAt:timestamp.observedAt,kind:"receipt",source:"SPARKORB receipt",proof:"receipt:"+receipt.id,proofType:"receipt",priceType:item.priceType||"regular",packAmount:Number(item.packAmount)>0?Number(item.packAmount):null,packUnit:item.packUnit||null,status:opts.identityVerified===true&&opts.proofVerified===true?"verified":"observed",proofVerified:opts.proofVerified===true,identityVerified:opts.identityVerified===true,identityConfidence,trust:opts.identityVerified===true&&opts.proofVerified===true?92:70};
}
function eligibleForExact(o){return!!(o&&o.identityVerified===true&&(o.productId||o.gtin))}
module.exports={unitPaid,observation,eligibleForExact};
