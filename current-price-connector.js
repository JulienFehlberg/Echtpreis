"use strict";
const Identity=require("./product-identity");
const Semantics=require("./source-semantics");
const PRICE_TYPES=new Set(["regular","promotion","loyalty","app","coupon","multi_buy","personalized"]);
function text(x,n=300){return String(x??"").trim().slice(0,n)}
function normalizePrice(x){const n=Number(String(x??"").replace(",","."));return Number.isFinite(n)&&n>0?n:null}
function normalize(raw,meta={}){
 const observedAt=raw.observedAt||meta.fetchedAt||new Date().toISOString(),price=normalizePrice(raw.price);
 const priceType=raw.priceType==null?"regular":text(raw.priceType,30),minQuantity=normalizePrice(raw.minQuantity??raw.quantityRequired);
 const base={merchant:text(raw.merchant||meta.merchant,80),storeId:text(raw.storeId||meta.storeId,120)||null,externalLocationId:text(raw.externalLocationId,160)||null,address:text(raw.address,240)||null,postalCode:text(raw.postalCode,20)||null,city:text(raw.city,120)||null,latitude:Number.isFinite(Number(raw.latitude))?Number(raw.latitude):null,longitude:Number.isFinite(Number(raw.longitude))?Number(raw.longitude):null,region:text(raw.region||meta.region,120)||null,gtin:text(raw.gtin||raw.ean,32)||null,externalProductId:text(raw.externalProductId,160)||null,product:text(raw.product||raw.name,200),brand:text(raw.brand,120)||null,pack:text(raw.pack||raw.packageSize,80)||null,price,currency:text(raw.currency||"EUR",8),priceType,minQuantity,regularPrice:normalizePrice(raw.regularPrice),validFrom:raw.validFrom||null,validTo:raw.validTo||null,observedAt,source:text(meta.source||raw.source,120),sourceUrl:text(raw.sourceUrl||meta.sourceUrl,500)||null,proof:text(raw.proof||raw.proofId||raw.sourceUrl||meta.sourceUrl,500)||null,proofType:text(raw.proofType||meta.proofType||"official-page",50),proofHash:text(raw.proofHash,160)||null,proofActor:text(raw.proofActor,160)||null,providerSource:text(raw.providerSource,80)||null,registryTrust:Number(meta.registryTrust||0),sourceType:text(meta.sourceType||raw.sourceType||"unknown",40),sourceId:text(raw.sourceId||meta.id||meta.source||raw.source,120),fetchedAt:meta.fetchedAt||new Date().toISOString()};const policy=Semantics.policy(base);return{...base,evidencePurpose:Semantics.primaryPurpose(base),truthEligible:policy.currentPrice};
}
function validate(x,meta={}){
 const e=[];if(!x.merchant)e.push("merchant");if(!x.product&&!x.gtin)e.push("product");if(!(x.price>0))e.push("price");if(!x.observedAt)e.push("observedAt");if(!x.source)e.push("source");if(!x.proof)e.push("proof");if(!PRICE_TYPES.has(x.priceType))e.push("priceType");if(x.priceType==="multi_buy"&&!(Number.isSafeInteger(x.minQuantity)&&x.minQuantity>1))e.push("minQuantity");if(meta.requiresStore&& !x.storeId)e.push("storeId");if(meta.requiresRegion&&!x.region&&!x.storeId)e.push("region");if(x.gtin&&!Identity.gtinValid(x.gtin))e.push("gtin");if(x.validFrom&&x.validTo&&String(x.validFrom)>String(x.validTo))e.push("validity");return e}
function contract(meta={}){
 if(!meta.id||!meta.merchant||!meta.sourceType)throw new Error("invalid connector contract");
 const semantics=Semantics.policy({source:meta.id,sourceType:meta.sourceType});return Object.freeze({id:meta.id,merchant:meta.merchant,sourceType:meta.sourceType,allowed:meta.allowed===true,requiresStore:!!meta.requiresStore,requiresRegion:!!meta.requiresRegion,registryTrust:Number(meta.registryTrust||0),termsStatus:meta.termsStatus||"review",license:meta.license||null,purposes:semantics.purposes,truthEligible:meta.allowed===true&&semantics.currentPrice});
}
function ingest(contractDef,rawRows=[],fetchMeta={}){
 if(!contractDef.allowed)return{accepted:[],rejected:rawRows.map(raw=>({raw,reasons:["connector-not-approved"]}))};
 const accepted=[],rejected=[];for(const raw of rawRows){const x=normalize(raw,{...fetchMeta,...contractDef,source:contractDef.id});const reasons=validate(x,contractDef);if(reasons.length)rejected.push({raw,reasons});else accepted.push(x)}return{accepted,rejected};
}
module.exports={normalizePrice,normalize,validate,contract,ingest};
