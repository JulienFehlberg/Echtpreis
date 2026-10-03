"use strict";
const crypto=require("node:crypto"),Parser=require("./aldi-assortment-category-client"),Rejected=require("./aldi-category-rejected-capture-store");
const Navigation=require("./aldi-category-navigation-parser");
const SOURCE=Parser.SOURCE,SEED="https://www.aldi-nord.de/sortiment/milchprodukte/milch-milchgetraenke.html",MAX_TARGETS=256;
const fail=(code,extra={})=>Object.assign(new Error(code),{code,...extra});
function targets(values){
 if(!Array.isArray(values)||!values.length||values.length>MAX_TARGETS)throw fail("aldi-category-targets-invalid");
 const normalized=values.map(Parser.categoryUrl);if(new Set(normalized).size!==normalized.length)throw fail("aldi-category-targets-duplicate");
 return normalized;
}
function navigationTargets(body){
 // Only native navigation links are discovery hints; they confer no article identity.
 const match=body.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);if(!match)return[];
 let native;try{native=JSON.parse(match[1]);}catch{return[];}
 const navigation=native?.props?.pageProps?.page?.header,found=new Set();
 const visit=(value,depth=0)=>{if(depth>12||!value||typeof value!=="object")return;
  if(typeof value.path==="string"){try{found.add(Parser.categoryUrl(value.path));}catch{}}
  if(Array.isArray(value))for(const child of value)visit(child,depth+1);else for(const [key,child]of Object.entries(value))if(key!=="@path"&&key!=="reference")visit(child,depth+1);
 };
 const nativeEntries=value=>Array.isArray(value)?value:value&&typeof value==="object"?Object.entries(value).filter(([key])=>/^(?:0|[1-9]\d{0,2})$/.test(key)).map(([,entry])=>entry):[];
 for(const header of nativeEntries(navigation)){for(const kind of["sideDrawerNavigation","flyoutNavigation"]){for(const block of nativeEntries(header?.[kind]))if(block?.Produkte)visit(block.Produkte);}}
 if(found.size>MAX_TARGETS)throw fail("aldi-category-navigation-bound-exceeded");
 return[...found].sort();
}
function retryAfter(headers,time){
 const value=headers?.get?.("retry-after");if(value==null)return null;
 // Preserve long source pauses. An unrepresentable seconds value conservatively
 // pauses through the last supported Date instead of turning into a short retry.
 const remaining=8640000000000000-time;
 if(/^\d+$/.test(value)){const seconds=BigInt(value);return seconds>BigInt(Math.floor(remaining/1000))?remaining:Number(seconds)*1000;}
 const at=Date.parse(value);return Number.isFinite(at)&&at>time?at-time:null;
}
function discoveryTargets(original,options={}){
 if(!options||typeof options!=="object"||Array.isArray(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw fail("aldi-category-discovery-original-required");
 const time=options.now??Date.now();if(!original||typeof original.body!=="string"||!Number.isSafeInteger(time)||time<0||!Number.isFinite(new Date(time).getTime())||Object.keys(options).some(k=>!["now","navigation"].includes(k))||options.navigation!==undefined&&typeof options.navigation!=="boolean")throw fail("aldi-category-discovery-original-required");
 if(options.navigation)return Navigation.parseNavigationParent(original.body,original.meta,{now:time}).discoveredTargets;
 const found=new Set(navigationTargets(original.body));
 // Optional, bound native sibling references supplement independent header
 // hints. A missing or ambiguous context never grants sibling discovery.
 try{for(const target of Navigation.parseSiblingTargets(original.body,original.meta,{now:time}).discoveredTargets)found.add(target);}catch{}
 if(found.size>MAX_TARGETS)throw fail("aldi-category-navigation-bound-exceeded");return[...found].sort();
}
async function fetchPage(target,options={}){
 const url=Parser.categoryUrl(target),fetchImpl=options.fetchImpl||fetch,now=options.now||Date.now,timeout=options.timeoutMs??15000,maxBytes=options.maxBytes??Parser.MAX_BYTES;
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>30000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>Parser.MAX_BYTES)throw fail("aldi-category-request-budget-invalid");
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);let response;
 try{
  try{response=await fetchImpl(url,{method:"GET",redirect:"error",credentials:"omit",signal:controller.signal,headers:{Accept:"text/html","User-Agent":"Sparkorb-PriceSource/1.0 (public retail prices)"}});}catch(error){throw fail("aldi-category-fetch-failed",{cause:error,requestStarted:true});}
  if(response.status!==200){await response.body?.cancel?.().catch(()=>{});throw fail("aldi-category-http-"+response.status,{status:response.status,retryAfterMs:retryAfter(response.headers,now()),requestStarted:true});}
  if(response.url&&response.url!==url)throw fail("aldi-category-response-url-conflict",{requestStarted:true});
  const contentType=response.headers?.get?.("content-type");if(contentType&&!/^text\/html(?:\s*;|$)/i.test(contentType))throw fail("aldi-category-html-response-required",{requestStarted:true});
  const size=response.headers?.get?.("content-length");if(size!=null&&(!/^\d+$/.test(size)||Number(size)>maxBytes))throw fail("aldi-category-response-byte-budget",{requestStarted:true});
  const chunks=[];let bytes=0;
  if(response.body?.getReader){const reader=response.body.getReader();try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maxBytes){await reader.cancel();throw fail("aldi-category-response-byte-budget",{requestStarted:true});}chunks.push(Buffer.from(part.value));}}finally{reader.releaseLock?.();}}
  else{const data=Buffer.from(await response.arrayBuffer());bytes=data.length;if(bytes>maxBytes)throw fail("aldi-category-response-byte-budget",{requestStarted:true});chunks.push(data);}
  const raw=Buffer.concat(chunks);let body;try{body=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(raw);}catch{throw fail("aldi-category-response-utf8-required",{requestStarted:true});}
  const time=now();if(!Number.isSafeInteger(time)||time<0)throw fail("aldi-category-clock-invalid",{requestStarted:true});
  const age=response.headers?.get?.("age"),meta={sourceResponseUrl:url,sourceResponseHash:crypto.createHash("sha256").update(raw).digest("hex"),sourceResponseDate:response.headers?.get?.("date"),sourceAgeSeconds:age==null?null:/^\d+$/.test(age)?Number(age):NaN,capturedAt:new Date(time).toISOString(),scopeCountry:"DE"};
  const original={body,meta};let page;try{page=Parser.parsePage(raw,meta,{now:time});}catch(error){
   // Preserve a bounded original only for a reproducible native-shape rejection.
   // Non-enumerable bodies stay out of ordinary error logs and public responses.
   if(Rejected.FAILURE_CODES.includes(error.code))Object.defineProperty(error,"rejectedCapture",{value:{status:200,failureCode:error.code,original,bytes},enumerable:false});
   if(error.code==="aldi-category-native-index-conflict"){
    let navigation;try{navigation=Navigation.parseNavigationParent(raw,meta,{now:time});}catch{}
    if(navigation)return{sourceId:SOURCE,navigation,original,rejectedCapture:error.rejectedCapture,discoveredTargets:discoveryTargets(original,{now:time,navigation:true}),requests:1,bytes,truthEligible:false,assortmentComplete:false};
   }
   error.requestStarted=true;throw error;
  }if(!page.freshCaptureVerified)throw fail("aldi-category-original-http-proof-required",{requestStarted:true});
  return{sourceId:SOURCE,page,original,discoveredTargets:discoveryTargets(original,{now:time}),requests:1,bytes,truthEligible:false,assortmentComplete:false};
 }finally{controller.abort();clearTimeout(timer);}
}
module.exports={SOURCE,SEED,MAX_TARGETS,targets,navigationTargets,discoveryTargets,retryAfter,fetchPage};
