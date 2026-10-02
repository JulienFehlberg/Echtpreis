"use strict";
// Fully synthetic local HTTP bodies. Never use these prices/captures as live evidence.
const crypto=require("node:crypto"),assert=require("node:assert/strict"),Probe=require("../../hit-native-brand-partition"),Native=require("../../hit-assortment-client");
const NOW=Date.parse("2026-10-02T05:40:00.125Z"),clone=structuredClone;
const attr=value=>JSON.stringify(value).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const node=()=>({id:"4261891",name:"SYNTHETIC native leaf",url:"https://www.hit.de/sortiment/synthetic-category-4261891",level:3,count:80,order:231,parentId:"4261298",observedChildIds:[],evidence:"native-assortment-filters"});
const sku=index=>String(index).padStart(18,"0")+"ST";
function row(index=1){const base="4000000"+String(index).padStart(5,"0"),sum=[...base].reduce((n,char,i)=>n+Number(char)*(i%2?3:1),0);return{external_id:sku(index),ean:base+(10-sum%10)%10,storeId:1775,storeNumber:"258",headline:"SYNTHETIC product "+index,overview:"500g Packung",price:"1.25",deposit:null,url:node().url+"/synthetic-product-"+sku(index),priceTag:{type:"standard",badgeText:null,priceEuro:"1",priceCent:"25",priceStrikeThroughText:null,beforeText:null,belowText:null,couponCode:null,couponName:null}};}
function page({filtered=false,now=NOW,total=filtered?12:80,rows=filtered?[1,2,3,4,41,42,43,44,45,46,47,48].map(row):Array.from({length:40},(_,i)=>row(i+1)),category=node(),edit=()=>{},patchMeta={},transform=body=>body}={}){
 const data={status:200,data:clone(rows),pagination:{page:0,limit:40,total},meta:{is_exact_match:true,category:{id:category.id,name:category.name,url:new URL(category.url).pathname,level:category.level,count:total}},filters:{categories:[{...category,count:total}],brands:filtered?[]:[{id:"SYNTHETIC A",key:"SYNTHETIC A",label:"SYNTHETIC native facet",count:12}]}};
 const params={for_store:1775,for_category:category.id,limit:40,return_exact_match:"1",...(filtered?{for_brands:"SYNTHETIC A"}:{})};edit(data,params);
 const body=transform('<html><head data-store="258" data-store-id="1775" data-hit-konto="" data-hit-admin=""></head><body><div data-component="assortment/list" data-data="'+attr(data)+'" data-params="'+attr(params)+'"></div></body></html>');
 const url=new URL(category.url);if(filtered){url.search="";url.searchParams.set("for_store","1775");url.searchParams.set("for_category",category.id);url.searchParams.set("for_brands","SYNTHETIC A");}
 const meta={storeProfile:{...Probe.STORE},capturedAt:new Date(now).toISOString(),responseDate:new Date(now).toUTCString(),responseAgeSeconds:0,sourceResponseHash:crypto.createHash("sha256").update(body).digest("hex"),sourceResponseUrl:url.href,requestUrl:url.href,responseStatus:200,responseContentType:"text/html; charset=UTF-8",responseBytes:Buffer.byteLength(body),responseAgeRaw:"0",redirects:[],anonymous:true,retried:false,...patchMeta};
 return{body,meta};
}
function state(rows=[],meta=page().meta){const seenQuotes={};for(const raw of rows){const parsed=Native.parseRow(raw,meta);assert(parsed.ok,JSON.stringify(parsed));const c=parsed.candidate,key=[c.gtin,c.normalizedPack.unit,c.normalizedPack.amount/c.packCount,c.packCount].join("|");seenQuotes[key]={gtin:c.gtin,signature:crypto.createHash("sha256").update(JSON.stringify([c.name,c.priceCents,c.depositCents,c.nativePriceType])).digest("hex")};}return{seenQuotes,conflictGtins:[]};}
function control(options={}){const capture=page(options),nativeState=options.nativeState??state(Array.from({length:40},(_,i)=>row(i+1)),capture.meta),token=Probe.prepareControl(capture.body,capture.meta,options.node??node(),{now:options.now??NOW,nativeState});return{...capture,token,nativeState};}
function record(options={}){const prepared=control(options.control??{});return Probe.record(prepared.token,options.error?{error:options.error}:{filtered:page({filtered:true,...options.filtered})},{now:options.now??NOW});}
module.exports={NOW,clone,node,sku,row,page,state,control,record};
