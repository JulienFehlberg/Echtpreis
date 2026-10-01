"use strict";
const Inventory=require("./published-retailer-inventory"),Identity=require("./product-identity"),Discovery=require("./price-query-discovery");
const Dm=require("./published-price-service"),Wolt=require("./wolt-retailer-price-service"),Rewe=require("./rewe-retailer-price-service");
const Nahkauf=Wolt.createService("nahkaufWrangelBerlin"),approved=new Map([[Dm.SOURCE,Dm],[Wolt.SOURCE,Wolt],[Nahkauf.SOURCE,Nahkauf],[Rewe.SOURCE,Rewe]]);
function fail(code){return Object.assign(new Error(code),{code});}
function input(options={}){
 if(typeof options.search!=="string"||options.search.trim().length<2||options.search.trim().length>120)throw fail("invalid-product-search");
 const limit=options.limit===undefined?20:Number(options.limit);
 if(typeof options.limit==="boolean"||!Number.isSafeInteger(limit)||limit<1||limit>20)throw fail("invalid-product-limit");
 const now=options.now===undefined?Date.now():new Date(options.now).getTime();if(!Number.isFinite(now))throw fail("invalid-time");
 return{search:options.search.trim(),limit,now,...(options.merchant===undefined?{}:{merchant:options.merchant})};
}
function eligible(offer,now){
 const service=approved.get(offer?.sourceId),captured=Date.parse(offer?.capturedAt),expires=Date.parse(offer?.expiresAt);
 if(!service||!Discovery.validGtin(offer.gtin)||offer.state!=="published"||offer.currency!=="EUR"||offer.scopeCountry!=="DE"||!["online","pickup"].includes(offer.scopeChannel)||offer.truthEligible===true||offer.storeId!=null||offer.productId!=null||!Number.isFinite(captured)||captured>now||captured<now-86400000||!Number.isFinite(expires)||expires<=now||expires>captured+86400000)return null;
 const checked=service.validateOffer(offer,{now});if(!checked.ok)return null;
 const parsed=Discovery.pack(offer.pack),metadata=Discovery.productPack(offer);
 if(!parsed||!metadata||!Discovery.samePack(parsed,metadata))return null;
 return{gtin:checked.offer.gtin,pack:parsed};
}
async function search(pool,options={},inventory=Inventory){
 const query=input(options),result=await inventory.search(pool,{search:query.search,limit:200,now:query.now,...(query.merchant===undefined?{}:{merchant:query.merchant})}),groups=new Map();
 for(const offer of result.items){
  const valid=eligible(offer,query.now);if(!valid)continue;
  // An equal total weight is not enough: a 2x250g multipack stays separate from 500g.
  const {gtin,pack}=valid,key=[gtin,pack.amount,pack.unit,pack.count].join("|");
  let group=groups.get(key);if(!group){group={gtin,name:offer.name,brand:offer.brand||null,pack:offer.pack,packAmount:pack.amount,packUnit:pack.unit,packCount:pack.count,offers:[]};groups.set(key,group);}
  const sourceKey=[offer.sourceId,offer.nativeVenueId||offer.nativeMarketId||"",offer.retailerSku].join("|");
  if(!group.offers.some(row=>[row.sourceId,row.nativeVenueId||row.nativeMarketId||"",row.retailerSku].join("|")===sourceKey))group.offers.push(offer);
 }
 const ranked=[...groups.values()].sort((a,b)=>Identity.similarity(query.search,b.name)-Identity.similarity(query.search,a.name)||Date.parse(b.offers[0].capturedAt)-Date.parse(a.offers[0].capturedAt)||a.name.localeCompare(b.name,"de")||a.gtin.localeCompare(b.gtin)||a.pack.localeCompare(b.pack));
 return{ok:true,items:ranked.slice(0,query.limit),requiresProductSelection:ranked.length>0,scopeCountry:"DE",physicalStorePrices:false,search:query.search,limit:query.limit,discoveryTruncated:result.items.length===200||ranked.length>query.limit,note:"Konkrete Produkte aus aktuell veröffentlichten Online- und Abholpreisen. Die Auswahl bestätigt Produkt und Verkaufspackung; Filialpreise und Gebühren werden separat geprüft."};
}
module.exports={search};
