"use strict";
const Identity=require("./product-identity");
function text(x,n=300){return String(x??"").trim().slice(0,n)}
function normalizePrice(x){const n=Number(String(x??"").replace(",","."));return Number.isFinite(n)&&n>0?n:null}
function normalize(raw,meta={}){
 const observedAt=raw.observedAt||meta.fetchedAt||new Date().toISOString(),price=normalizePrice(raw.price);
 return{merchant:text(raw.merchant||meta.merchant,80),storeId:text(raw.storeId||meta.storeId,120)||null,externalLocationId:text(raw.externalLocationId,160)||null,address:text(raw.address,240)||null,postalCode:text(raw.postalCode,20)||null,city:text(raw.city,120)||null,region:text(raw.region||meta.region,120)||null,gtin:text(raw.gtin||raw.ean,32)||null,externalProductId:text(raw.externalProductId,160)||null,product:text(raw.product||raw.name,200),brand:text(raw.brand,120)||null,pack:text(raw.pack||raw.packageSize,80)||null,price,currency:text(raw.currency||"EUR",8),priceType:text(raw.priceType||"regular",30),regularPrice:normalizePrice(raw.regularPrice),validFrom:raw.validFrom||null,validTo:raw.validTo||null,observedAt,source:text(meta.source||raw.source,120),sourceUrl:text(raw.sourceUrl||meta.sourceUrl,500)||null,proof:text(raw.proof||raw.proofId||raw.sourceUrl||meta.sourceUrl,500)||null,proofType:text(raw.proofType||meta.proofType||"official-page",50),registryTrust:Number(meta.registryTrust||0),sourceType:text(meta.sourceType||raw.sourceType||"unknown",40),sourceId:text(meta.id||raw.sourceId||meta.source||raw.source,120),fetchedAt:meta.fetchedAt||new Date().toISOString()};
}
function validate(x,meta={}){
 const e=[];if(!x.merchant)e.push("merchant");if(!x.product&&!x.gtin)e.push("product");if(!(x.price>0))e.push("price");if(!x.observedAt)e.push("observedAt");if(!x.source)e.push("source");if(!x.proof)e.push("proof");if(meta.requiresStore&& !x.storeId)e.push("storeId");if(meta.requiresRegion&&!x.region&&!x.storeId)e.push("region");if(x.gtin&&!Identity.gtinValid(x.gtin))e.push("gtin");if(x.validFrom&&x.validTo&&String(x.validFrom)>String(x.validTo))e.push("validity");return e}
function contract(meta={}){
 if(!meta.id||!meta.merchant||!meta.sourceType)throw new Error("invalid connector contract");
 return Object.freeze({id:meta.id,merchant:meta.merchant,sourceType:meta.sourceType,allowed:meta.allowed===true,requiresStore:!!meta.requiresStore,requiresRegion:!!meta.requiresRegion,registryTrust:Number(meta.registryTrust||0),termsStatus:meta.termsStatus||"review",license:meta.license||null});
}
function ingest(contractDef,rawRows=[],fetchMeta={}){
 if(!contractDef.allowed)return{accepted:[],rejected:rawRows.map(raw=>({raw,reasons:["connector-not-approved"]}))};
 const accepted=[],rejected=[];for(const raw of rawRows){const x=normalize(raw,{...fetchMeta,...contractDef,source:contractDef.id});const reasons=validate(x,contractDef);if(reasons.length)rejected.push({raw,reasons});else accepted.push(x)}return{accepted,rejected};
}
module.exports={normalizePrice,normalize,validate,contract,ingest};
