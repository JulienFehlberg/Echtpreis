(function(root){
"use strict";
const DAY=86400000,STATES=new Set(["observed","verified"]),PUBLIC_TYPES=new Set(["regular","promotion"]),CONDITIONAL_TYPES=new Set(["loyalty","app","coupon","multi_buy","personalized"]);
const text=x=>typeof x==="string"?x.trim():"",merchantKey=x=>text(x).toLowerCase(),clone=x=>JSON.parse(JSON.stringify(x));
function number(x){if(typeof x!=="number"&&typeof x!=="string"||x===""||typeof x==="string"&&!x.trim())return null;const n=Number(x);return Number.isFinite(n)?n:null}
function positive(x){const n=number(x);return n!=null&&n>0?n:null}
function day(x){const s=text(x).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const t=Date.parse(s+"T00:00:00Z");return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?s:null}
function localDay(time){const d=new Date(time);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function unknown(merchant,reason){return{merchant:text(merchant),state:"unknown",price:null,payablePrice:null,reason:reason||"no-current-evidence"}}
function ageLimit(ctx){const n=number(ctx.maxAgeDays??7);return n!=null&&n>=0?Math.min(n,30):7}
function packAmount(amount,unit){
 const n=positive(amount),u=text(unit).toLowerCase();if(n==null)return null;
 if(u==="kg")return{amount:n*1000,unit:"g",base:"kg",factor:1000};
 if(u==="g")return{amount:n,unit:"g",base:"kg",factor:1000};
 if(u==="l")return{amount:n*1000,unit:"ml",base:"l",factor:1000};
 if(u==="ml")return{amount:n,unit:"ml",base:"l",factor:1000};
 if(u==="cl")return{amount:n*10,unit:"ml",base:"l",factor:1000};
 if(["piece","stk","stuck","stück"].includes(u))return{amount:n,unit:"piece",base:"piece",factor:1};
 return null;
}
function parsePack(raw){
 if(raw&&typeof raw==="object"&&!Array.isArray(raw)){const p=packAmount(raw.amount,raw.unit);return p&&Number.isFinite(p.amount)?p:null}
 const s=text(raw).toLowerCase().replace(/,/g,"."),multi=s.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l|piece|stk|stuck|stück)\b/);
 if(multi){const count=Number(multi[1]);if(!Number.isSafeInteger(count)||count<1)return null;const p=packAmount(count*Number(multi[2]),multi[3]);return p&&Number.isFinite(p.amount)?p:null}
 const single=s.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l|piece|stk|stuck|stück)\b/);return single?packAmount(single[1],single[2]):null;
}
// Published checkout channels remain separate from physical-store decisions.
function exactPublishedPack(raw){
 const match=text(raw).toLowerCase().match(/^(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l|piece|stk|stuck|stück)$/);
 if(!match)return null;
 const count=Number(match[1]||1),single=packAmount(Number(match[2].replace(",",".")),match[3]);
 return Number.isSafeInteger(count)&&count>0&&single&&Number.isFinite(single.amount*count)?{...single,amount:single.amount*count,count}:null;
}
function isoTime(raw){
 if(typeof raw!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw))return null;
 const value=Date.parse(raw);return Number.isFinite(value)&&new Date(value).toISOString().slice(0,19)===raw.slice(0,19)?value:null;
}
function publishedSource(raw){
 try{
  const url=new URL(raw.sourceUrl);
  if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash||url.search)return null;
  const sources={
   "Wolt EDEKA Berlin":{merchant:"EDEKA",channel:"online",venue:"67ebb70ed3581534a525c522",path:"/de/deu/berlin/venue/edeka-hilbrecht",postalCode:"10969",addresses:["Ritterstr. 38-40","Ritterstraße 38-40"]},
   "Wolt nahkauf Berlin Wrangelstraße":{merchant:"nahkauf",channel:"online",venue:"657acc4eba505a018fb31b05",path:"/de/deu/berlin/venue/nahcity-wrangelstrae",postalCode:"10997",addresses:["Wrangelstraße 75"]},
   "REWE Berlin pickup":{merchant:"REWE",channel:"pickup",market:"8321066",postalCode:"10963",addresses:["Hallesches Ufer 40"]},
   "dm online":{merchant:"dm",channel:"online"}
  },source=sources[raw.sourceId];
  if(!source||raw.merchant!==source.merchant||raw.scopeChannel!==source.channel)return null;
  if(source.venue){if(url.hostname!=="wolt.com"||url.pathname.replace(/\/$/,"")!==source.path||raw.nativeVenueId!==source.venue)return null;}
  else if(source.market){if(url.hostname!=="www.rewe.de"||!/^\/shop\/p\/[a-z0-9-]+\/[1-9]\d{0,11}\/?$/.test(url.pathname)||String(raw.nativeMarketId)!==source.market)return null;}
  else if(!["www.dm.de","dm.de"].includes(url.hostname)||!(new RegExp("^/p/d/"+String(raw.retailerSku).replace(/[^0-9]/g,"!")+"/[^/]+/?$").test(url.pathname)||url.pathname.endsWith("-p"+raw.gtin+".html")))return null;
  return{...source,url:url.href};
 }catch(_){return null;}
}
function normalizePublishedAlternative(raw,query={},ctx={}){
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||raw.state!=="published"||raw.current!==true||raw.scopeCountry!=="DE"||raw.currency!=="EUR"||raw.priceBasis!=="pack")return null;
 if(raw.truthEligible===true||raw.physicalStorePriceVerified===true||raw.storeId!=null||raw.store_id!=null||raw.locationLevel==="store"||raw.shippingIncluded!==false||raw.serviceFeesIncluded===true)return null;
 const source=publishedSource(raw),requested=exactPublishedPack(query.pack),pack=exactPublishedPack(raw.pack),gtin=text(raw.gtin),proofHash=text(raw.proofHash);
 if(!source||!text(raw.name)||!text(raw.retailerSku)||!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)||gtin!==text(query.gtin)||!requested||!pack||requested.unit!==pack.unit||Math.abs(requested.amount-pack.amount)>1e-9||requested.count!==pack.count||!/^[a-f0-9]{64}$/i.test(proofHash))return null;
 let sum=0;for(let i=gtin.length-2,weight=3;i>=0;i--,weight=weight===3?1:3)sum+=Number(gtin[i])*weight;
 if((10-sum%10)%10!==Number(gtin.at(-1)))return null;
 const nativePack=packAmount(raw.packAmount,raw.packUnit),nativeCount=number(raw.packCount);
 if(!nativePack||!Number.isSafeInteger(nativeCount)||nativeCount!==pack.count||nativePack.unit!==pack.unit||Math.abs(nativePack.amount*nativeCount-pack.amount)>1e-9)return null;
 const time=ctx.now===undefined?Date.now():Number(ctx.now),captured=isoTime(raw.capturedAt),expiry=isoTime(raw.expiresAt);
 if(!Number.isFinite(time)||captured===null||expiry===null||captured>time||time-captured>DAY||expiry<=time||expiry>captured+DAY)return null;
 const cents=value=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=10000&&Math.abs(value*100-Math.round(value*100))<.000001?Math.round(value*100):null;
 const goods=cents(raw.price),deposit=raw.deposit==null?null:cents(raw.deposit),displayed=raw.displayedPrice==null?null:cents(raw.displayedPrice),payable=deposit===null||goods===null?null:goods+deposit;
 if(goods===null||goods<=0||raw.deposit!=null&&deposit===null||raw.displayedPrice!=null&&displayed===null)return null;
 if(raw.payablePackPrice!=null&&(payable===null||cents(raw.payablePackPrice)!==payable))return null;
 if(displayed!==null){const included=raw.nativePriceIncludesDeposit;if(typeof included!=="boolean"||displayed!==goods+(included&&deposit!==null?deposit:0))return null;}
 let shop=null;
 if(source.venue||source.market){
  const input=raw.shop;
  const addressKey=value=>text(value).normalize("NFKC").toLowerCase().replace(/ß/g,"ss").replace(/[^a-z0-9]/g,"");
  if(!input||typeof input!=="object"||Array.isArray(input)||input.country!=="DE"||input.city!=="Berlin"||text(input.postalCode)!==source.postalCode||!text(input.name)||!source.addresses.some(value=>addressKey(value)===addressKey(input.address))||source.venue&&input.nativeVenueId!==source.venue||source.market&&String(input.nativeMarketId)!==source.market)return null;
  shop={name:text(input.name),address:text(input.address),postalCode:text(input.postalCode),city:text(input.city),country:"DE",nativeVenueId:source.venue||null,nativeMarketId:source.market||null};
 }
 return{sourceId:raw.sourceId,merchant:source.merchant,retailerSku:text(raw.retailerSku),nativeVenueId:source.venue||null,nativeMarketId:source.market||null,name:text(raw.name),brand:text(raw.brand)||null,gtin,pack:text(raw.pack),packAmount:nativePack.amount,packUnit:nativePack.unit,packCount:nativeCount,price:goods/100,deposit:deposit===null?null:deposit/100,displayedPrice:displayed===null?null:displayed/100,nativePriceIncludesDeposit:displayed===null?null:raw.nativePriceIncludesDeposit,payablePackPrice:payable===null?null:payable/100,currency:"EUR",priceBasis:"pack",capturedAt:new Date(captured).toISOString(),expiresAt:new Date(expiry).toISOString(),sourceUrl:source.url,proofHash,shop,scopeCountry:"DE",scopeChannel:source.channel,state:"published",current:true,truthEligible:false,physicalStorePriceVerified:false,shippingIncluded:false,serviceFeesIncluded:false,availability:["available","unavailable","unknown"].includes(raw.availability)?raw.availability:"unknown",priceType:text(raw.priceType)||"unknown",promotionStatus:text(raw.promotionStatus)||"unknown"};
}
function publishedAlternatives(raw,query,ctx){
 const rows=new Map(),conflicts=new Set();
 for(const input of Array.isArray(raw)?raw.slice(0,20):[]){
  const value=normalizePublishedAlternative(input,query,ctx);if(!value)continue;
  const key=JSON.stringify([value.sourceId,value.nativeVenueId,value.nativeMarketId,value.retailerSku]),previous=rows.get(key);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(value))conflicts.add(key);else rows.set(key,value);
 }
 return[...rows].filter(([key])=>!conflicts.has(key)).map(([,value])=>value);
}
function currentResponse(value,time){return{...clone(value),results:(value.results||[]).map(row=>row.sourceEligibility?.sourceExpiresAt!=null&&!(isoTime(row.sourceEligibility.sourceExpiresAt)>time)?unknown(row.merchant,"source-price-expired"):clone(row)),publishedAlternatives:(value.publishedAlternatives||[]).filter(row=>Date.parse(row.expiresAt)>time&&Date.parse(row.capturedAt)<=time&&time-Date.parse(row.capturedAt)<=DAY).map(clone)};}
function conditionalEligible(raw,ctx,type){
 if(PUBLIC_TYPES.has(type))return true;
 if(!CONDITIONAL_TYPES.has(type))return false;
 if(type==="multi_buy"){const need=number(raw.minQuantity??raw.quantityRequired),quantity=number(ctx.quantity??1);return Number.isSafeInteger(need)&&need>=2&&Number.isSafeInteger(quantity)&&quantity>=need}
 return !!ctx.eligibility&&ctx.eligibility[type]===true;
}
function checkoutContext(raw,price){
 if(raw.sourceId!=="HIT Berlin store assortment"&&raw.source!=="HIT Berlin store assortment")return raw.checkoutPriceVerified===false?{checkoutPriceVerified:false,payablePackPrice:null}:{};
 const meta=raw.sourceEligibility,goods=Math.round(price*100),deposit=meta?.depositCents;
 const pack=exactPublishedPack(raw.pack),single=pack?.count===1&&(pack.unit!=="piece"||pack.amount===1);
 const verified=meta?.scopeChannel==="physical-store"&&meta?.nativeStoreId===1775&&meta?.nativeStoreNumber==="258"&&meta?.goodsPriceCents===goods&&meta?.priceIncludesDeposit===false&&meta?.checkoutPriceVerified===true&&Number.isSafeInteger(deposit)&&deposit>=0&&(deposit===0||single);
 return{goodsPrice:price,nativeDeposit:Number.isSafeInteger(deposit)&&deposit>=0?deposit/100:null,deposit:verified?deposit/100:null,priceIncludesDeposit:false,checkoutPriceVerified:verified,payablePackPrice:verified?(goods+deposit)/100:null};
}
function normalizeDecision(raw,ctx={}){
 const merchant=text(raw&&raw.merchant)||text(ctx.merchant),reject=reason=>unknown(merchant,reason);
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||!STATES.has(raw.state))return reject(text(raw&&raw.reason)||"no-current-evidence");
 if(raw.conflict||raw.truth&&["conflict","unknown"].includes(raw.truth.state)||Number(raw.conflictCount)>0)return reject("conflicting-current-evidence");
 const price=positive(raw.price),payable=positive(raw.payablePrice??raw.price),today=day(ctx.today)||localDay(Date.now()),observed=day(raw.observedAt);
 if(price==null||payable==null||raw.currency!=="EUR"||Math.abs(price-payable)>Math.max(.000001,price*.000001))return reject("invalid-price");
 if(!observed)return reject("invalid-observation-date");
 const age=(Date.parse(today+"T00:00:00Z")-Date.parse(observed+"T00:00:00Z"))/DAY;
 if(age<0||age>ageLimit(ctx))return reject("no-current-evidence");
 const from=raw.validFrom?day(raw.validFrom):null,to=raw.validTo?day(raw.validTo):null;
 if(raw.validFrom&&!from||raw.validTo&&!to||from&&to&&from>to||from&&today<from||to&&today>to)return reject("inactive-price");
 const type=raw.priceType??"regular";
 if(!conditionalEligible(raw,ctx,type)||raw.conditional===true&&!CONDITIONAL_TYPES.has(type))return reject("ineligible-price");
 if(raw.truthEligible===false||raw.sourceHealthState==="quarantine")return reject("no-current-evidence");
 if(raw.sourceId==="HIT Berlin store assortment"||raw.source==="HIT Berlin store assortment"){const expiry=isoTime(raw.sourceEligibility?.sourceExpiresAt),captured=isoTime(raw.observedAt),time=ctx.now===undefined?Date.now():Number(ctx.now);if(expiry===null||captured===null||expiry!==captured+DAY||captured>time||!Number.isFinite(time)||expiry<=time)return reject("source-price-expired");}
 const storeId=text(raw.storeId),region=text(raw.region),locationLevel=text(raw.locationLevel);
 if(ctx.storeId&&storeId&&storeId!==text(ctx.storeId))return reject("different-store");
 if(ctx.storeId&&!storeId&&locationLevel!=="regional-fallback")return reject("location-unknown");
 if(ctx.region&&region&&region.toLowerCase()!==text(ctx.region).toLowerCase())return reject("different-region");
 if(ctx.storeId&&!storeId&&(!region||region.toLowerCase()!==text(ctx.region).toLowerCase()))return reject("location-unknown");
 const gtin=text(raw.gtin),query=ctx.query||{};
 if(query.productId&&text(raw.productId)!==text(query.productId))return reject("different-product");
 if(query.gtin&&gtin!==text(query.gtin))return reject("different-product");
 const parsed=parsePack(raw.packParsed)||parsePack(raw.pack)||parsePack(raw.product),unit=["kg","l","piece"].includes(raw.unit)?raw.unit:null,unitPrice=unit?positive(raw.unitPrice):null,confidence=number(raw.confidence??raw.confidenceScore);
 const truth=raw.truth&&typeof raw.truth==="object"?{state:text(raw.truth.state)||null,independentEvidence:Math.max(0,number(raw.truth.independentEvidence)||0),verifiedEvidence:Math.max(0,number(raw.truth.verifiedEvidence)||0),sourceTypes:Array.isArray(raw.truth.sourceTypes)?raw.truth.sourceTypes.filter(x=>typeof x==="string"):Math.max(0,number(raw.truth.sourceTypes)||0),strength:positive(raw.truth.strength)}:null;
 const firstParty=["receipt","shelf"].includes(raw.sourceType)||["receipt","shelf"].includes(raw.kind),verifiedFirstParty=raw.status==="verified"&&raw.identityVerified===true&&raw.proofVerified===true;
 const state=raw.state==="verified"&&firstParty&&!verifiedFirstParty?"observed":raw.state;
 return{
  merchant,state,kind:text(raw.kind)||null,status:text(raw.status)||null,identityVerified:raw.identityVerified===true,proofVerified:raw.proofVerified===true,truthEligible:raw.truthEligible!==false,sourceEligibility:raw.sourceEligibility&&typeof raw.sourceEligibility==="object"&&!Array.isArray(raw.sourceEligibility)?clone(raw.sourceEligibility):null,price,payablePrice:payable,...checkoutContext(raw,price),currency:"EUR",priceType:type,conditional:CONDITIONAL_TYPES.has(type),minQuantity:number(raw.minQuantity??raw.quantityRequired),
  publicReferencePrice:positive(raw.publicReferencePrice),regularPrice:positive(raw.regularPrice),priceBasis:text(raw.priceBasis)||null,product:text(raw.product),productId:text(raw.productId)||null,externalProductId:text(raw.externalProductId)||null,brand:text(raw.brand)||null,pack:text(raw.pack)||null,gtin:gtin||null,
  storeId:storeId||null,region:region||null,locationLevel:locationLevel||null,scopeWarning:text(raw.scopeWarning)||null,comparisonOnly:raw.comparisonOnly===true,match:text(raw.match)||null,queryMode:text(raw.queryMode)||null,
  observedAt:text(raw.observedAt),date:observed,validFrom:from,validTo:to,source:text(raw.source)||null,sourceType:text(raw.sourceType)||null,sourceId:text(raw.sourceId)||null,sourceUrl:text(raw.sourceUrl)||null,
  proof:text(raw.proof)||null,proofHash:text(raw.proofHash)||null,mediaHash:text(raw.mediaHash)||null,contentHash:text(raw.contentHash)||null,proofActor:text(raw.proofActor)||null,proofType:text(raw.proofType)||null,
  truthTier:number(raw.truthTier),priceAuthority:text(raw.priceAuthority)||null,truth,confidence:confidence==null?0:Math.max(0,Math.min(100,confidence)),
  unitPrice,unit:unitPrice==null?null:unit,packParsed:parsed,per:["kg","l","piece"].includes(raw.per)?raw.per:"piece",eligibility:raw.eligibility&&typeof raw.eligibility==="object"?{ok:raw.eligibility.ok===true,reason:text(raw.eligibility.reason)}:null
 };
}
function normalizeResponse(raw,query,ctx={}){
 const merchants=query.merchants||[],today=day(ctx.today)||localDay(Date.now()),fallback=reason=>({ok:false,product:query.product,today,results:merchants.map(m=>unknown(m,reason)),publishedAlternatives:[],reason});
 if(!raw||raw.ok!==true||!Array.isArray(raw.results))return fallback("invalid-response");
 if(raw.today&&day(raw.today)!==today)return fallback("invalid-response");
 const rows=new Map(),duplicates=new Set();
 for(const row of raw.results){const key=merchantKey(row&&row.merchant);if(!key)continue;if(rows.has(key))duplicates.add(key);rows.set(key,row)}
 return{ok:true,product:query.product,today,publishedAlternatives:publishedAlternatives(raw.publishedAlternatives,query,ctx),results:merchants.map(merchant=>{
  const key=merchantKey(merchant);if(duplicates.has(key))return unknown(merchant,"ambiguous-response");
  const value=normalizeDecision(rows.get(key),{...ctx,today,merchant,query,storeId:mappedValue(ctx.storeIds,merchant)||ctx.storeId,region:mappedValue(ctx.regions,merchant)||ctx.region});value.merchant=merchant;return value;
 })};
}
function toComparablePrice(decision,targetPer,requestedPack){
 if(!decision||!STATES.has(decision.state)||decision.currency!=="EUR")return null;
 if(decision.checkoutPriceVerified===false||decision.sourceEligibility?.checkoutPriceVerified===false)return null;
 if((decision.sourceId==="HIT Berlin store assortment"||decision.source==="HIT Berlin store assortment")&&checkoutContext(decision,positive(decision.price)).checkoutPriceVerified!==true)return null;
 const payable=positive(decision.payablePackPrice??decision.payablePrice??decision.price);if(payable==null||!["kg","l","piece"].includes(targetPer))return null;
 let price=payable,factor=1;
 if(targetPer==="piece"){
  const parsed=parsePack(decision.packParsed)||parsePack(decision.pack)||parsePack(decision.product);
  if(decision.unit==="piece"&&positive(decision.unitPrice)!=null&&payable===positive(decision.price)){price=Number(decision.unitPrice);factor=price/payable}
  else if(parsed&&parsed.base==="piece"){factor=1/parsed.amount;price=payable*factor}
 }
 if(targetPer!=="piece"){
  const parsed=parsePack(decision.packParsed)||parsePack(decision.pack)||parsePack(decision.product)||(decision.queryMode==="sku"?parsePack(requestedPack):null);
  if(decision.unit===targetPer&&positive(decision.unitPrice)!=null&&payable===positive(decision.price)){price=Number(decision.unitPrice);factor=price/payable}
  else if(parsed&&parsed.base===targetPer){factor=parsed.factor/parsed.amount;price=payable*factor}
  else if(decision.per!==targetPer)return null;
 }
 if(!Number.isFinite(price)||price<=0||!Number.isFinite(factor)||factor<=0)return null;
 return{...decision,price,per:targetPer,payablePrice:payable,publicReferencePrice:positive(decision.publicReferencePrice)==null?null:Number(decision.publicReferencePrice)*factor,regularPrice:positive(decision.regularPrice)==null?null:Number(decision.regularPrice)*factor};
}
function mappedValue(map,merchant){if(!map||typeof map!=="object"||Array.isArray(map))return"";const key=merchantKey(merchant),entry=Object.keys(map).find(x=>merchantKey(x)===key);return entry==null?"":text(map[entry])}
function requestQuery(query,ctx,today){
 const product=text(query&&query.product),merchants=[],seen=new Set();
 for(const raw of query&&Array.isArray(query.merchants)?query.merchants:Array.isArray(ctx.merchants)?ctx.merchants:[]){const merchant=text(raw),key=merchantKey(merchant);if(merchant&&!seen.has(key)){merchants.push(merchant);seen.add(key)}}
 const quantity=number(ctx.quantity??query.quantity??1),eligibility={},storeIds={},regions={};
 for(const merchant of merchants){const store=mappedValue(ctx.storeIds,merchant),region=mappedValue(ctx.regions,merchant);if(store)storeIds[merchant]=store;if(region)regions[merchant]=region}
 for(const type of ["loyalty","app","coupon","personalized"])eligibility[type]=!!ctx.eligibility&&ctx.eligibility[type]===true;
 return{product,brand:text(query&&query.brand)||null,pack:text(query&&query.pack)||null,gtin:text(query&&query.gtin)||null,productId:text(query&&query.productId)||null,merchants,storeId:text(ctx.storeId||query&&query.storeId)||null,region:text(ctx.region||query&&query.region)||null,storeIds,regions,today,maxAgeDays:ageLimit(ctx),eligibility,quantity,...(ctx.refresh===true?{refresh:true}:{})};
}
function create(options={}){
 const ttl=number(options.ttlMs??60000),ttlMs=ttl!=null&&ttl>=0?Math.min(ttl,60000):60000,count=number(options.maxEntries??128),maxEntries=Number.isSafeInteger(count)&&count>=1?Math.min(count,1024):128;
 const cache=new Map(),pending=new Map(),fetchIds=new WeakMap();let nextFetchId=1,generation=0;const now=typeof options.now==="function"?options.now:Date.now;
 const defaultFetch=options.fetchImpl||(root&&typeof root.fetch==="function"?root.fetch.bind(root):null);
 function expired(time){for(const [key,value]of cache)if(value.until<=time)cache.delete(key)}
 function failure(payload,reason){return{ok:false,product:payload.product,today:payload.today,results:payload.merchants.map(m=>unknown(m,reason)),publishedAlternatives:[],reason}}
 async function compare(query,ctx={}){
  const time=now(),today=day(ctx.today)||localDay(time),payload=requestQuery(query,ctx,today);
  if(ctx.today&&!day(ctx.today)||!(payload.product||payload.gtin||payload.productId)||!payload.merchants.length||!Number.isSafeInteger(payload.quantity)||payload.quantity<1||payload.gtin&&!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(payload.gtin))return failure(payload,"invalid-query");
  const apiBase=text(ctx.apiBase??options.apiBase).replace(/\/+$/,""),fetchImpl=ctx.fetchImpl||defaultFetch;
  if(typeof fetchImpl!=="function")return failure(payload,"unavailable");
  if(!fetchIds.has(fetchImpl))fetchIds.set(fetchImpl,nextFetchId++);
  const key=JSON.stringify([apiBase,fetchIds.get(fetchImpl),payload]);expired(time);
  if(cache.has(key)){const saved=cache.get(key);cache.delete(key);cache.set(key,saved);return currentResponse(saved.value,time)}
  if(pending.has(key))return currentResponse(await pending.get(key),now());
  if(pending.size>=maxEntries)return failure(payload,"unavailable");
  const configured=number(ctx.timeoutMs??options.timeoutMs??8000),timeoutMs=configured!=null&&configured>0?Math.min(configured,60000):8000;
  const requestGeneration=generation,task=(async()=>{
   const Controller=root&&root.AbortController||typeof AbortController!=="undefined"&&AbortController,controller=Controller?new Controller():null;let timer;
   try{
    const response=await Promise.race([
     Promise.resolve().then(async()=>{const res=await fetchImpl(apiBase+"/v1/current-prices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:controller?controller.signal:undefined});if(!res||res.ok!==true)throw new Error("unavailable");return res.json()}),
     new Promise((_,reject)=>{timer=setTimeout(()=>{if(controller)controller.abort();reject(new Error("unavailable"))},timeoutMs)})
    ]);
    const value=normalizeResponse(response,payload,{...payload,now:now()});
    if(value.ok&&ttlMs>0&&requestGeneration===generation){cache.set(key,{until:now()+ttlMs,value:clone(value)});while(cache.size>maxEntries)cache.delete(cache.keys().next().value)}
    return value;
   }catch(_){return failure(payload,"unavailable")}
   finally{clearTimeout(timer)}
  })();
  pending.set(key,task);
  try{return currentResponse(await task,now())}finally{pending.delete(key)}
 }
 return Object.freeze({compare,clearCache(){generation++;cache.clear()},cacheInfo(){expired(now());return{entries:cache.size,inflight:pending.size,ttlMs,maxEntries}}});
}
const api=Object.freeze({create,normalizeDecision,normalizeResponse,normalizePublishedAlternative,toComparablePrice,parsePack});
if(root)root.SparkorbCurrentPriceClient=api;
if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
