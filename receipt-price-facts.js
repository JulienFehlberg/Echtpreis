"use strict";
const crypto=require("crypto");
function unitPaid(item={}){
 const qty=Number(item.itemCount??item.count??1);
 if(!Number.isFinite(qty)||qty<1||qty>1000||!Number.isInteger(qty))return null;
 const hasLine=item.lineTotal!=null,line=Number(item.lineTotal),price=Number(item.price);
 // The amount paid on the receipt is authoritative, including single-item lines.
 const paid=hasLine?line/qty:price;
 return Number.isFinite(paid)&&paid>0?paid:null;
}
function observation(receipt,item,opts={}){
 if(!receipt||!item||item.isAdjustment||item.isDeposit)return null;const price=unitPaid(item);if(!(price>0))return null;
 const purchased=receipt.purchasedAt||receipt.purchased_at||receipt.createdAt||new Date().toISOString(),name=String(item.rawName||item.name||item.product||"").trim();if(!name)return null;
 const productId=item.productId||null,gtin=item.gtin||null,key=item.productKey||item.key||null,identityConfidence=Number(item.matchConfidence||0);
 return{id:crypto.randomUUID(),productId,gtin,key:key||("receipt:"+name.toLowerCase().replace(/\s+/g,"-").slice(0,80)),product:name,store:String(receipt.merchant||receipt.merchantName||receipt.store||"").trim(),storeId:receipt.storeId||null,region:receipt.region||null,price,per:item.packUnit||"piece",date:String(purchased).slice(0,10),observedAt:purchased,kind:"receipt",source:"ECHTPREIS receipt",proof:"receipt:"+receipt.id,proofType:"receipt",priceType:item.priceType||"regular",packAmount:Number(item.packAmount)>0?Number(item.packAmount):null,packUnit:item.packUnit||null,status:opts.identityVerified===true?"verified":"observed",identityVerified:opts.identityVerified===true,identityConfidence,trust:opts.identityVerified===true?92:70};
}
function eligibleForExact(o){return!!(o&&o.identityVerified===true&&(o.productId||o.gtin))}
module.exports={unitPaid,observation,eligibleForExact};
