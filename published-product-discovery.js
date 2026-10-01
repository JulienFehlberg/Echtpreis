"use strict";
const Inventory=require("./published-retailer-inventory"),Identity=require("./product-identity"),Discovery=require("./price-query-discovery");
const Dm=require("./published-price-service"),Wolt=require("./wolt-retailer-price-service"),Rewe=require("./rewe-retailer-price-service");
const Nahkauf=Wolt.createService("nahkaufWrangelBerlin"),approved=new Map([[Dm.SOURCE,Dm],[Wolt.SOURCE,Wolt],[Nahkauf.SOURCE,Nahkauf],[Rewe.SOURCE,Rewe]]);
const Hit=require("./hit-product-discovery");
const Filters=require("./retailer-product-search-filters");
function fail(code){return Object.assign(new Error(code),{code});}
function input(options={}){
 if(typeof options.search!=="string"||options.search.trim().length<2||options.search.trim().length>120)throw fail("invalid-product-search");
 const limit=options.limit===undefined?20:Number(options.limit);
 if(typeof options.limit==="boolean"||!Number.isSafeInteger(limit)||limit<1||limit>20)throw fail("invalid-product-limit");
 const now=options.now===undefined?Date.now():new Date(options.now).getTime();if(!Number.isFinite(now))throw fail("invalid-time");
 const requestedPack=Filters.salesPack(options.pack),scopeChannel=Filters.channel(options.scopeChannel);
 if(scopeChannel==="assortment-publication")throw fail("invalid-product-discovery-channel");
 if(options.merchant!==undefined&&(typeof options.merchant!=="string"||!options.merchant.trim()||options.merchant.trim().length>80))throw fail("invalid-merchant");
 return{search:options.search.trim(),limit,now,requestedPack,...(options.pack===undefined?{}:{pack:options.pack.trim()}),...(scopeChannel?{scopeChannel}:{}),...(options.merchant===undefined?{}:{merchant:options.merchant.trim()})};
}
function eligible(offer,now){
 const service=approved.get(offer?.sourceId),captured=Date.parse(offer?.capturedAt),expires=Date.parse(offer?.expiresAt);
 if(!service||!Discovery.validGtin(offer.gtin)||offer.state!=="published"||offer.currency!=="EUR"||offer.scopeCountry!=="DE"||!["online","pickup"].includes(offer.scopeChannel)||offer.truthEligible===true||offer.storeId!=null||offer.productId!=null||!Number.isFinite(captured)||captured>now||captured<now-86400000||!Number.isFinite(expires)||expires<=now||expires>captured+86400000)return null;
 const checked=service.validateOffer(offer,{now});if(!checked.ok)return null;
 const parsed=Discovery.pack(offer.pack),metadata=Discovery.productPack(offer);
 if(!parsed||!metadata||!Discovery.samePack(parsed,metadata))return null;
 return{gtin:checked.offer.gtin,pack:parsed};
}
async function search(pool,options={},inventory=Inventory,physical=Hit){
 const query=input(options),lookup={search:query.search,limit:200,now:query.now,...(query.merchant===undefined?{}:{merchant:query.merchant}),...(query.pack===undefined?{}:{pack:query.pack}),...(query.scopeChannel?{scopeChannel:query.scopeChannel}:{})};
 const [result,physicalResult]=await Promise.all([query.scopeChannel==="physical-store"?{items:[]}:inventory.search(pool,lookup),query.scopeChannel&&query.scopeChannel!=="physical-store"?{items:[],truncated:false}:physical.search(pool,lookup)]),groups=new Map();
 function group(offer,pack){
  // Equivalent decimal unit conversions can have different binary representations.
  let value=[...groups.values()].find(item=>item.gtin===offer.gtin&&Discovery.samePack({amount:item.packAmount,unit:item.packUnit,count:item.packCount},pack));
  if(!value){value={gtin:offer.gtin,name:offer.name,brand:offer.brand||null,pack:offer.pack,packAmount:pack.amount,packUnit:pack.unit,packCount:pack.count,offers:[],physicalOffers:[]};groups.set([offer.gtin,pack.amount,pack.unit,pack.count].join("|"),value)}return value;
 }
 for(const offer of result.items){
  const valid=eligible(offer,query.now);if(!valid||!Filters.matchesPack(offer,query.requestedPack)||query.scopeChannel&&offer.scopeChannel!==query.scopeChannel||query.merchant&&offer.merchant.toLowerCase()!==query.merchant.toLowerCase())continue;
  // An equal total weight is not enough: a 2x250g multipack stays separate from 500g.
  const value=group(offer,valid.pack);
  const sourceKey=[offer.sourceId,offer.nativeVenueId||offer.nativeMarketId||"",offer.retailerSku].join("|");
  if(!value.offers.some(row=>[row.sourceId,row.nativeVenueId||row.nativeMarketId||"",row.retailerSku].join("|")===sourceKey))value.offers.push(offer);
 }
 for(const offer of physicalResult.items){const valid=Hit.validateOffer(offer,{now:query.now});if(!valid||!Filters.matchesPack(offer,query.requestedPack)||query.scopeChannel&&offer.scopeChannel!==query.scopeChannel||query.merchant&&offer.merchant.toLowerCase()!==query.merchant.toLowerCase())continue;const value=group(offer,valid.pack);if(!value.physicalOffers.some(row=>row.sourceId===offer.sourceId&&row.storeId===offer.storeId&&row.retailerSku===offer.retailerSku))value.physicalOffers.push(offer);}
 const captures=value=>[...value.offers,...value.physicalOffers].map(offer=>Date.parse(offer.capturedAt)),ranked=[...groups.values()].sort((a,b)=>Identity.similarity(query.search,b.name)-Identity.similarity(query.search,a.name)||Math.max(...captures(b))-Math.max(...captures(a))||a.name.localeCompare(b.name,"de")||a.gtin.localeCompare(b.gtin)||a.pack.localeCompare(b.pack)),selected=ranked.slice(0,query.limit);
 // Reserve both channels for each chosen identity before filling the shared response budget.
 const items=selected.map(value=>({...value,offers:value.offers.slice(0,1),physicalOffers:value.physicalOffers.slice(0,1)}));let offerCount=items.reduce((sum,value)=>sum+value.offers.length+value.physicalOffers.length,0);
 const remaining=selected.flatMap((value,index)=>[...value.offers.slice(1).map(offer=>({index,field:"offers",offer})),...value.physicalOffers.slice(1).map(offer=>({index,field:"physicalOffers",offer}))]).sort((a,b)=>Date.parse(b.offer.capturedAt)-Date.parse(a.offer.capturedAt)||a.index-b.index||a.field.localeCompare(b.field)||String(a.offer.retailerSku).localeCompare(String(b.offer.retailerSku)));
 for(const extra of remaining){if(offerCount>=200)break;items[extra.index][extra.field].push(extra.offer);offerCount++}
 const physicalStorePrices=items.some(value=>value.physicalOffers.length>0),scopeChannels=[...new Set(items.flatMap(value=>[...value.offers,...value.physicalOffers].map(offer=>offer.scopeChannel)))].sort();
 return{ok:true,items,requiresProductSelection:ranked.length>0,scopeCountry:"DE",physicalStorePrices,scopeChannels,search:query.search,limit:query.limit,discoveryTruncated:result.items.length===200||physicalResult.truncated===true||ranked.length>query.limit||selected.reduce((sum,value)=>sum+value.offers.length+value.physicalOffers.length,0)>200,note:"Konkrete Produkte mit getrennten Online-/Abholangeboten und belegten HIT-Filialwarenpreisen. Die Auswahl bestätigt GTIN und Verkaufspackung; unbekanntes Pfand und zusätzliche Gebühren bleiben offen."};
}
module.exports={search};
