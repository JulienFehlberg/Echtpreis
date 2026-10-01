(function(root){
"use strict";
const Current=typeof module==="object"&&module.exports?require("./current-price-client"):root.SparkorbCurrentPriceClient;
const text=value=>typeof value==="string"?value.trim():"";
const DAY=86400000,HIT="HIT Berlin store assortment",UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isoTime(value){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return null;const time=Date.parse(value);return Number.isFinite(time)&&new Date(time).toISOString().slice(0,19)===value.slice(0,19)?time:null;}
function berlinDay(time){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(time),values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return values.year+"-"+values.month+"-"+values.day;}
function physicalBranch(raw,storeId){
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||!UUID.test(text(storeId))||raw.id!==storeId||raw.storeId!=null&&raw.storeId!==storeId||raw.merchant!=="HIT"||raw.country!=="DE"||raw.city!=="Berlin"||raw.region!=="Berlin"||raw.address!=="Anton-Wilhelm-Amo-Str. 69"||raw.postalCode!=="10117"||typeof raw.latitude!=="number"||typeof raw.longitude!=="number"||!Number.isFinite(raw.latitude)||!Number.isFinite(raw.longitude)||Math.abs(raw.latitude-52.5118284)>1e-7||Math.abs(raw.longitude-13.3841334)>1e-7||raw.active===false||raw.merchantActive===false)return null;
 if(raw.nativeStoreId!=null&&raw.nativeStoreId!==1775||raw.nativeStoreNumber!=null&&raw.nativeStoreNumber!=="258")return null;
 return{id:storeId,storeId,merchant:"HIT",name:"Berlin-Mitte",address:raw.address,postalCode:raw.postalCode,city:"Berlin",region:"Berlin",country:"DE",latitude:raw.latitude,longitude:raw.longitude,nativeStoreId:1775,nativeStoreNumber:"258"};
}
function amount(value,unit){
 if(typeof value!=="number"||!Number.isFinite(value)||value<=0)return null;
 const units={g:["g",1],kg:["g",1000],ml:["ml",1],cl:["ml",10],l:["ml",1000],piece:["piece",1],pieces:["piece",1],"stück":["piece",1],stuck:["piece",1],stk:["piece",1],st:["piece",1]},entry=units[text(unit).toLowerCase()];
 return entry&&Number.isFinite(value*entry[1])?{amount:value*entry[1],unit:entry[0]}:null;
}
function pack(raw){
 const match=text(raw).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").match(/^(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l|pieces?|stk|stuck|st)$/);if(!match)return null;
 const count=Number(match[1]||1),single=amount(Number(match[2].replace(",",".")),match[3]);
 return Number.isSafeInteger(count)&&count>0&&count<=1000&&single?{...single,count}:null;
}
function selection(raw){
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
 const gtin=text(raw.gtin),name=text(raw.name),brand=raw.brand==null?null:text(raw.brand),description=text(raw.pack),parsed=pack(description),native=amount(raw.packAmount,raw.packUnit);
 if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)||!name||name.length>200||brand!==null&&brand.length>120||description.length>80||!parsed||!native||!Number.isSafeInteger(raw.packCount)||raw.packCount!==parsed.count||native.unit!==parsed.unit||Math.abs(native.amount-parsed.amount)>1e-9)return null;
 let sum=0;for(let i=gtin.length-2,weight=3;i>=0;i--,weight=weight===3?1:3)sum+=Number(gtin[i])*weight;
 if((10-sum%10)%10!==Number(gtin.at(-1)))return null;
 return{gtin,name,brand:brand||null,pack:description,packAmount:parsed.amount,packUnit:parsed.unit,packCount:parsed.count};
}
function key(raw){const valid=selection(raw);return valid?JSON.stringify([valid.gtin,valid.packUnit,valid.packAmount,valid.packCount]):null;}
function searchFilters(options={}){
 const rawPack=options.pack,rawChannel=options.scopeChannel;
 if(rawPack!=null&&typeof rawPack!=="string")return{ok:false,reason:"invalid-pack-filter"};
 const description=text(rawPack);if(description.length>80||description&&!pack(description))return{ok:false,reason:"invalid-pack-filter"};
 if(rawChannel!=null&&typeof rawChannel!=="string")return{ok:false,reason:"invalid-scope-channel-filter"};
 const scopeChannel=text(rawChannel);if(scopeChannel&&!['physical-store','online','pickup'].includes(scopeChannel))return{ok:false,reason:"invalid-scope-channel-filter"};
 return{ok:true,pack:description||null,parsedPack:description?pack(description):null,scopeChannel:scopeChannel||null};
}
function storeSelection(raw){return raw&&raw.merchant==="HIT"&&UUID.test(text(raw.storeId))?{merchant:"HIT",storeId:raw.storeId.toLowerCase()}:null;}
function physicalDecision(raw,query={},branch=raw?.branch,options={}){
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||!Current||raw.sourceId!==HIT||raw.source!==HIT||raw.merchant!=="HIT"||raw.sourceType!=="official_retailer"||raw.truthEligible!==true||raw.identityVerified!==true||raw.comparisonOnly===true||raw.locationLevel!=="store"||raw.region!=="Berlin"||raw.priceBasis!=="pack"||raw.per!=="piece"||raw.priceType!=="regular"||raw.conditional===true||!["observed","verified"].includes(raw.status)||!UUID.test(text(raw.productId)))return null;
 const store=physicalBranch(branch,raw.storeId),parsed=pack(raw.pack),requested=pack(query.pack),identity=selection({gtin:raw.gtin,name:raw.product||raw.name,brand:raw.brand,pack:raw.pack,packAmount:parsed?.amount,packUnit:parsed?.unit,packCount:parsed?.count});
 if(!store||!identity||identity.gtin!==query.gtin||!requested||requested.unit!==parsed.unit||requested.count!==parsed.count||Math.abs(requested.amount-parsed.amount)>1e-9||!/^[a-f0-9]{64}$/i.test(text(raw.proofHash)))return null;
 const sku=text(raw.externalProductId).match(/^hit:store:1775:sku:([0-9]+ST)$/);if(!sku||raw.retailerSku!=null&&raw.retailerSku!==sku[1]||raw.nativeSku!=null&&raw.nativeSku!==sku[1])return null;
 let source;try{source=new URL(raw.sourceUrl);if(source.protocol!=="https:"||source.hostname!=="www.hit.de"||source.username||source.password||source.port||source.hash||!new RegExp("^/sortiment/(?:[a-z0-9-]+/)*[a-z0-9-]+-"+sku[1]+"$").test(source.pathname)||source.searchParams.get("markt")!=="258"||[...source.searchParams.keys()].some(name=>name!=="markt"))return null;}catch(_){return null;}
 const now=options.now===undefined?Date.now():Number(options.now),captured=isoTime(raw.observedAt),expiry=isoTime(raw.sourceEligibility?.sourceExpiresAt),meta=raw.sourceEligibility;
 if(!Number.isFinite(now)||captured===null||expiry===null||captured>now||expiry!==captured+DAY||expiry<=now||raw.validFrom!==berlinDay(captured)||raw.validTo!==berlinDay(expiry-1)||berlinDay(now)<raw.validFrom||berlinDay(now)>raw.validTo||meta?.scopeChannel!=="physical-store"||meta?.sourceScope!=="physical-store"||meta?.nativeStoreId!==1775||meta?.nativeStoreNumber!=="258"||meta?.priceIncludesDeposit!==false)return null;
 const cents=raw.price*100;if(typeof raw.price!=="number"||!Number.isFinite(cents)||cents<=0||Math.abs(cents-Math.round(cents))>1e-6||meta.goodsPriceCents!==Math.round(cents)||raw.goodsPrice!==raw.price||raw.payablePrice!==raw.price||meta.depositCents!==null&&(!Number.isSafeInteger(meta.depositCents)||meta.depositCents<0))return null;
 const checkout=meta.depositCents!==null&&(meta.depositCents===0||parsed.count===1&&(parsed.unit!=="piece"||parsed.amount===1));if(meta.checkoutPriceVerified!==checkout)return null;
 const decision=Current.normalizeDecision(raw,{query:{gtin:query.gtin,pack:query.pack},storeId:store.id,region:"Berlin",today:berlinDay(now),now});
 if(!["observed","verified"].includes(decision.state)||decision.price!==raw.price||raw.checkoutPriceVerified!==decision.checkoutPriceVerified||raw.payablePackPrice!==decision.payablePackPrice)return null;
 return{...decision,name:raw.name||raw.product,branch:store,externalProductId:raw.externalProductId,retailerSku:sku[1],nativeSku:sku[1],packAmount:parsed.amount,packUnit:parsed.unit,packCount:parsed.count,capturedAt:new Date(captured).toISOString(),expiresAt:new Date(expiry).toISOString(),scopeCountry:"DE",scopeChannel:"physical-store"};
}
function physicalOffer(raw,query={},options={}){
 if(!raw||raw.scopeCountry!=="DE"||raw.scopeChannel!=="physical-store"||raw.branch?.nativeStoreId!==1775||raw.branch?.nativeStoreNumber!=="258"||isoTime(raw.capturedAt)!==isoTime(raw.observedAt)||isoTime(raw.expiresAt)!==isoTime(raw.sourceEligibility?.sourceExpiresAt))return null;
 const captured=isoTime(raw.capturedAt),responseDate=isoTime(raw.sourceResponseDate),native=amount(raw.packAmount,raw.packUnit),parsed=pack(raw.pack),age=raw.sourceAgeSeconds;
 if(captured===null||responseDate===null||Math.abs(captured-responseDate)>300000||responseDate>(options.now===undefined?Date.now():Number(options.now))||age!==null&&(!Number.isSafeInteger(age)||age<0||age>300)||!/^[a-f0-9]{64}$/i.test(text(raw.sourceResponseHash))||!parsed||!native||parsed.count!==raw.packCount||parsed.unit!==native.unit||Math.abs(parsed.amount-native.amount)>1e-9)return null;
 const value=physicalDecision(raw,query,raw.branch,options);return value?{...value,sourceResponseDate:raw.sourceResponseDate,sourceAgeSeconds:raw.sourceAgeSeconds,sourceResponseHash:raw.sourceResponseHash}:null;
}
function candidate(raw,options={}){
 const filters=searchFilters(options),identity=selection(raw);if(!filters.ok||!identity||!Current||!Array.isArray(raw.offers)||raw.offers.length>200||raw.physicalOffers!=null&&!Array.isArray(raw.physicalOffers)||(raw.physicalOffers?.length||0)+raw.offers.length>200)return null;
 if(filters.parsedPack&&(filters.parsedPack.unit!==identity.packUnit||filters.parsedPack.count!==identity.packCount||Math.abs(filters.parsedPack.amount-identity.packAmount)>1e-9))return null;
 const allowed=offer=>offer&&(!filters.scopeChannel||offer.scopeChannel===filters.scopeChannel);
 const offers=raw.offers.map(offer=>Current.normalizePublishedAlternative(offer,{gtin:identity.gtin,pack:identity.pack},options)).filter(allowed);
 const physicalOffers=(raw.physicalOffers||[]).map(offer=>physicalOffer(offer,{gtin:identity.gtin,pack:identity.pack},options)).filter(allowed);
 return offers.length||physicalOffers.length?{...identity,offers,physicalOffers}:null;
}
function normalizeResponse(raw,options={}){
 const filters=searchFilters(options);if(!filters.ok)return{ok:false,items:[],reason:filters.reason};
 if(!raw||raw.ok!==true||!Array.isArray(raw.items)||raw.items.length>20||raw.items.reduce((sum,item)=>sum+(Array.isArray(item?.offers)?item.offers.length:0)+(Array.isArray(item?.physicalOffers)?item.physicalOffers.length:0),0)>200)return{ok:false,items:[],reason:"invalid-response"};
 const rows=new Map(),duplicates=new Set();for(const input of raw.items){const value=candidate(input,options);if(!value)continue;const id=key(value);if(rows.has(id))duplicates.add(id);rows.set(id,value);}
 return{ok:true,items:[...rows].filter(([id])=>!duplicates.has(id)).map(([,value])=>value),discoveryTruncated:raw.discoveryTruncated===true,appliedFilters:{pack:filters.pack,scopeChannel:filters.scopeChannel}};
}
function create(options={}){
 const apiBase=text(options.apiBase).replace(/\/+$/,""),fetchImpl=options.fetchImpl||root.fetch?.bind(root),now=typeof options.now==="function"?options.now:Date.now;
 async function search(raw,options={}){
  const object=raw&&typeof raw==="object"&&!Array.isArray(raw),query=text(object?raw.search:raw),signal=options.signal,filters=searchFilters({pack:options.pack===undefined&&object?raw.pack:options.pack,scopeChannel:options.scopeChannel===undefined&&object?raw.scopeChannel:options.scopeChannel});
  if(query.length<2||query.length>120||typeof fetchImpl!=="function")return{ok:false,items:[],reason:"invalid-search"};
  if(!filters.ok)return{ok:false,items:[],reason:filters.reason};
  const controller=new AbortController(),abort=()=>controller.abort(),timeout=Number(options.timeoutMs)||8000;let timer;
  if(signal?.aborted)return{ok:false,items:[],reason:"cancelled"};signal?.addEventListener("abort",abort,{once:true});
  try{
   const result=await Promise.race([
    Promise.resolve().then(async()=>{const response=await fetchImpl(apiBase+"/v1/published-products?search="+encodeURIComponent(query)+"&limit=20"+(filters.pack?"&pack="+encodeURIComponent(filters.pack):"")+(filters.scopeChannel?"&scopeChannel="+encodeURIComponent(filters.scopeChannel):""),{method:"GET",credentials:"omit",signal:controller.signal});if(!response?.ok)throw Error("unavailable");return response.json();}),
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error("timeout"));},Math.max(1,Math.min(10000,timeout)));})
   ]);
   if(controller.signal.aborted)return{ok:false,items:[],reason:"cancelled"};
   return normalizeResponse(result,{now:now(),pack:filters.pack,scopeChannel:filters.scopeChannel});
  }catch(_){return{ok:false,items:[],reason:controller.signal.aborted?"cancelled":"unavailable"};}
  finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
 }
 return Object.freeze({search});
}
const api=Object.freeze({create,selection,key,candidate,normalizeResponse,searchFilters,physicalBranch,physicalDecision,physicalOffer,storeSelection,berlinDay});
if(root)root.SparkorbPublishedProductClient=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
