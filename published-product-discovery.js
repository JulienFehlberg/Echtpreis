"use strict";
const Inventory=require("./published-retailer-inventory"),Identity=require("./product-identity"),Discovery=require("./price-query-discovery");
const Dm=require("./published-price-service"),Wolt=require("./wolt-retailer-price-service"),Rewe=require("./rewe-retailer-price-service");
const Nahkauf=Wolt.createService("nahkaufWrangelBerlin"),approved=new Map([[Dm.SOURCE,Dm],[Wolt.SOURCE,Wolt],[Nahkauf.SOURCE,Nahkauf],[Rewe.SOURCE,Rewe]]);
const Hit=require("./hit-product-discovery");
const Filters=require("./retailer-product-search-filters");
const Need=require("./shopping-need-matcher");
function fail(code){return Object.assign(new Error(code),{code});}
function input(options={}){
 if(typeof options.search!=="string"||options.search.trim().length<2||options.search.trim().length>120)throw fail("invalid-product-search");
 const limit=options.limit===undefined?20:Number(options.limit);
 if(typeof options.limit==="boolean"||!Number.isSafeInteger(limit)||limit<1||limit>20)throw fail("invalid-product-limit");
 const now=options.now===undefined?Date.now():new Date(options.now).getTime();if(!Number.isFinite(now))throw fail("invalid-time");
 const requestedPack=Filters.salesPack(options.pack),scopeChannel=Filters.channel(options.scopeChannel);
 if(scopeChannel==="assortment-publication")throw fail("invalid-product-discovery-channel");
 if(options.merchant!==undefined&&(typeof options.merchant!=="string"||!options.merchant.trim()||options.merchant.trim().length>80))throw fail("invalid-merchant");
 if(options.priorityRetailersOnly!==undefined&&typeof options.priorityRetailersOnly!=="boolean")throw fail("invalid-retailer-priority-filter");
 const need=options.constraints===undefined?null:Need.parse({search:options.search,constraints:options.constraints});
 return{search:options.search.trim(),limit,now,requestedPack,need,...(options.pack===undefined?{}:{pack:options.pack.trim()}),...(scopeChannel?{scopeChannel}:{}),...(options.merchant===undefined?{}:{merchant:options.merchant.trim()}),...(options.priorityRetailersOnly===undefined?{}:{priorityRetailersOnly:options.priorityRetailersOnly})};
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
 const query=input(options),lookup={search:query.need?{milk:"Milch",bread:"Brot",eggs:"Eier",butter:"Butter"}[query.need.constraints.family]:query.search,limit:200,now:query.now,...(query.merchant===undefined?{}:{merchant:query.merchant}),...(query.pack===undefined?{}:{pack:query.pack}),...(query.scopeChannel?{scopeChannel:query.scopeChannel}:{}),...(query.priorityRetailersOnly===undefined?{}:{priorityRetailersOnly:query.priorityRetailersOnly})};
 const [result,physicalResult]=await Promise.all([query.scopeChannel==="physical-store"?{items:[]}:inventory.search(pool,lookup),query.priorityRetailersOnly===true||query.scopeChannel&&query.scopeChannel!=="physical-store"?{items:[],truncated:false}:physical.search(pool,lookup)]),groups=new Map();
 const needCounts={confirmedOffers:0,unconfirmedOffers:0,contradictedOffers:0},assessments=new WeakMap();
 function assess(offer){if(assessments.has(offer))return assessments.get(offer);const native=offer.scopeChannel==="physical-store",assessment=Need.classify(query.need,{name:native?offer.nativeProof.headline:offer.name,...(!native&&[Wolt.SOURCE,Nahkauf.SOURCE,Rewe.SOURCE].includes(offer.sourceId)&&offer.description?{description:offer.description}:{})});assessments.set(offer,assessment);return assessment;}
 function suitable(offer){if(!query.need)return true;const assessment=assess(offer);needCounts[assessment.status+"Offers"]++;return assessment.status!=="contradicted";}
 function group(offer,pack){
  // Equivalent decimal unit conversions can have different binary representations.
  let value=[...groups.values()].find(item=>item.gtin===offer.gtin&&Discovery.samePack({amount:item.packAmount,unit:item.packUnit,count:item.packCount},pack));
  if(!value){value={gtin:offer.gtin,name:offer.name,brand:offer.brand||null,pack:offer.pack,packAmount:pack.amount,packUnit:pack.unit,packCount:pack.count,offers:[],physicalOffers:[]};groups.set([offer.gtin,pack.amount,pack.unit,pack.count].join("|"),value)}return value;
 }
 for(const offer of result.items){
  const valid=eligible(offer,query.now);if(!valid||query.priorityRetailersOnly===true&&!["ALDI","PENNY","REWE","Lidl","Kaufland","EDEKA"].includes(offer.merchant)||!Filters.matchesPack(offer,query.requestedPack)||query.scopeChannel&&offer.scopeChannel!==query.scopeChannel||query.merchant&&offer.merchant.toLowerCase()!==query.merchant.toLowerCase()||!suitable(offer))continue;
  // An equal total weight is not enough: a 2x250g multipack stays separate from 500g.
  const value=group(offer,valid.pack);
  const sourceKey=[offer.sourceId,offer.nativeVenueId||offer.nativeMarketId||"",offer.retailerSku].join("|");
  if(!value.offers.some(row=>[row.sourceId,row.nativeVenueId||row.nativeMarketId||"",row.retailerSku].join("|")===sourceKey))value.offers.push(offer);
 }
 for(const offer of physicalResult.items){const valid=Hit.validateOffer(offer,{now:query.now});if(!valid||!Filters.matchesPack(offer,query.requestedPack)||query.scopeChannel&&offer.scopeChannel!==query.scopeChannel||query.merchant&&offer.merchant.toLowerCase()!==query.merchant.toLowerCase()||!suitable(offer))continue;const value=group(offer,valid.pack);if(!value.physicalOffers.some(row=>row.sourceId===offer.sourceId&&row.storeId===offer.storeId&&row.retailerSku===offer.retailerSku))value.physicalOffers.push(offer);}
 const captures=value=>[...value.offers,...value.physicalOffers].map(offer=>Date.parse(offer.capturedAt)),confirmedOffers=value=>query.need?[...value.offers,...value.physicalOffers].filter(offer=>assess(offer).status==="confirmed").length:0,ranked=[...groups.values()].sort((a,b)=>Number(confirmedOffers(b)>0)-Number(confirmedOffers(a)>0)||Identity.similarity(query.search,b.name)-Identity.similarity(query.search,a.name)||Math.max(...captures(b))-Math.max(...captures(a))||a.name.localeCompare(b.name,"de")||a.gtin.localeCompare(b.gtin)||a.pack.localeCompare(b.pack)),selected=ranked.slice(0,query.limit);
 if(query.need)for(const value of selected)for(const field of["offers","physicalOffers"])value[field].sort((a,b)=>Number(assess(b).status==="confirmed")-Number(assess(a).status==="confirmed")||Date.parse(b.capturedAt)-Date.parse(a.capturedAt)||String(a.retailerSku).localeCompare(String(b.retailerSku)));
 // Reserve both channels for each chosen identity before filling the shared response budget.
 const items=selected.map(value=>({...value,offers:value.offers.slice(0,1),physicalOffers:value.physicalOffers.slice(0,1)}));let offerCount=items.reduce((sum,value)=>sum+value.offers.length+value.physicalOffers.length,0);
 const remaining=selected.flatMap((value,index)=>[...value.offers.slice(1).map(offer=>({index,field:"offers",offer})),...value.physicalOffers.slice(1).map(offer=>({index,field:"physicalOffers",offer}))]).sort((a,b)=>Date.parse(b.offer.capturedAt)-Date.parse(a.offer.capturedAt)||a.index-b.index||a.field.localeCompare(b.field)||String(a.offer.retailerSku).localeCompare(String(b.offer.retailerSku)));
 for(const extra of remaining){if(offerCount>=200)break;items[extra.index][extra.field].push(extra.offer);offerCount++}
 if(query.need)for(const item of items){const offers=[...item.offers,...item.physicalOffers];item.needAssessment={status:offers.some(offer=>assess(offer).status==="confirmed")?"confirmed":"unconfirmed",selectionRequired:true,offerMatches:offers.map(offer=>({sourceId:offer.sourceId,scopeChannel:offer.scopeChannel,retailerSku:offer.retailerSku,storeId:offer.storeId||null,nativeVenueId:offer.nativeVenueId||null,nativeMarketId:offer.nativeMarketId||null,gtin:offer.gtin,pack:offer.pack,...assess(offer)}))};}
 const physicalStorePrices=items.some(value=>value.physicalOffers.length>0),scopeChannels=[...new Set(items.flatMap(value=>[...value.offers,...value.physicalOffers].map(offer=>offer.scopeChannel)))].sort();
 return{ok:true,items,requiresProductSelection:ranked.length>0,scopeCountry:"DE",physicalStorePrices,scopeChannels,search:query.search,limit:query.limit,discoveryTruncated:result.items.length===200||physicalResult.truncated===true||ranked.length>query.limit||selected.reduce((sum,value)=>sum+value.offers.length+value.physicalOffers.length,0)>200,...(query.need?{need:query.need,selectionRequired:true,automaticSelection:false,needCoverage:{...needCounts,confirmedIdentities:items.filter(item=>item.needAssessment.status==="confirmed").length,unconfirmedIdentities:items.filter(item=>item.needAssessment.status==="unconfirmed").length,complete:false},needNote:"Eigenschaften werden nur aus aktuellen nativen Produkttexten bestätigt. Fehlende Angaben bleiben unbestätigt; widersprüchliche Varianten werden ausgeschlossen. Eine bestätigte Eigenschaft ersetzt keine bewusste Auswahl von GTIN und Verkaufspackung. Die begrenzte Suche bestätigt kein vollständiges Sortiment."}:{}),note:"Konkrete Produkte mit getrennten Online-/Abholangeboten und belegten HIT-Filialwarenpreisen. Die Auswahl bestätigt GTIN und Verkaufspackung; unbekanntes Pfand und zusätzliche Gebühren bleiben offen."};
}
async function searchNeed(pool,options={},inventory=Inventory,physical=Hit){if(!options||typeof options!=="object"||Array.isArray(options)||Object.keys(options).some(key=>!["search","merchant","limit","pack","scopeChannel","constraints","priorityRetailersOnly"].includes(key)))throw fail("invalid-shopping-need-input");Need.parse({search:options.search,constraints:options.constraints});return search(pool,options,inventory,physical);}
module.exports={search,searchNeed};
