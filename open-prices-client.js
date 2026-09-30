"use strict";
const Provider=require("./providers/open-prices");
const BASE="https://prices.openfoodfacts.org/api/v1/prices";
function params(input={}){
 const p=new URLSearchParams();p.set("page",String(Math.max(1,Number(input.page)||1)));p.set("size",String(Math.min(100,Math.max(1,Number(input.size)||50))));
 if(input.productCode)p.set("product_code",String(input.productCode).replace(/\D/g,""));
 if(input.locationId)p.set("location_id",String(input.locationId));
 return p;
}
function nextPage(result={}){const page=Number(result.page||1),pages=Number(result.pages||1);return page<pages?page+1:null}
async function fetchPage(input={},fetchImpl=fetch){
 const url=BASE+"?"+params(input).toString(),started=Date.now();
 const res=await fetchImpl(url,{headers:{"Accept":"application/json","User-Agent":"ECHTPREIS/1.0 price-research"}});
 if(!res.ok)throw new Error("open-prices-http-"+res.status);
 const payload=await res.json(),adapted=Provider.adapt(payload,{fetchedAt:new Date().toISOString(),sourceUrl:url});
 return{url,httpStatus:res.status,durationMs:Date.now()-started,page:Number(payload.page||input.page||1),pages:Number(payload.pages||1),size:Number(payload.size||0),total:Number(payload.total||0),...adapted};
}
async function fetchAll(input={},fetchImpl=fetch){const maxPages=Math.max(1,Math.min(500,Number(input.maxPages)||100)),accepted=[],rejected=[],pages=[];let page=Math.max(1,Number(input.page)||1);for(let i=0;i<maxPages;i++){const r=await fetchPage({...input,page},fetchImpl);pages.push({page:r.page,total:r.total,size:r.size,url:r.url});accepted.push(...(r.accepted||[]));rejected.push(...(r.rejected||[]));const n=nextPage(r);if(!n)break;page=n}return{accepted,rejected,pages,fetchedPages:pages.length,total:pages[0]?.total||accepted.length}}
module.exports={BASE,params,nextPage,fetchPage,fetchAll};
