(function(root){
"use strict";
const node=typeof module==="object"&&module.exports;
const Products=node?require("./published-product-client"):root.SparkorbPublishedProductClient;
const Matcher=node?require("../shopping-need-matcher"):root.SparkorbShoppingNeedMatcher;
const retained=new WeakMap(),HIT="HIT Berlin store assortment";
const described=new Set(["Wolt EDEKA Berlin","Wolt nahkauf Berlin Wrangelstraße","REWE Berlin pickup"]);
const text=value=>typeof value==="string"?value.trim():"";
function equal(a,b){
 if(a===b)return true;if(a===null||b===null||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
 const left=Object.keys(a).sort(),right=Object.keys(b).sort();return left.length===right.length&&left.every((key,i)=>key===right[i]&&equal(a[key],b[key]));
}
function request(raw){
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).some(key=>!["search","constraints","pack","scopeChannel","priorityRetailersOnly"].includes(key)))throw Error("invalid-shopping-need-input");
 const need=Matcher.parse({search:raw.search,constraints:raw.constraints}),filters=Products.searchFilters(raw);
 if(!filters.ok)throw Object.assign(Error(filters.reason),{code:filters.reason});
 return{need,filters,payload:{search:need.search,constraints:need.constraints,limit:20,...(filters.pack?{pack:filters.pack}:{}),...(filters.scopeChannel?{scopeChannel:filters.scopeChannel}:{}),...(filters.priorityRetailersOnly===undefined?{}:{priorityRetailersOnly:filters.priorityRetailersOnly})}};
}
function binding(offer){return{sourceId:offer.sourceId,scopeChannel:offer.scopeChannel,retailerSku:offer.retailerSku,storeId:offer.storeId||null,nativeVenueId:offer.nativeVenueId||null,nativeMarketId:offer.nativeMarketId||null,gtin:offer.gtin,pack:offer.pack};}
const bindingKey=offer=>JSON.stringify(Object.values(binding(offer)));
function assessment(offer,need){
 const physical=offer.scopeChannel==="physical-store",name=physical?offer.nativeProof?.headline:offer.name;
 if(typeof name!=="string"||!name.trim()||name.length>200||physical&&(offer.sourceId!==HIT||name.replace(/\s+/g," ").trim()!==offer.name))return null;
 return Matcher.classify(need,{name,...(!physical&&described.has(offer.sourceId)&&offer.description?{description:offer.description}:{})});
}
function candidate(input,options={}){
 const saved=retained.get(input),raw=saved?saved.raw:input;
 let prepared;try{prepared=request(options.request||saved?.request);}catch(_){return null;}
 if(saved&&!equal(prepared.need,saved.need))return null;
 const value=Products.candidate(raw,{...options,pack:prepared.filters.pack,scopeChannel:prepared.filters.scopeChannel,...(prepared.filters.priorityRetailersOnly===undefined?{}:{priorityRetailersOnly:prepared.filters.priorityRetailersOnly})});
 if(!value||!raw.needAssessment||raw.needAssessment.selectionRequired!==true||!Array.isArray(raw.needAssessment.offerMatches))return null;
 const original=[...raw.offers,...(raw.physicalOffers||[])],matches=raw.needAssessment.offerMatches;
 if(matches.length!==original.length||matches.length>200)return null;
 const bySource=new Map();
 for(const offer of original){
  const id=bindingKey(offer);if(bySource.has(id))return null;
  const found=matches.filter(match=>bindingKey(match)===id);if(found.length!==1)return null;
  let evaluated;try{evaluated=assessment(offer,prepared.need);}catch(_){return null;}
  if(!evaluated||evaluated.status==="contradicted"||!equal(found[0],{...binding(offer),...evaluated}))return null;
  bySource.set(id,{...binding(offer),...evaluated});
 }
 const remaining=[...value.offers,...value.physicalOffers],offerMatches=remaining.map(offer=>bySource.get(bindingKey(offer)));
 if(offerMatches.some(match=>!match))return null;
 const needAssessment={status:offerMatches.some(match=>match.status==="confirmed")?"confirmed":"unconfirmed",selectionRequired:true,offerMatches};
 const result={...value,needAssessment};
 // Only this open picker retains original evidence. Saving an identity excludes it.
 retained.set(result,{raw,need:prepared.need,request:{search:prepared.need.search,constraints:prepared.need.constraints,...(prepared.filters.pack?{pack:prepared.filters.pack}:{}),...(prepared.filters.scopeChannel?{scopeChannel:prepared.filters.scopeChannel}:{}),...(prepared.filters.priorityRetailersOnly===undefined?{}:{priorityRetailersOnly:prepared.filters.priorityRetailersOnly})}});
 return result;
}
function normalizeResponse(raw,requested,options={}){
 let prepared;try{prepared=request(requested);}catch(error){return{ok:false,items:[],reason:error.code||"invalid-shopping-need-input"};}
 if(!raw||raw.ok!==true||raw.scopeCountry!=="DE"||raw.selectionRequired!==true||raw.automaticSelection!==false||raw.needCoverage?.complete!==false||!equal(raw.need,prepared.need))return{ok:false,items:[],reason:"invalid-need-response"};
 const bounded=Products.normalizeResponse(raw,{...options,pack:prepared.filters.pack,scopeChannel:prepared.filters.scopeChannel,...(prepared.filters.priorityRetailersOnly===undefined?{}:{priorityRetailersOnly:prepared.filters.priorityRetailersOnly})});if(!bounded.ok)return bounded;
 const seen=new Set(),duplicates=new Set(),items=[];
 for(const input of raw.items){const value=candidate(input,{...options,request:requested});if(!value)continue;const id=Products.key(value);if(seen.has(id))duplicates.add(id);seen.add(id);items.push(value);}
 const accepted=items.filter(item=>!duplicates.has(Products.key(item))).sort((a,b)=>Number(b.needAssessment.status==="confirmed")-Number(a.needAssessment.status==="confirmed"));
 return{ok:true,items:accepted,need:prepared.need,selectionRequired:true,automaticSelection:false,needCoverage:{confirmedIdentities:accepted.filter(item=>item.needAssessment.status==="confirmed").length,unconfirmedIdentities:accepted.filter(item=>item.needAssessment.status==="unconfirmed").length,complete:false},discoveryTruncated:raw.discoveryTruncated===true};
}
function create(config={}){
 const apiBase=text(config.apiBase).replace(/\/+$/,""),fetchImpl=config.fetchImpl||root.fetch?.bind(root),now=typeof config.now==="function"?config.now:Date.now;
 async function search(raw,options={}){
  let prepared;try{prepared=request(raw);}catch(error){return{ok:false,items:[],reason:error.code||"invalid-shopping-need-input"};}
  if(typeof fetchImpl!=="function")return{ok:false,items:[],reason:"unavailable"};
  const signal=options.signal,controller=new AbortController(),abort=()=>controller.abort();let timer;
  if(signal?.aborted)return{ok:false,items:[],reason:"cancelled"};signal?.addEventListener("abort",abort,{once:true});
  try{
   const response=await Promise.race([
    Promise.resolve().then(async()=>{const res=await fetchImpl(apiBase+"/v1/shopping-need",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"omit",body:JSON.stringify(prepared.payload),signal:controller.signal});if(!res?.ok){if(res?.status===400){const problem=await res.json();return{problem:text(problem.error)};}throw Error("unavailable");}return res.json();}),
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error("timeout"));},Math.max(1,Math.min(10000,Number(options.timeoutMs??config.timeoutMs)||8000)));})
   ]);
   if(controller.signal.aborted)return{ok:false,items:[],reason:"cancelled"};
   if(response.problem)return{ok:false,items:[],reason:response.problem.startsWith("invalid-")?response.problem:"invalid-shopping-need-input"};
   return normalizeResponse(response,raw,{now:now()});
  }catch(_){return{ok:false,items:[],reason:controller.signal.aborted?"cancelled":"unavailable"};}
  finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
 }
 return Object.freeze({search});
}
const api=Object.freeze({create,request,candidate,normalizeResponse});
if(root)root.SparkorbShoppingNeedClient=api;if(node)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
