(function(root){
"use strict";
const Current=typeof module==="object"&&module.exports?require("./current-price-client"):root.SparkorbCurrentPriceClient;
const Products=typeof module==="object"&&module.exports?require("./published-product-client"):root.SparkorbPublishedProductClient;
const retailers=Object.freeze(["ALDI","PENNY","REWE","Lidl","Kaufland","EDEKA"]),text=v=>typeof v==="string"?v.trim():"";
function candidate(input,options={}){
 const offer=Current?.normalizePublishedReference(input?.offer,options),r=input?.reference;
 const query=options.request;
 if(query){const filters=Products.searchFilters(query),wanted=filters.parsedPack&&Current.parsePack({amount:filters.parsedPack.amount,unit:filters.parsedPack.unit});if(!filters.ok||query.gtin&&offer?.gtin!==query.gtin||query.merchant&&offer?.merchant!==query.merchant||query.scopeChannel&&offer?.scopeChannel!==query.scopeChannel||wanted&&(!offer||wanted.unit!==offer.packUnit||Math.abs(wanted.amount-offer.packAmount)>1e-9||filters.parsedPack.count!==offer.packCount)||query.search&&![offer?.name,offer?.brand,offer?.gtin].some(value=>typeof value==="string"&&value.toLocaleLowerCase("de").includes(query.search.toLocaleLowerCase("de"))))return null;}
 if(!offer||!r||r.kind!=="last-observed"||r.city!=="Berlin"||r.country!=="DE"||r.merchant!==offer.merchant||r.observedAt!==offer.capturedAt||!text(r.key)||r.key.length>1000||r.identityKind!==(offer.gtin?"native-gtin":"native-retailer-sku")||!Number.isSafeInteger(r.observedMarkets)||r.observedMarkets<1||r.observedMarkets>200)return null;
 const market=r.sourceMarket,shop=offer.shop;if(!market||!shop||["name","address","postalCode","city","country"].some(k=>market[k]!==shop[k]))return null;
 if(offer.nativeVenueId&&market.nativeVenueId!==offer.nativeVenueId||offer.nativeMarketId&&String(market.nativeMarketId)!==String(offer.nativeMarketId))return null;
 let knownPriceRange=null;const range=r.knownPriceRange;
 if(range!=null){if(typeof range.min!=="number"||typeof range.max!=="number"||!Number.isFinite(range.min)||!Number.isFinite(range.max)||range.min<=0||range.min>offer.price||range.max<offer.price||range.max<range.min||range.max>10000)return null;knownPriceRange={min:range.min,max:range.max};}
 return{offer,reference:{kind:"last-observed",city:"Berlin",country:"DE",merchant:offer.merchant,key:r.key,identityKind:r.identityKind,observedAt:offer.capturedAt,sourceMarket:shop,observedMarkets:r.observedMarkets,knownPriceRange}};
}
function normalizeResponse(raw,options={}){
 if(!raw||raw.ok!==true||raw.city!=="Berlin"||raw.country!=="DE"||!Array.isArray(raw.items)||raw.items.length>200)return{ok:false,items:[],reason:"invalid-berlin-reference-response"};
 const groups=new Map(),conflicts=new Set();for(const input of raw.items){const row=candidate(input,options);if(!row)continue;const key=row.reference.key;if(groups.has(key)){conflicts.add(key);continue;}groups.set(key,row);}
 return{ok:true,city:"Berlin",country:"DE",items:[...groups].filter(([key])=>!conflicts.has(key)).map(([,row])=>row),coverageComplete:false,truncated:raw.truncated===true};
}
function request(raw){
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).some(k=>!["search","gtin","pack","merchant","scopeChannel","limit"].includes(k)))throw Error("invalid-reference-search");
 if(raw.search!==undefined&&typeof raw.search!=="string"||raw.gtin!==undefined&&typeof raw.gtin!=="string"||raw.merchant!==undefined&&(typeof raw.merchant!=="string"||!retailers.includes(raw.merchant.trim())))throw Error("invalid-reference-search");
 const search=text(raw.search),gtin=text(raw.gtin),filters=Products.searchFilters(raw);if(!filters.ok)throw Error(filters.reason);
 if(gtin&&!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)||!gtin&&(search.length<2||search.length>120)||search.length>120)throw Error("invalid-reference-search");
 if(gtin){let sum=0;for(let i=gtin.length-2,w=3;i>=0;i--,w=w===3?1:3)sum+=Number(gtin[i])*w;if((10-sum%10)%10!==Number(gtin.at(-1)))throw Error("invalid-reference-gtin");}
 const merchant=raw.merchant===undefined?null:text(raw.merchant),limit=raw.limit??20;if(merchant&&!retailers.includes(merchant)||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error("invalid-reference-search");
 return{...(search?{search}:{}),...(gtin?{gtin}:{}),...(filters.pack?{pack:filters.pack}:{}),...(merchant?{merchant}:{}),...(filters.scopeChannel?{scopeChannel:filters.scopeChannel}:{}),limit};
}
function create(config={}){
 const apiBase=text(config.apiBase).replace(/\/+$/,""),fetchImpl=config.fetchImpl||root.fetch?.bind(root),now=typeof config.now==="function"?config.now:Date.now;
 async function search(raw,options={}){
  let payload;try{payload=request(raw);}catch(error){return{ok:false,items:[],reason:error.message};}if(typeof fetchImpl!=="function")return{ok:false,items:[],reason:"unavailable"};
  const controller=new AbortController(),signal=options.signal,abort=()=>controller.abort();let timer;if(signal?.aborted)return{ok:false,items:[],reason:"cancelled"};signal?.addEventListener("abort",abort,{once:true});
  try{const result=await Promise.race([Promise.resolve().then(async()=>{const r=await fetchImpl(apiBase+"/v1/berlin-reference-prices?"+new URLSearchParams(payload),{method:"GET",credentials:"omit",signal:controller.signal});if(!r?.ok)throw Error("unavailable");return r.json();}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error("timeout"));},Math.max(1,Math.min(10000,Number(options.timeoutMs??config.timeoutMs)||8000)));})]);
   if(controller.signal.aborted)return{ok:false,items:[],reason:"cancelled"};return normalizeResponse(result,{now:now(),request:payload});
  }catch(_){return{ok:false,items:[],reason:signal?.aborted?"cancelled":"unavailable"};}finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
 }
 return Object.freeze({search});
}
const api=Object.freeze({create,candidate,normalizeResponse,request,retailers});if(root)root.CaddyBerlinReferenceClient=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
