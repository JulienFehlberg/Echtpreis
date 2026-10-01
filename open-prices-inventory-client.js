"use strict";
const Net=require("./resilient-fetch"),Identity=require("./product-identity");
const BASE="https://prices.openfoodfacts.org/api/v1/prices",DAY=86400000;
const HEADERS={Accept:"application/json","User-Agent":"SPARKORB/1.0 Germany price inventory (Open Prices attribution)"};
const BERLIN=Object.freeze({lat:52.52,lon:13.405,radiusKm:35,minLat:52.34,maxLat:52.68,minLon:13.09,maxLon:13.76});
function region(value="DE"){if(value==="DE"||value==="Berlin")return value;throw new Error("open-prices-inventory-invalid-region")}
function scopeMetadata(value="DE",locationIds=[]){const selected=region(value);return{country:"DE",region:selected,city:selected==="Berlin"?"Berlin":null,locationType:selected==="Berlin"?"OSM":null,geo:selected==="Berlin"?{lat:BERLIN.lat,lon:BERLIN.lon,radiusKm:BERLIN.radiusKm}:null,locationIds:[...locationIds]}}
function sameGeo(value){return value&&value.lat===BERLIN.lat&&value.lon===BERLIN.lon&&value.radiusKm===BERLIN.radiusKm}
function cursorMatches(cursor,n){return!!cursor&&cursor.since===n.since&&cursor.until===n.today&&String(cursor.locationIds||"")===n.scope&&(cursor.region??"DE")===n.region&&(n.region==="Berlin"?sameGeo(cursor.geo):cursor.geo==null)&&Number.isSafeInteger(cursor.nextPage)&&cursor.nextPage>0}
function validDate(value){return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value}
function integer(value,fallback,min,max){const n=Number(value);return Number.isSafeInteger(n)?Math.min(max,Math.max(min,n)):fallback}
function normalizeInput(input={}){
 const today=input.today||new Date().toISOString().slice(0,10);if(!validDate(today))throw new Error("open-prices-inventory-invalid-today");
 const earliest=new Date(Date.parse(today+"T00:00:00Z")-7*DAY).toISOString().slice(0,10);
 if(input.since!=null&&!validDate(input.since))throw new Error("open-prices-inventory-invalid-since");
 const since=input.since?input.since<earliest?earliest:input.since:earliest;if(since>today)throw new Error("open-prices-inventory-invalid-window");
 const locationIds=Array.isArray(input.locationIds)?[...new Set(input.locationIds.map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))].sort((a,b)=>a-b):[];
 if(input.locationIds!=null&&(!Array.isArray(input.locationIds)||locationIds.length!==new Set(input.locationIds.map(Number)).size||locationIds.length>100))throw new Error("open-prices-inventory-invalid-locations");
 let page=integer(input.page,1,1,1000000);const scope=locationIds.join(","),selectedRegion=region(input.region??"DE");
 if(input.cursor){if(!cursorMatches(input.cursor,{since,today,scope,region:selectedRegion}))throw new Error("open-prices-inventory-invalid-cursor");page=input.cursor.nextPage;}
 return{today,since,locationIds,scope,region:selectedRegion,page,size:integer(input.size,100,1,100),maxPages:integer(input.maxPages,20,1,20),maxItems:integer(input.maxItems,2000,1,2000),timeoutMs:integer(input.timeoutMs,6000,1000,6000),retries:integer(input.retries,1,0,1),baseDelayMs:integer(input.baseDelayMs,150,50,500)};
}
function params(input={}){
 const n=normalizeInput(input),p=new URLSearchParams({page:String(n.page),size:String(n.size),date__gte:n.since,date__lte:n.today,currency:"EUR",order_by:"-date,-id",duplicate_of__isnull:"true"});
 // Native geographic filters bound the Berlin scan. The circle includes nearby
 // Brandenburg, so country, city and coordinates are checked on every row too.
 if(n.region==="Berlin"){p.set("lat",String(BERLIN.lat));p.set("lon",String(BERLIN.lon));p.set("radius_km",String(BERLIN.radiusKm));p.set("location__type","OSM")}
 if(n.locationIds.length)p.set("location_id__in",n.scope);return p;
}
function germanLocation(location={}){
 const code=String(location.osm_address_country_code||location.country_code||"").trim().toUpperCase();
 if(code)return code==="DE";
 return["deutschland","germany","bundesrepublik deutschland","de"].includes(String(location.osm_address_country||location.country||"").trim().toLowerCase());
}
function coordinate(value,min,max){if(value==null||value===""||typeof value==="boolean"||typeof value!=="number"&&typeof value!=="string"||typeof value==="string"&&!value.trim())return false;const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max}
function berlinLocation(location={}){
 return germanLocation(location)&&location.type==="OSM"&&String(location.osm_address_city||"").trim().toLowerCase()==="berlin"&&coordinate(location.osm_lat,BERLIN.minLat,BERLIN.maxLat)&&coordinate(location.osm_lon,BERLIN.minLon,BERLIN.maxLon);
}
function rejectionReasons(row,n){
 const reasons=[];if(!row||typeof row!=="object"||Array.isArray(row))return["invalid-row"];
 if(!Number.isSafeInteger(row.id)||row.id<=0)reasons.push("invalid-id");
 if(!germanLocation(row.location||{}))reasons.push("country-outside-DE");
 if(n.region==="Berlin"&&!berlinLocation(row.location||{}))reasons.push("location-outside-Berlin");
 if(n.locationIds.length&&!n.locationIds.includes(Number(row.location_id||row.location?.id)))reasons.push("location-outside-scope");
 if(!validDate(row.date)||row.date<n.since||row.date>n.today)reasons.push("date-outside-window");
 if(row.currency!=="EUR")reasons.push("unsupported-currency");
 if((typeof row.price!=="number"&&typeof row.price!=="string")||!String(row.price).trim()||!Number.isFinite(Number(row.price))||Number(row.price)<=0||Number(row.price)>=10000000)reasons.push("invalid-price");
 if(row.duplicate_of!=null)reasons.push("source-duplicate");return reasons;
}
function validatePage(payload,page,size){
 if(!payload||!Array.isArray(payload.items)||payload.items.length>size||!Number.isSafeInteger(payload.page)||payload.page!==page||!Number.isSafeInteger(payload.pages)||payload.pages<1||!Number.isSafeInteger(payload.total)||payload.total<0||!Number.isSafeInteger(payload.size)||payload.size<1||payload.size>100)throw new Error("open-prices-inventory-invalid-pagination");
 return payload;
}
async function readPayload(res){
 const maxBytes=5*1024*1024;
 if(typeof res.body?.getReader==="function"){
  const reader=res.body.getReader(),chunks=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maxBytes){Promise.resolve(reader.cancel()).catch(()=>{});throw new Error("open-prices-inventory-body-too-large")}chunks.push(Buffer.from(part.value))}return JSON.parse(Buffer.concat(chunks,bytes).toString("utf8"))}finally{reader.releaseLock()}
 }
 if(typeof res.text==="function"){const text=await res.text();if(Buffer.byteLength(text,"utf8")>maxBytes)throw new Error("open-prices-inventory-body-too-large");return JSON.parse(text)}
 return res.json();
}
async function fetchPage(input={},fetchImpl=fetch){
 const n=normalizeInput(input),url=BASE+"?"+params(n).toString(),started=Date.now();
 // Read the response while resilient-fetch's AbortController is active, so
 // the timeout also bounds a stalled JSON body instead of only the headers.
 const bodyFetch=async(u,opts)=>{const res=await fetchImpl(u,opts);if(!res.ok)return res;const payload=await readPayload(res);return{ok:res.ok,status:res.status,headers:res.headers,json:async()=>payload}};
 const res=await Net.request(url,{headers:HEADERS},{fetchImpl:bodyFetch,timeoutMs:n.timeoutMs,retries:n.retries,baseDelayMs:n.baseDelayMs,maxDelayMs:500});
 if(!res.ok)throw new Error("open-prices-inventory-http-"+res.status);
 const payload=validatePage(await res.json(),n.page,n.size);
 return{...payload,url,httpStatus:res.status,durationMs:Date.now()-started};
}
function coverage(items){
 const productCodes=new Set(),locations=new Set(),proofs=new Set(),pricePer={},discounts={};let withName=0,withPack=0,withProof=0,withProofHash=0,withGtin=0;
 for(const row of items){const product=row.product||{},code=String(product.code||row.product_code||"");if(code)productCodes.add(code);if(/^\d+$/.test(code)&&Identity.gtinValid(code))withGtin++;if(String(product.product_name||row.product_name||"").trim())withName++;if(Identity.parsePack(product.quantity||"")||Number.isFinite(Number(product.product_quantity))&&Number(product.product_quantity)>0&&["g","kg","ml","cl","l","piece"].includes(String(product.product_quantity_unit||"").toLowerCase()))withPack++;
 if(Number.isSafeInteger(row.location_id)&&row.location_id>0)locations.add(row.location_id);if(Number.isSafeInteger(row.proof_id)&&row.proof_id>0&&row.proof?.id===row.proof_id){withProof++;proofs.add(row.proof_id)}if(/^[a-f0-9]{32}$/i.test(row.proof?.image_md5_hash||""))withProofHash++;const per=row.price_per||"PACK",discount=row.discount_type||"NONE";pricePer[per]=(pricePer[per]||0)+1;discounts[discount]=(discounts[discount]||0)+1;}
 return{prices:items.length,products:productCodes.size,locations:locations.size,proofs:proofs.size,withGtin,withName,withPack,withProof,withProofHash,pricePer,discounts};
}
async function fetchInventory(input={},fetchImpl=fetch){
 const n=normalizeInput(input),items=[],rejected=[],pages=[],seen=new Set();let page=n.page,total=0,complete=false,error=null;
 for(let request=0;request<n.maxPages;request++){
  let result;try{result=await fetchPage({...n,page},fetchImpl)}catch(e){error=String(e?.message||"open-prices-inventory-fetch-failed");break}
  total=result.total;pages.push({page:result.page,pages:result.pages,size:result.items.length,total:result.total,url:result.url});
  for(const row of result.items){const reasons=rejectionReasons(row,n);if(seen.has(row?.id))reasons.push("duplicate-id");if(Number.isSafeInteger(row?.id))seen.add(row.id);if(reasons.length)rejected.push({id:row?.id??null,reasons});else items.push(row)}
  if(page>=result.pages){complete=true;page=null;break}page++;
  // Stop after a complete page so a continuation never loses the remainder.
  if(items.length>=n.maxItems)break;
 }
 const selectedScope=scopeMetadata(n.region,n.locationIds),cursor=page==null?null:{nextPage:page,since:n.since,until:n.today,locationIds:n.scope,region:n.region,geo:selectedScope.geo};
 return{ok:error===null,items,rejected,received:pages.reduce((s,p)=>s+p.size,0),total,pages,fetchedPages:pages.length,nextPage:page,cursor,complete,partial:!complete,error,sourceUrl:BASE,fetchedAt:new Date().toISOString(),country:"DE",scope:selectedScope,window:{since:n.since,until:n.today},coverage:coverage(items)};
}
module.exports={BASE,BERLIN,region,scopeMetadata,sameGeo,cursorMatches,validDate,normalizeInput,params,germanLocation,berlinLocation,rejectionReasons,validatePage,fetchPage,fetchInventory,fetchAll:fetchInventory,coverage};
