"use strict";

const crypto=require("node:crypto"),Inventory=require("./canonical-inventory-import");
const SOURCE="ALDI Nord published assortment",ORIGIN="https://www.aldi-nord.de",SITEMAP_URL=ORIGIN+"/sitemaps/.aldi-nord-sitemap-products.xml";
const hash=value=>crypto.createHash("sha256").update(value).digest("hex"),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const failure=(code,extra={})=>Object.assign(new Error(code),{code,...extra});
const compareSku=(a,b)=>a.length-b.length||a.localeCompare(b);
const STAPLE_SLUGS=[/(?:^|-)(?:milch|vollmilch|weidemilch)(?:-|$)/,/(?:^|-)(?:butter|markenbutter)(?:-|$)/,/(?:^|-)(?:haferflocken)(?:-|$)/,/(?:^|-)(?:reis)(?:-|$)/,/(?:^|-)(?:mehl)(?:-|$)/,/(?:^|-)(?:nudeln|pasta|spaghetti)(?:-|$)/,/(?:^|-)(?:eier)(?:-|$)/,/(?:^|-)(?:brot|landbrot|weltmeisterbrot|krustenbrot)(?:-|$)/,/(?:^|-)(?:toast|buttertoast)(?:-|$)/,/(?:^|-)(?:kaffee|filterkaffee)(?:-|$)/];
const staplePriority=target=>{const rank=STAPLE_SLUGS.findIndex(pattern=>pattern.test(target.nameSlug));return rank<0?STAPLE_SLUGS.length:rank};
function integer(value,fallback,max){return Number.isSafeInteger(value)&&value>0?Math.min(value,max):fallback}
function sku(value){const s=String(value??"");return /^\d{1,15}$/.test(s)&&Number.isSafeInteger(Number(s))&&Number(s)>0?String(Number(s)):null}
function label(value,max=400){return typeof value==="string"?value.trim().slice(0,max):""}
function timestamp(value){if(typeof value!=="string"||!value.trim())return null;const n=Date.parse(value);return Number.isFinite(n)?new Date(n).toISOString():null}
function money(value){if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>10000)return null;const cents=Math.round(value*100);return Number.isSafeInteger(cents)&&Math.abs(value*100-cents)<1e-6?cents/100:null}
function responseFreshness({capturedAt,sourceResponseDate,sourceAgeSeconds},maxAgeMs){
 const at=Date.parse(timestamp(capturedAt)),date=timestamp(sourceResponseDate);
 if(!timestamp(capturedAt))throw failure("aldi-live-capture-time-required");
 if(sourceResponseDate==null)throw failure("aldi-source-response-date-required");
 if(!date||typeof sourceResponseDate!=="string"||!(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(sourceResponseDate)&&new Date(date).toUTCString()===sourceResponseDate||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(sourceResponseDate)&&date===sourceResponseDate)||Date.parse(date)>at+5*60*1000||Date.parse(date)<at-maxAgeMs)throw failure("aldi-source-response-date-stale-or-invalid");
 if(sourceAgeSeconds!=null&&(!Number.isSafeInteger(sourceAgeSeconds)||sourceAgeSeconds<0||sourceAgeSeconds*1000>maxAgeMs))throw failure("aldi-source-cache-age-stale-or-invalid");
 return date;
}
function exactPack(value){
 if(typeof value!=="string")return null;
 const normalized=value.replace(/\bSt\.(?=\s|[-]|$)/g,"Stück");
 if(/(?:\bca\.?\b|ungef[aä]hr|mindestens|~|\d\s*[-–]\s*\d|\b(?:pro|je)\s+100\s*[- ]?g\b)/i.test(normalized))return null;
 const quantities=normalized.match(/\b\d+(?:[.,]\d+)?\s*[- ]?\s*(?:kg|g|ml|cl|l|st[uü]ck|stk|rollen|piece)\b/gi)||[];
 if(quantities.length!==1)return null;
 return Inventory.productPack({quantity:normalized}).parsed;
}
function targetForUrl(value){
 let u;try{u=new URL(value)}catch{throw failure("aldi-product-url-not-allowed")}
 if(u.origin!==ORIGIN||u.username||u.password||u.search||u.hash)throw failure("aldi-product-url-not-allowed");
 const m=u.pathname.match(/^\/produkt\/([a-z0-9-]+)-(\d{1,15})\.html$/),retailerSku=m&&sku(m[2]);
 if(!m||!retailerSku||m[2]!==retailerSku)throw failure("aldi-product-url-not-allowed");
 return{retailerSku,nameSlug:m[1],sourceUrl:u.href,sourceId:SOURCE,scopeCountry:"DE",purpose:"discovery",truthEligible:false};
}
function allowedUrl(value){if(value===SITEMAP_URL)return value;return targetForUrl(value).sourceUrl}
function stableTargets(input){
 if(!Array.isArray(input))throw failure("aldi-target-list-required");
 const bySku=new Map(),conflicts=new Set(),rejected=[];
 for(const raw of input){let target;try{target=targetForUrl(typeof raw==="string"?raw:raw?.sourceUrl)}catch{rejected.push({target:raw,reasons:["aldi-product-url-not-allowed"]});continue}
  if(raw&&typeof raw==="object"&&raw.retailerSku!=null&&sku(raw.retailerSku)!==target.retailerSku){rejected.push({target:raw,reasons:["aldi-target-sku-conflict"]});continue}
  const old=bySku.get(target.retailerSku);if(conflicts.has(target.retailerSku)||old&&old.sourceUrl!==target.sourceUrl){bySku.delete(target.retailerSku);conflicts.add(target.retailerSku);rejected.push({target,reasons:["aldi-conflicting-target-urls"]});continue}bySku.set(target.retailerSku,target);
 }
 const targets=[...bySku.values()].sort((a,b)=>staplePriority(a)-staplePriority(b)||compareSku(a.retailerSku,b.retailerSku));
 return{targets,rejected,snapshotHash:hash(JSON.stringify(targets.map(t=>[t.retailerSku,t.sourceUrl])))};
}
function parseSitemap(xml){
 if(typeof xml!=="string"||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<urlset\b[^>]*\bxmlns\s*=\s*["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/i.test(xml)||!/<\/urlset>\s*$/.test(xml))throw failure("aldi-sitemap-schema-invalid");
 const opened=(xml.match(/<loc(?:\s[^>]*)?>/g)||[]).length,closed=(xml.match(/<\/loc>/g)||[]).length,locations=[...xml.matchAll(/<loc(?:\s[^>]*)?>([^<]*)<\/loc>/g)].map(m=>m[1].trim().replace(/&amp;/g,"&"));
 if(!locations.length||opened!==closed||locations.length!==opened||locations.some(s=>/&(?:[a-z]+|#\d+|#x[a-f\d]+);/i.test(s)))throw failure("aldi-sitemap-schema-invalid");
 return{...stableTargets(locations),publishedUrlCount:locations.length};
}
function extractProducts(html){
 if(typeof html!=="string")throw failure("aldi-product-page-schema-invalid");
 const blocks=[...html.matchAll(/<script\b(?=[^>]*\bid\s*=\s*["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)];
 if(blocks.length!==1)throw failure("aldi-product-page-schema-invalid");
 let outer;try{outer=JSON.parse(blocks[0][1])}catch{throw failure("aldi-product-page-schema-invalid")}
 const page=outer?.props?.pageProps;if(page?.hasError===true)throw failure("aldi-native-source-unavailable");
 let entries;try{entries=typeof page?.apiData==="string"?JSON.parse(page.apiData):page?.apiData}catch{throw failure("aldi-product-page-schema-invalid")}
 if(!Array.isArray(entries))throw failure("aldi-product-page-schema-invalid");
 const detail=entries.filter(e=>Array.isArray(e)&&e[0]==="PRODUCT_DETAIL_GET");
 if(detail.length!==1||!Array.isArray(detail[0][1]?.res?.products))throw failure("aldi-product-page-schema-invalid");
 return{products:detail[0][1].res.products,requestedProductIds:detail[0][1]?.req?.productIds||null};
}
function parseProduct(raw={},meta={}){
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return{ok:false,reasons:["aldi-native-product-schema-invalid"],retailerSku:null};
 const reasons=[];let target;try{target=targetForUrl(meta.sourceUrl)}catch{reasons.push("aldi-product-url-not-allowed")}
 let sourceResponseDate;try{sourceResponseDate=responseFreshness(meta,5*60*1000)}catch(error){reasons.push(error.code)}
 const nativeSku=sku(raw.objectID),name=label(raw.name),variant=label(raw.shortDescription),brand=label(raw.brandName,120)||null,pack=label(raw.salesUnit),p=exactPack(pack),capturedAt=timestamp(meta.capturedAt);
 if(!target||!nativeSku||nativeSku!==target.retailerSku||raw.productSlug!==target.sourceUrl.split("/").at(-1).replace(/\.html$/,""))reasons.push("aldi-native-product-identity-conflict");
 if(meta.retailerSku!=null&&sku(meta.retailerSku)!==nativeSku)reasons.push("aldi-target-sku-conflict");
 if(!name)reasons.push("aldi-native-product-name-required");
 if(!p)reasons.push("aldi-exact-sales-pack-required");
 if(!capturedAt)reasons.push("aldi-live-capture-time-required");
 if(!/^[a-f0-9]{64}$/.test(meta.sourceResponseHash||""))reasons.push("aldi-live-source-response-required");
 if(raw.isDrainedWeight===true&&(!Number.isFinite(raw.drainedWeightValue)||raw.drainedWeightValue<=0))reasons.push("aldi-drained-weight-unresolved");
 const ambiguousVariant=/verschiedene\s+(?:sorten|varianten|ausf[uü]hrungen)|(?:^|\s)z\.?\s*b\.?\s|je\s+nach\s+(?:sorte|ausf[uü]hrung)/i.test(variant+" "+name);
 if(ambiguousVariant)reasons.push("aldi-product-variant-unresolved");
 if(reasons.length)return{ok:false,reasons,retailerSku:nativeSku};
 const common={merchant:"ALDI Nord",sourceId:SOURCE,retailerSku:nativeSku,gtin:null,name,variant,brand,pack,packAmount:p.amount,packUnit:p.unit,packCount:p.count,sourceUrl:target.sourceUrl,scopeCountry:"DE",scopeChannel:"assortment-publication",locationScope:"unknown",storeId:null,truthEligible:false};
 const product={...common,purpose:"identity",identityScope:"retailer-sku",publicationAvailable:raw.isAvailable===true,observedAt:capturedAt,sourceResponseHash:meta.sourceResponseHash,sourceResponseDate,sourceAgeSeconds:meta.sourceAgeSeconds??null};
 const native=raw.currentPrice,price=money(native?.priceValue),from=native?.validFrom,until=native?.validUntil,clock=Date.parse(capturedAt);
 if(price===null||price<=0)reasons.push("aldi-current-pack-price-required");
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(until)||from<0||until<=from||until>32503680000)reasons.push("aldi-native-price-validity-required");
 else if(from*1000>clock||until*1000<=clock)reasons.push("aldi-current-price-outside-native-validity");
 if(raw.isAvailable!==true||raw.isComingSoon===true||raw.isRecall===true)reasons.push("aldi-product-not-currently-published");
 if(raw.isDepositProduct!=null&&typeof raw.isDepositProduct!=="boolean")reasons.push("aldi-native-deposit-flag-invalid");
 if(raw.isDepositProduct===true){if(money(raw.depositValue)===null)reasons.push("aldi-deposit-unresolved");reasons.push("aldi-deposit-price-basis-unresolved")}
 if(raw.isDepositProduct===false&&raw.depositValue!=null&&money(raw.depositValue)!==0)reasons.push("aldi-native-deposit-conflict");
 if(reasons.length)return{ok:true,product,offer:null,reasons,retailerSku:nativeSku};
 const proofHash=hash(JSON.stringify({sourceUrl:target.sourceUrl,sourceResponseHash:meta.sourceResponseHash,product:raw}));
 const offer={...common,price,currency:"EUR",priceBasis:"pack",priceKind:"published-current",regularPrice:null,promotionStatus:"unknown",capturedAt,nativeValidFrom:new Date(from*1000).toISOString(),nativeValidUntil:new Date(until*1000).toISOString(),expiresAt:new Date(Math.min(clock+24*60*60*1000,until*1000)).toISOString(),sourceResponseHash:meta.sourceResponseHash,sourceResponseDate,sourceAgeSeconds:meta.sourceAgeSeconds??null,proofHash,availability:"unknown",publicationAvailable:true,state:"published",deposit:raw.isDepositProduct===false?0:null,depositIncluded:raw.isDepositProduct===false?false:null};
 return{ok:true,product,offer,reasons:[],retailerSku:nativeSku};
}
function session(options={}){
 const fetchImpl=options.fetchImpl||fetch,pause=options.sleep||sleep,now=options.now||(()=>new Date().toISOString()),maxRequests=integer(options.maxRequests,25,250),timeoutMs=integer(options.timeoutMs,8000,15000),maxResponseBytes=integer(options.maxResponseBytes,4*1024*1024,16*1024*1024),maxTotalBytes=integer(options.maxTotalBytes,8*1024*1024,64*1024*1024),maxDurationMs=integer(options.maxDurationMs,180000,300000),start=Date.now();let requests=0,bytes=0,lastStarted=0;
 async function request(value,{current=false}={}){
  const url=allowedUrl(value);if(requests>=maxRequests)throw failure("aldi-request-budget-exhausted");if(Date.now()-start>=maxDurationMs)throw failure("aldi-duration-budget-exhausted");
  const wait=Math.max(0,1000-(Date.now()-lastStarted));if(wait)await pause(wait);requests++;lastStarted=Date.now();
  const ac=new AbortController();let timer;const timed=new Promise((_,reject)=>{timer=setTimeout(()=>{ac.abort();reject(failure("aldi-source-timeout"))},Math.min(timeoutMs,maxDurationMs-(Date.now()-start)))});
  try{return await Promise.race([(async()=>{
   const res=await fetchImpl(url,{method:"GET",signal:ac.signal,redirect:"error",credentials:"omit",headers:{Accept:current?"text/html":"application/xml,text/xml","User-Agent":"Sparkorb-PriceSource/1.0 (public retail prices)"}});
   if(res.url&&allowedUrl(res.url)!==url)throw failure("aldi-unexpected-response-url");
   if(res.status!==200){const retry=res.headers?.get?.("retry-after"),seconds=Number(retry),retryAfterMs=retry?Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(retry)-Date.now()):null;throw failure("aldi-source-http-"+res.status,{status:res.status,retryAfterMs})}
   const declared=Number(res.headers?.get?.("content-length"));if(Number.isFinite(declared)&&declared>maxResponseBytes)throw failure("aldi-source-body-too-large");
   const capturedAt=timestamp(now()),age=res.headers?.get?.("age"),sourceAgeSeconds=age==null?null:Number(age);
   if(age!=null&&!/^\d+$/.test(age))throw failure("aldi-source-cache-age-stale-or-invalid");
   const date=res.headers?.get?.("date");if(date!=null&&!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(date))throw failure("aldi-source-response-date-stale-or-invalid");
   const sourceResponseDate=responseFreshness({capturedAt,sourceResponseDate:date,sourceAgeSeconds},current?5*60*1000:15*60*1000);
   let raw;if(res.body){const chunks=[];let size=0;for await(const chunk of res.body){const buf=Buffer.from(chunk);size+=buf.length;bytes+=buf.length;if(size>maxResponseBytes||bytes>maxTotalBytes){ac.abort();throw failure(size>maxResponseBytes?"aldi-source-body-too-large":"aldi-total-body-budget-exhausted")}chunks.push(buf)}raw=Buffer.concat(chunks).toString("utf8")}else{raw=await res.text();const size=Buffer.byteLength(raw);bytes+=size;if(size>maxResponseBytes||bytes>maxTotalBytes)throw failure(size>maxResponseBytes?"aldi-source-body-too-large":"aldi-total-body-budget-exhausted")}
   return{raw,sourceUrl:url,sourceResponseHash:hash(raw),capturedAt,sourceResponseDate,sourceAgeSeconds};
  })(),timed])}finally{clearTimeout(timer);ac.abort()}
 }
 return{request,maxRequests,get requests(){return requests},get bytes(){return bytes}};
}
async function discoverTargets(options={}){
 const s=session({...options,maxRequests:1}),response=await s.request(SITEMAP_URL),parsed=parseSitemap(response.raw);
 return{...parsed,complete:true,completeCatalog:true,catalogScope:"published-public-product-pages",sourceId:SOURCE,purpose:"discovery",truthEligible:false,sourceUrl:SITEMAP_URL,sourceResponseHash:response.sourceResponseHash,sourceResponseDate:response.sourceResponseDate,sourceAgeSeconds:response.sourceAgeSeconds,discoveredAt:response.capturedAt,requests:s.requests,bytes:s.bytes};
}
async function fetchProducts(input=[],options={}){
 const normalized=stableTargets(input),targets=normalized.targets,s=session(options),offers=[],products=[],rejected=[...normalized.rejected],cursor=options.cursor;let index=0,processed=0,partialError=null,cursorReset=false;
 if(cursor){
  if(!/^[a-f0-9]{64}$/.test(cursor.snapshotHash||"")||!Number.isSafeInteger(cursor.nextIndex)||cursor.nextIndex<0||cursor.lastSku!=null&&sku(cursor.lastSku)!==cursor.lastSku||cursor.nextIndex===0&&cursor.lastSku!=null||cursor.nextIndex>0&&!cursor.lastSku)throw failure("aldi-price-cursor-invalid");
  if(cursor.snapshotHash===normalized.snapshotHash){if(cursor.nextIndex>targets.length||cursor.nextIndex>0&&targets[cursor.nextIndex-1].retailerSku!==cursor.lastSku||cursor.nextIndex===0&&cursor.lastSku!=null)throw failure("aldi-price-cursor-invalid");index=cursor.nextIndex}
  else{if(cursor.nextIndex>0&&!cursor.lastSku)throw failure("aldi-price-cursor-invalid");index=0;cursorReset=true}
 }
 while(index<targets.length){const target=targets[index];let response;
  try{response=await s.request(target.sourceUrl,{current:true})}catch(error){if(error.status===404||error.status===410){rejected.push({target,reasons:["aldi-current-product-missing"]});processed++;index++;continue}if(/budget-exhausted/.test(error.code||""))break;if(!processed)throw error;partialError={code:error.code||"aldi-source-network-failed",status:error.status||null,retryAfterMs:error.retryAfterMs??null};break}
  let extracted;try{extracted=extractProducts(response.raw)}catch(error){if(error.code==="aldi-native-source-unavailable"){if(!processed)throw error;partialError={code:error.code,status:null,retryAfterMs:null};break}rejected.push({target,reasons:[error.code||"aldi-product-page-schema-invalid"]});processed++;index++;continue}
  if(extracted.requestedProductIds&&(!Array.isArray(extracted.requestedProductIds)||extracted.requestedProductIds.length!==1||sku(extracted.requestedProductIds[0])!==target.retailerSku)){rejected.push({target,reasons:["aldi-native-request-identity-conflict"]});processed++;index++;continue}
  const candidates=extracted.products.filter(p=>sku(p?.objectID)===target.retailerSku);
  if(candidates.length!==1){rejected.push({target,reasons:["aldi-native-product-identity-conflict"]});processed++;index++;continue}
  const parsed=parseProduct(candidates[0],{...target,capturedAt:response.capturedAt,sourceResponseHash:response.sourceResponseHash,sourceResponseDate:response.sourceResponseDate,sourceAgeSeconds:response.sourceAgeSeconds});
  if(parsed.ok){products.push(parsed.product);if(parsed.offer)offers.push(parsed.offer)}if(parsed.reasons.length)rejected.push({target,reasons:parsed.reasons});processed++;index++;
 }
 const complete=index>=targets.length;return{offers,products,rejected,processed,requests:s.requests,bytes:s.bytes,complete,partialError,cursorReset,cursor:complete?null:{snapshotHash:normalized.snapshotHash,nextIndex:index,lastSku:index>0?targets[index-1].retailerSku:null},snapshotHash:normalized.snapshotHash,targetCount:targets.length,sourceId:SOURCE,scopeCountry:"DE",scopeChannel:"assortment-publication",truthEligible:false};
}
module.exports={SOURCE,ORIGIN,SITEMAP_URL,targetForUrl,allowedUrl,stableTargets,parseSitemap,extractProducts,exactPack,parseProduct,responseFreshness,discoverTargets,fetchProducts};
