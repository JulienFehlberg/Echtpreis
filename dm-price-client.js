"use strict";

const crypto=require("node:crypto"),Inventory=require("./canonical-inventory-import"),Identity=require("./product-identity");
const SOURCE="dm online",PRODUCT_ORIGIN="https://products.dm.de",SEARCH_ORIGIN="https://product-search.services.dmtech.com",WEB_ORIGIN="https://www.dm.de";
// These public routes and the native batch limit are used by dm.de's own
// product-dm.min.js; /scripts/head.js publishes both public service origins.
const DEFAULT_QUERIES=Object.freeze(["haferdrink","sojadrink","mandeldrink","reis","nudeln","mehl","haferflocken","müsli","knäckebrot","brot","tomaten","linsen","bohnen","kichererbsen","olivenöl","sonnenblumenöl","kaffee","tee","saft","gewürze","salz","zucker","honig","marmelade","nussmus","nüsse","schokolade","kekse","babybrei","zahnpasta","duschgel","shampoo","seife","deodorant","toilettenpapier","küchenrolle","waschmittel","spülmittel","reiniger","batterien"]);
const hash=value=>crypto.createHash("sha256").update(value).digest("hex"),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function failure(code,extra={}){return Object.assign(new Error(code),{code,...extra})}
function text(value,max=240){return typeof value==="string"?value.trim().slice(0,max):""}
function sku(value){const s=String(value??"");return /^\d{1,10}$/.test(s)&&Number.isSafeInteger(Number(s))&&Number(s)>0?String(Number(s)):null}
function gtin(value){const s=String(value??"");return /^\d{8,14}$/.test(s)&&Identity.gtinValid(s)?s:null}
function integer(value,defaultValue,max){return Number.isSafeInteger(value)&&value>0?Math.min(value,max):defaultValue}
function publicUrl(value,dan){try{const u=new URL(value,WEB_ORIGIN);if(u.origin!==WEB_ORIGIN||u.username||u.password||u.search||u.hash||!new RegExp("^/p/d/"+dan+"/[a-z0-9-]+/?$").test(u.pathname))return null;return u.href.replace(/\/$/,"")}catch{return null}}
function allowedApiUrl(value){const u=new URL(value);if(u.username||u.password||u.hash)throw failure("dm-source-url-not-allowed");
 const product=u.origin===PRODUCT_ORIGIN&&!u.search&&(/^\/product\/products\/detail\/de\/dan\/\d{1,10}$/.test(u.pathname)||/^\/product\/products\/tiles\/de\/dans\/\d{1,10}(?:,\d{1,10}){0,99}$/.test(u.pathname)||/^\/availability\/api\/v2\/tiles\/de\/\d{1,10}(?:,\d{1,10}){0,99}$/.test(u.pathname));
 const search=u.origin===SEARCH_ORIGIN&&["/de/search/static","/de/search/crawl"].includes(u.pathname)&&[...u.searchParams.keys()].every(key=>["query","pageSize","currentPage","sort"].includes(key))&&(!u.searchParams.has("sort")||u.searchParams.get("sort")==="editorial_relevance");if(!product&&!search)throw failure("dm-source-url-not-allowed");return u.href;
}
function euro(value){const s=text(value).replace(/\u00a0|\u202f/g," ");const m=s.match(/^(\d{1,6}(?:[.,]\d{2})?)\s*€$/);return m?Number(m[1].replace(",",".")):null}
function parsedPack(value){const normalized=text(value,400).replace(/(\d)\.(\d{3})(?=\s*(?:g|ml)\b)/g,"$1$2").replace(/\b(\d+)\s*St\.?\b/gi,"$1 piece");return Inventory.productPack({quantity:normalized}).parsed}
function compatiblePack(a,b){return a&&b&&a.total.unit===b.total.unit&&Math.abs(a.total.amount-b.total.amount)<=Math.max(.0001,a.total.amount*.000001)}
function availability(raw){if(!raw||typeof raw!=="object")return"unknown";if(raw.isPurchasable===false)return"unavailable";const first=raw.rows?.[0];return raw.isPurchasable===true&&first?.icon==="GREEN"&&/^(?:Lieferbar|Online lieferbar|Online verfügbar)$/i.test(text(first.text))?"available":"unknown"}
function timestamp(value){const n=Date.parse(value);return Number.isFinite(n)?new Date(n).toISOString():null}
function parseProduct(raw={},meta={}){
 const reasons=[],dan=sku(raw.dan),expected=sku(meta.retailerSku),code=gtin(raw.gtin),name=text(raw.title?.headline||raw.title?.tileHeadline),brand=text(raw.brand?.name,120)||null;
 if(!dan||expected&&dan!==expected)reasons.push("dm-retailer-sku-conflict");if(!code)reasons.push("dm-valid-gtin-required");if(meta.gtin&&code!==String(meta.gtin))reasons.push("dm-target-gtin-conflict");if(!name||raw.isPharmacy===true)reasons.push("dm-readable-nonpharmacy-product-required");
 const seo=raw.seoInformation?.structuredData;if(seo?.gtin!=null&&String(seo.gtin)!==code)reasons.push("dm-product-gtin-conflict");if(seo?.sku!=null&&String(seo.sku)!==dan)reasons.push("dm-product-sku-conflict");
 const urls=[raw.metadata?.canonical,seo?.id,raw.self].filter(Boolean).map(value=>publicUrl(value,dan));const sourceUrl=urls[0]||null;if(!sourceUrl||urls.some(value=>!value||value!==sourceUrl))reasons.push("dm-public-product-url-required");
 const currency=raw.metadata?.currency??raw.trackingData?.currency??seo?.priceCurrency;if(currency!=="EUR"||[raw.metadata?.currency,raw.trackingData?.currency,seo?.priceCurrency].filter(value=>value!=null).some(value=>value!==currency))reasons.push("dm-eur-currency-required");
 const price=raw.metadata?.price??raw.trackingData?.price??seo?.price,visible=euro(raw.price?.price?.current?.value);if(typeof price!=="number"||!Number.isFinite(price)||price<=0||price>10000||visible===null||Math.abs(price-visible)>.00001||seo?.price!=null&&seo.price!==price)reasons.push("dm-current-gross-pack-price-required");
 const infos=raw.price?.infos||raw.price?.tileInfos,lead=Array.isArray(infos)?text(infos[0],400).split("(")[0].trim():"",infoPack=parsedPack(lead),namePack=parsedPack(name);if(!infoPack)reasons.push("dm-exact-sales-pack-required");if(namePack&&infoPack&&!compatiblePack(namePack,infoPack))reasons.push("dm-conflicting-sales-pack");
 const p=namePack||infoPack,capturedAt=timestamp(meta.capturedAt);if(!capturedAt)reasons.push("dm-live-capture-time-required");if(!/^[a-f0-9]{64}$/.test(meta.sourceResponseHash||""))reasons.push("dm-live-source-response-required");
 try{const api=allowedApiUrl(meta.sourceApiUrl);if(!api.startsWith(PRODUCT_ORIGIN+"/product/products/"))reasons.push("dm-live-price-api-required")}catch{reasons.push("dm-live-price-api-required")}
 if(reasons.length)return{ok:false,reasons,retailerSku:dan,gtin:code};
 const pack=(p.count>1?p.count+" x ":"")+p.amount+" "+p.unit,proofHash=hash(JSON.stringify({sourceApiUrl:meta.sourceApiUrl,sourceResponseHash:meta.sourceResponseHash,availabilityResponseHash:meta.availabilityResponseHash||null,retailerSku:dan,product:raw,availability:meta.availability||null}));
 const common={merchant:"dm",sourceId:SOURCE,retailerSku:dan,gtin:code,name,brand,pack,packAmount:p.amount,packUnit:p.unit,packCount:p.count,sourceUrl,scopeCountry:"DE",scopeChannel:"online"};
 const product={...common,canonicalKey:"gtin:"+code,purpose:"identity",truthEligible:false};
 const onlineOffer={...common,price,currency:"EUR",priceBasis:"pack",capturedAt,expiresAt:new Date(Date.parse(capturedAt)+24*60*60*1000).toISOString(),proofHash,sourceApiUrl:meta.sourceApiUrl,sourceResponseHash:meta.sourceResponseHash,availabilityApiUrl:meta.availabilityApiUrl||null,availabilityResponseHash:meta.availabilityResponseHash||null,availability:availability(meta.availability),state:"published",shippingIncluded:false};
 return{ok:true,reasons:[],product,onlineOffer};
}
function session(options={}){
 const fetchImpl=options.fetchImpl||fetch,pause=options.sleep||sleep,now=options.now||(()=>new Date().toISOString()),maxRequests=integer(options.maxRequests,40,100),timeoutMs=integer(options.timeoutMs,8000,15000),maxResponseBytes=integer(options.maxResponseBytes,2*1024*1024,6*1024*1024),maxDurationMs=integer(options.maxDurationMs,180000,300000),start=Date.now();let requests=0,lastStarted=0;
 async function request(url,{current=false}={}){
  url=allowedApiUrl(url);let last;
  for(let attempt=0;attempt<=1;attempt++){
   if(requests>=maxRequests)throw failure("dm-request-budget-exhausted");if(Date.now()-start>=maxDurationMs)throw failure("dm-duration-budget-exhausted");
   const wait=Math.max(0,1000-(Date.now()-lastStarted));if(wait)await pause(wait);requests++;lastStarted=Date.now();
   const ac=new AbortController();let timer;const timed=new Promise((_,reject)=>{timer=setTimeout(()=>{ac.abort();reject(failure("dm-source-timeout"))},Math.min(timeoutMs,maxDurationMs-(Date.now()-start)))});
   try{
    const response=await Promise.race([(async()=>{
     const res=await fetchImpl(url,{signal:ac.signal,redirect:"error",headers:{Accept:"application/json","User-Agent":"Sparkorb/1.0 (+https://julienfehlberg.github.io/Echtpreis/)",...(current?{"Cache-Control":"no-cache"}:{})}});
     if(res.url&&allowedApiUrl(res.url)!==url)throw failure("dm-unexpected-response-url");
     if(!res.ok){const retry=res.headers?.get?.("retry-after"),seconds=Number(retry),retryAfterMs=retry?Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(retry)-Date.now()):null;throw failure("dm-source-http-"+res.status,{status:res.status,retryAfterMs})}
     const declared=Number(res.headers?.get?.("content-length"));if(Number.isFinite(declared)&&declared>maxResponseBytes)throw failure("dm-source-body-too-large");
     const age=Number(res.headers?.get?.("age")||0);if(current&&Number.isFinite(age)&&age>300)throw failure("dm-current-response-stale");
     let raw;if(res.body){const chunks=[];let bytes=0;for await(const chunk of res.body){const buf=Buffer.from(chunk);bytes+=buf.length;if(bytes>maxResponseBytes){ac.abort();throw failure("dm-source-body-too-large")}chunks.push(buf)}raw=Buffer.concat(chunks).toString("utf8")}else if(typeof res.text==="function")raw=await res.text();else raw=JSON.stringify(await res.json());
     if(Buffer.byteLength(raw)>maxResponseBytes)throw failure("dm-source-body-too-large");let data;try{data=JSON.parse(raw)}catch{throw failure("dm-source-invalid-json")}return{data,sourceUrl:url,sourceResponseHash:hash(raw),capturedAt:timestamp(now())};
    })(),timed]);clearTimeout(timer);return response;
   }catch(error){clearTimeout(timer);ac.abort();last=error;const retry=error.code==="dm-source-timeout"||error.name==="AbortError"||error instanceof TypeError||[408,425,429].includes(error.status)||error.status>=500;if(!retry||attempt===1||error.retryAfterMs>30000)throw error;const backoff=error.retryAfterMs??(error.status===429?30000:0);if(backoff)await pause(backoff)}
  }throw last;
 }
 return{request,get requests(){return requests},maxRequests};
}
async function fetchProduct(retailerSku,options={}){
 const dan=sku(retailerSku);if(!dan)throw failure("dm-retailer-sku-required");const s=session(options),sourceApiUrl=PRODUCT_ORIGIN+"/product/products/detail/de/dan/"+dan,response=await s.request(sourceApiUrl,{current:true}),availabilityApiUrl=PRODUCT_ORIGIN+"/availability/api/v2/tiles/de/"+dan;
 const av=await s.request(availabilityApiUrl,{current:true}),parsed=parseProduct(response.data,{retailerSku:dan,gtin:options.gtin,capturedAt:response.capturedAt,sourceApiUrl,sourceResponseHash:response.sourceResponseHash,availabilityApiUrl,availabilityResponseHash:av.sourceResponseHash,availability:av.data?.[dan]});if(!parsed.ok)throw failure("dm-invalid-official-product",{reasons:parsed.reasons});return{product:parsed.product,onlineOffer:parsed.onlineOffer,requests:s.requests};
}
async function fetchOffers(targets=[],options={}){
 if(!Array.isArray(targets)){options={...targets,...options};targets=targets.targets||targets.dans||[]}
 const maxProducts=integer(options.maxProducts,1000,5000),batchSize=integer(options.batchSize,100,100),s=session(options),offers=[],products=[],rejected=[],bySku=new Map(),conflicts=new Set();
 for(const target of targets){const t=typeof target==="object"&&target!==null?target:{retailerSku:target},dan=sku(t.retailerSku??t.dan);if(!dan){rejected.push({target,reasons:["dm-retailer-sku-required"]});continue}const previous=bySku.get(dan);if(conflicts.has(dan)||previous&&previous.gtin&&t.gtin&&String(previous.gtin)!==String(t.gtin)){bySku.delete(dan);conflicts.add(dan);rejected.push({target,reasons:["dm-conflicting-target-gtin"]});continue}if(!previous)bySku.set(dan,{...t,retailerSku:dan})}
 const selected=[...bySku.values()].slice(0,maxProducts);let received=0,complete=selected.length===bySku.size;
 for(let offset=0;offset<selected.length;offset+=batchSize){
  const batch=selected.slice(offset,offset+batchSize),dans=batch.map(t=>t.retailerSku).join(","),sourceApiUrl=PRODUCT_ORIGIN+"/product/products/tiles/de/dans/"+dans,availabilityApiUrl=PRODUCT_ORIGIN+"/availability/api/v2/tiles/de/"+dans;let response,av;
  try{response=await s.request(sourceApiUrl,{current:true});if(!response.data?.products||typeof response.data.products!=="object"||Array.isArray(response.data.products))throw failure("dm-invalid-price-batch-schema");av=await s.request(availabilityApiUrl,{current:true});if(!av.data||typeof av.data!=="object"||Array.isArray(av.data))throw failure("dm-invalid-availability-batch-schema")}
  catch(error){if(/budget-exhausted/.test(error.code||"")){complete=false;break}throw error}
  for(const target of batch){const raw=response.data.products[target.retailerSku];received++;if(!raw){rejected.push({target,reasons:["dm-current-product-missing"]});continue}const result=parseProduct(raw,{...target,capturedAt:response.capturedAt,sourceApiUrl,sourceResponseHash:response.sourceResponseHash,availabilityApiUrl,availabilityResponseHash:av.sourceResponseHash,availability:av.data[target.retailerSku]});if(result.ok){offers.push(result.onlineOffer);products.push(result.product)}else rejected.push({target,reasons:result.reasons})}
 }
 return{offers,validatedOffers:offers,products,rejected,received,requests:s.requests,complete,sourceId:SOURCE,scopeCountry:"DE",scopeChannel:"online"};
}
async function discoverTargets(options={}){
 const queries=(Array.isArray(options.queries)?options.queries:DEFAULT_QUERIES).map(value=>text(value,80)).filter(Boolean).slice(0,40),queryHash=hash(JSON.stringify(queries)),maxProducts=integer(options.maxProducts??options.limit,1000,5000),maxPages=integer(options.maxPages,20,40),pageSize=integer(options.pageSize,30,30),s=session({...options,maxRequests:options.maxRequests??maxPages}),targets=[],rejected=[],bySku=new Map();let received=0,pages=0,index=0,page=0,offset=0,partialError=null;
 const saved=options.cursor;if(saved){if(saved.queryHash!==queryHash||!Number.isSafeInteger(saved.queryIndex)||saved.queryIndex<0||saved.queryIndex>queries.length||!Number.isSafeInteger(saved.page)||saved.page<0||!Number.isSafeInteger(saved.offset||0)||saved.offset<0)throw failure("dm-discovery-cursor-invalid");index=saved.queryIndex;page=saved.page;offset=saved.offset||0}
 // The public static endpoint redirects crawler user agents to this exact
 // same-origin route and sort. Use the verified destination directly.
 while(index<queries.length&&pages<maxPages&&targets.length<maxProducts){const u=new URL(SEARCH_ORIGIN+"/de/search/crawl");u.searchParams.set("query",queries[index]);u.searchParams.set("pageSize",String(pageSize));u.searchParams.set("currentPage",String(page));u.searchParams.set("sort","editorial_relevance");let response;
  try{response=await s.request(u.href)}catch(error){if(/budget-exhausted/.test(error.code||""))break;if(targets.length&&(error.status===429||error.status>=500||error.code==="dm-source-timeout"||error instanceof TypeError)){partialError={code:error.code||"dm-network-failed",status:error.status||null,retryAfterMs:error.retryAfterMs??(error.status===429?30000:null)};break}throw error}
  const data=response.data;if(!data||!Array.isArray(data.products)||data.currentPage!==page||!Number.isSafeInteger(data.totalPages)||data.totalPages<0||data.products.length>100)throw failure("dm-discovery-schema-invalid");pages++;received+=data.products.length;let row=offset;offset=0;
  for(;row<data.products.length&&targets.length<maxProducts;row++){const raw=data.products[row],tile=raw?.tileData,dan=sku(raw?.dan),code=gtin(raw?.gtin),name=text(raw?.title||tile?.title?.tileHeadline),sourceUrl=dan&&publicUrl(tile?.self,dan);if(!dan||!code||!name||!sourceUrl||tile?.isPharmacy===true||tile?.dan!=null&&sku(tile.dan)!==dan||tile?.gtin!=null&&String(tile.gtin)!==code){rejected.push({retailerSku:dan,reasons:["dm-discovery-product-invalid"]});continue}if(bySku.has(dan))continue;const p=parsedPack(name);const target={retailerSku:dan,gtin:code,name,brand:text(raw.brandName||tile?.brand?.name,120)||null,sourceUrl,discoveryQuery:queries[index],discoverySourceUrl:u.href,sourceId:SOURCE,...(p?{pack:(p.count>1?p.count+" x ":"")+p.amount+" "+p.unit}:{})};bySku.set(dan,target);targets.push(target)}
  if(row<data.products.length){offset=row;break}if(page+1>=data.totalPages){index++;page=0}else page++;
 }
 const complete=index>=queries.length;return{targets,rejected,received,pages,requests:s.requests,complete,partialError,cursor:complete?null:{queryHash,queryIndex:index,page,offset},sourceId:SOURCE,purpose:"discovery",truthEligible:false};
}
module.exports={SOURCE,PRODUCT_ORIGIN,SEARCH_ORIGIN,WEB_ORIGIN,DEFAULT_QUERIES,allowedApiUrl,parseProduct,availability,fetchProduct,fetchOffers,discoverTargets,collectTargets:discoverTargets};
