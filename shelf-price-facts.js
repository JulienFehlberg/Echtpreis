"use strict";
const crypto=require("crypto");
function fact(b={},verification={}){
 const price=Number(b.price),name=String(b.product||"").trim(),storeId=String(b.storeId||"").trim(),proof=String(b.proof||"").trim(),observedAt=b.observedAt||new Date().toISOString();
 const errors=[];if(!(price>0))errors.push("price");if(!name&&!b.gtin)errors.push("product");if(!storeId)errors.push("storeId");if(!proof)errors.push("proof");if(!b.gtin&&!b.productId&&Number(b.matchConfidence||0)<.9)errors.push("identity");
 if(errors.length)return{ok:false,errors};const verified=verification.store===true&&verification.product===true&&verification.proof===true;return{ok:true,value:{id:crypto.randomUUID(),key:b.productKey||("shelf:"+String(b.gtin||name).toLowerCase().replace(/\s+/g,"-").slice(0,80)),product:name||String(b.gtin),productId:b.productId||null,gtin:b.gtin||null,store:b.merchant||"unknown",storeId,region:b.region||null,price,per:b.packUnit||"piece",date:String(observedAt).slice(0,10),observedAt,kind:"shelf",source:"ECHTPREIS shelf",proof,proofType:"shelf-photo",priceType:b.priceType||"regular",validFrom:b.validFrom||null,validTo:b.validTo||null,regularPrice:Number(b.regularPrice)>0?Number(b.regularPrice):null,minQuantity:Number(b.minQuantity)>0?Number(b.minQuantity):null,packAmount:Number(b.packAmount)>0?Number(b.packAmount):null,packUnit:b.packUnit||null,trust:verified?90:65,status:verified?"verified":"observed"}};
}
module.exports={fact};
