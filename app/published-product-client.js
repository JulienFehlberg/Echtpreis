(function(root){
"use strict";
const Current=typeof module==="object"&&module.exports?require("./current-price-client"):root.SparkorbCurrentPriceClient;
const text=value=>typeof value==="string"?value.trim():"";
function amount(value,unit){
 if(typeof value!=="number"||!Number.isFinite(value)||value<=0)return null;
 const units={g:["g",1],kg:["g",1000],ml:["ml",1],cl:["ml",10],l:["ml",1000],piece:["piece",1],"stück":["piece",1],stk:["piece",1]},entry=units[text(unit).toLowerCase()];
 return entry&&Number.isFinite(value*entry[1])?{amount:value*entry[1],unit:entry[0]}:null;
}
function pack(raw){
 const match=text(raw).toLowerCase().match(/^(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l|piece|stk|stück)$/);if(!match)return null;
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
function candidate(raw,options={}){
 const identity=selection(raw);if(!identity||!Current||!Array.isArray(raw.offers)||raw.offers.length>200)return null;
 const offers=raw.offers.map(offer=>Current.normalizePublishedAlternative(offer,{gtin:identity.gtin,pack:identity.pack},options)).filter(Boolean);
 return offers.length?{...identity,offers}:null;
}
function normalizeResponse(raw,options={}){
 if(!raw||raw.ok!==true||!Array.isArray(raw.items)||raw.items.length>20||raw.items.reduce((sum,item)=>sum+(Array.isArray(item?.offers)?item.offers.length:0),0)>200)return{ok:false,items:[],reason:"invalid-response"};
 const rows=new Map(),duplicates=new Set();for(const input of raw.items){const value=candidate(input,options);if(!value)continue;const id=key(value);if(rows.has(id))duplicates.add(id);rows.set(id,value);}
 return{ok:true,items:[...rows].filter(([id])=>!duplicates.has(id)).map(([,value])=>value),discoveryTruncated:raw.discoveryTruncated===true};
}
function create(options={}){
 const apiBase=text(options.apiBase).replace(/\/+$/,""),fetchImpl=options.fetchImpl||root.fetch?.bind(root),now=typeof options.now==="function"?options.now:Date.now;
 async function search(raw,{signal}={}){
  const query=text(raw);if(query.length<2||query.length>120||typeof fetchImpl!=="function")return{ok:false,items:[],reason:"invalid-search"};
  const controller=new AbortController(),abort=()=>controller.abort(),timeout=Number(options.timeoutMs)||8000;let timer;
  if(signal?.aborted)return{ok:false,items:[],reason:"cancelled"};signal?.addEventListener("abort",abort,{once:true});
  try{
   const result=await Promise.race([
    Promise.resolve().then(async()=>{const response=await fetchImpl(apiBase+"/v1/published-products?search="+encodeURIComponent(query)+"&limit=20",{method:"GET",credentials:"omit",signal:controller.signal});if(!response?.ok)throw Error("unavailable");return response.json();}),
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error("timeout"));},Math.max(1,Math.min(10000,timeout)));})
   ]);
   if(controller.signal.aborted)return{ok:false,items:[],reason:"cancelled"};
   return normalizeResponse(result,{now:now()});
  }catch(_){return{ok:false,items:[],reason:controller.signal.aborted?"cancelled":"unavailable"};}
  finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
 }
 return Object.freeze({search});
}
const api=Object.freeze({create,selection,key,candidate,normalizeResponse});
if(root)root.SparkorbPublishedProductClient=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
