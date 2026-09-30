"use strict";
const crypto=require("crypto");
function unitPaid(item={}){const qty=Math.max(1,Number(item.itemCount||item.count||1)),line=Number(item.lineTotal),price=Number(item.price);if(line>0&&qty>1)return line/qty;if(price>0)return price;if(line>0)return line;return null}
function observation(receipt,item,opts={}){
 if(!receipt||!item||item.isAdjustment||item.isDeposit)return null;const price=unitPaid(item);if(!(price>0))return null;
 const purchased=receipt.purchasedAt||receipt.purchased_at||receipt.createdAt||new Date().toISOString(),name=String(item.rawName||item.name||item.product||"").trim();if(!name)return null;
 const productId=item.productId||null,gtin=item.gtin||null,key=item.productKey||item.key||null,identityConfidence=Number(item.matchConfidence||0);
 return{id:crypto.randomUUID(),productId,gtin,key:key||("receipt:"+name.toLowerCase().replace(/\s+/g,"-").slice(0,80)),product:name,store:String(receipt.merchant||receipt.merchantName||receipt.store||"").trim(),storeId:receipt.storeId||null,region:receipt.region||null,price,per:item.packUnit||"piece",date:String(purchased).slice(0,10),observedAt:purchased,kind:"receipt",source:"ECHTPREIS receipt",proof:"receipt:"+receipt.id,proofType:"receipt",priceType:item.priceType||"regular",packAmount:Number(item.packAmount)>0?Number(item.packAmount):null,packUnit:item.packUnit||null,status:productId||gtin||identityConfidence>=.9?"verified":"observed",identityConfidence,trust:92};
}
function eligibleForExact(o){return!!(o&&(o.productId||o.gtin||o.identityConfidence>=.9))}
module.exports={unitPaid,observation,eligibleForExact};
