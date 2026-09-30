"use strict";
const Provider=require("./providers/open-prices"),Net=require("./resilient-fetch"),Inventory=require("./open-prices-inventory-client"),Identity=require("./product-identity");
const BASE="https://prices.openfoodfacts.org/api/v1/prices";
function todayBerlin(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now).map(p=>[p.type,p.value]));
 return parts.year+"-"+parts.month+"-"+parts.day;
}
function integer(value,fallback,min,max){const n=Number(value);return Number.isSafeInteger(n)?Math.min(max,Math.max(min,n)):fallback}
function normalizeInput(input={}){
 const window=Inventory.normalizeInput({today:input.today||todayBerlin(),since:input.since});
 const productCode=input.productCode==null||input.productCode===""?null:String(input.productCode).replace(/\s/g,"");
 if(productCode&&(!/^\d+$/.test(productCode)||!Identity.gtinValid(productCode)))throw new Error("open-prices-invalid-product-code");
 const location=input.locationId==null||input.locationId===""?null:String(input.locationId).replace(/^openprices:/,"");
 if(location&&(!/^\d+$/.test(location)||!Number.isSafeInteger(Number(location))||Number(location)<=0))throw new Error("open-prices-invalid-location-id");
 const maxPages=integer(input.maxPages,100,1,500),maxRequests=integer(input.maxRequests,maxPages,1,maxPages);
 return{today:window.today,since:window.since,productCode,locationId:location?String(Number(location)):null,page:integer(input.page,1,1,1000000),size:integer(input.size,100,1,100),maxPages,maxRequests,timeoutMs:integer(input.timeoutMs,12000,100,12000),retries:integer(input.retries,2,0,2),baseDelayMs:integer(input.baseDelayMs,400,1,1000)};
}
function params(input={}){
 const n=normalizeInput(input),p=new URLSearchParams({page:String(n.page),size:String(n.size),currency:"EUR",date__gte:n.since,date__lte:n.today,order_by:"-date,-id",duplicate_of__isnull:"true"});
 if(n.productCode)p.set("product_code",n.productCode);if(n.locationId)p.set("location_id",n.locationId);return p;
}
function rejectionReasons(raw,n){
 const reasons=Inventory.rejectionReasons(raw,{...n,locationIds:n.locationId?[Number(n.locationId)]:[]});
 if(raw&&typeof raw==="object"&&n.productCode&&String(raw.product?.code??raw.product_code??"")!==n.productCode)reasons.push("product-outside-scope");
 return[...new Set(reasons)];
}
function nextPage(result={}){const page=Number(result.page||1),pages=Number(result.pages||1);return page<pages?page+1:null}
async function readPayload(res){
 const maxBytes=5*1024*1024;
 if(typeof res.body?.getReader==="function"){
  const reader=res.body.getReader(),chunks=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maxBytes){Promise.resolve(reader.cancel()).catch(()=>{});throw new Error("open-prices-body-too-large")}chunks.push(Buffer.from(part.value))}return JSON.parse(Buffer.concat(chunks,bytes).toString("utf8"))}finally{reader.releaseLock()}
 }
 if(typeof res.text==="function"){const text=await res.text();if(Buffer.byteLength(text,"utf8")>maxBytes)throw new Error("open-prices-body-too-large");return JSON.parse(text)}
 return res.json();
}
async function fetchPage(input={},fetchImpl=fetch){
 const n=normalizeInput(input),url=BASE+"?"+params(n).toString(),started=Date.now();
 // Keep the abort timeout active while consuming the body as well as the headers.
 const bodyFetch=async(u,opts)=>{const res=await fetchImpl(u,opts);if(!res.ok)return res;const payload=await readPayload(res);return{ok:res.ok,status:res.status,headers:res.headers,json:async()=>payload}};
 const res=await Net.request(url,{headers:{Accept:"application/json","User-Agent":"SPARKORB/1.0 Germany price coverage (Open Prices attribution)"}},{fetchImpl:bodyFetch,timeoutMs:n.timeoutMs,retries:n.retries,baseDelayMs:n.baseDelayMs});
 if(!res.ok)throw new Error("open-prices-http-"+res.status);
 const payload=Inventory.validatePage(await res.json(),n.page,n.size),fetchedAt=new Date().toISOString(),accepted=[],rejected=[];
 for(const raw of payload.items){
  const reasons=rejectionReasons(raw,n);if(reasons.length){rejected.push({raw,reasons});continue}
  const result=Provider.adapt([raw],{fetchedAt,sourceUrl:url});accepted.push(...result.accepted);rejected.push(...result.rejected);
 }
 // Preserve the source objects even when the common connector omits OSM or proof metadata.
 return{url,sourceUrl:url,fetchedAt,httpStatus:res.status,durationMs:Date.now()-started,page:payload.page,pages:payload.pages,size:payload.size,total:payload.total,window:{since:n.since,until:n.today},rawItems:payload.items,accepted,rejected};
}
async function fetchAll(input={},fetchImpl=fetch){
 const n=normalizeInput(input),accepted=[],rejected=[],pages=[],rawItems=[];let page=n.page;
 for(let i=0;i<n.maxRequests;i++){
  const r=await fetchPage({...n,page},fetchImpl);pages.push({page:r.page,pages:r.pages,total:r.total,size:r.size,url:r.url});accepted.push(...r.accepted);rejected.push(...r.rejected);rawItems.push(...r.rawItems);
  const next=nextPage(r);if(next==null){page=null;break}page=next;
 }
 return{accepted,rejected,rawItems,pages,fetchedPages:pages.length,total:pages[0]?.total??0,nextPage:page,complete:page==null,sourceUrl:pages[0]?.url||BASE,fetchedAt:new Date().toISOString(),window:{since:n.since,until:n.today}};
}
module.exports={BASE,todayBerlin,normalizeInput,params,rejectionReasons,nextPage,fetchPage,fetchAll};
