"use strict";
const Connector=require("./current-price-connector");
const Registry=require("./current-price-connectors");
const Collectors=require("./collectors/retailers");
const MAP={rewe:"rewe",edeka:"edeka",kaufland:"kaufland",lidl:"lidl",penny:"penny",netto:"netto",aldiNord:"aldiNord",aldiSued:"aldiSued"};
function contract(key){const k=MAP[key]||key,c=Registry.contracts[k];if(!c)throw new Error("unknown-retailer-contract");if(!c.allowed)throw new Error("retailer-source-not-approved");return c}
function normalize(key,items=[],meta={}){
 const c=contract(key),raw=key==="rewe"?Collectors.reweOffers(items,meta):key==="aldiSued"?Collectors.aldiSued(items,meta):Collectors.genericOffers(c.merchant,items,{...meta,trust:c.registryTrust});
 const shaped=raw.map(x=>({merchant:c.merchant==="*"?x.store:c.merchant,storeId:meta.storeId||null,externalLocationId:x.locationId?String(c.id).toLowerCase().replace(/\s+/g,"-")+":"+x.locationId:null,region:x.region,gtin:x.gtin,externalProductId:x.gtin?String(c.id).toLowerCase().replace(/\s+/g,"-")+":"+x.gtin:null,product:x.product,pack:x.quantity&&x.unit?x.quantity+" "+x.unit:null,price:x.price,regularPrice:x.regularPrice,priceType:x.priceType,validFrom:x.validFrom,validTo:x.validTo,observedAt:x.date?new Date(String(x.date).slice(0,10)+"T12:00:00Z").toISOString():meta.fetchedAt||new Date().toISOString(),proof:x.proof,proofType:x.proofType,sourceUrl:x.sourceUrl,sourceId:c.id,fetchedAt:meta.fetchedAt||new Date().toISOString(),currency:"EUR"}));
 return Connector.ingest(c,shaped,{fetchedAt:meta.fetchedAt});
}
module.exports={MAP,contract,normalize};
