"use strict";

const crypto=require("node:crypto"),Identity=require("./product-identity");
const SOURCE="HIT Berlin store assortment",MAX_BYTES=6*1024*1024,MAX_ROWS=4000,FRESH_MS=300000,TTL_MS=86400000;
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
const object=value=>value&&typeof value==="object"&&!Array.isArray(value);
const fail=code=>Object.assign(new Error(code),{code});
function text(value,max=300){return typeof value==="string"&&value.trim().length<=max?value.trim().replace(/\s+/g," "):""}
function iso(value){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))return null;const t=Date.parse(value);return Number.isFinite(t)&&new Date(t).toISOString().replace(/\.000Z$/,"Z")===value.replace(/\.000Z$/,"Z")?new Date(t).toISOString():null}
function profile(value){
 if(!object(value)||!Number.isSafeInteger(value.storeId)||value.storeId<=0||typeof value.storeNumber!=="string"||!/^\d{1,6}$/.test(value.storeNumber)||!text(value.name,120)||value.city!=="Berlin"||value.country!=="DE")throw fail("hit-explicit-berlin-store-profile-required");
 return{storeId:value.storeId,storeNumber:value.storeNumber,name:text(value.name,120),city:"Berlin",country:"DE"};
}
function sourceUrl(value,store){
 if(typeof value!=="string"||/[\\\r\n\t]/.test(value))throw fail("hit-source-url-not-allowed");
 let url;try{url=new URL(value)}catch{throw fail("hit-source-url-not-allowed")}
 if(url.protocol!=="https:"||!["www.hit.de","hit.de"].includes(url.hostname)||url.port||url.username||url.password||url.hash||!/^\/sortiment(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(url.pathname)||url.searchParams.getAll("markt").length>1||url.searchParams.has("markt")&&url.searchParams.get("markt")!==store.storeNumber)throw fail("hit-source-url-not-allowed");
 return url.href;
}
function productUrl(value,sku,store){
 const url=new URL(sourceUrl(value,store));
 if(!/^[0-9]{1,24}[A-Z]{1,3}$/.test(sku)||!url.pathname.endsWith("-"+sku)||url.pathname.split("/").length<4||[...url.searchParams.keys()].some(key=>key!=="markt"))throw fail("hit-native-product-url-sku-conflict");
 const nativeUrl=url.href;if(!url.searchParams.has("markt"))url.searchParams.set("markt",store.storeNumber);
 return{nativeUrl,sourceUrl:url.href};
}
function proof(meta){
 if(!object(meta))throw fail("hit-source-proof-required");
 const store=profile(meta.storeProfile),capturedAt=iso(meta.capturedAt),at=Date.parse(capturedAt);
 if(!capturedAt||at>Date.now()+FRESH_MS)throw fail("hit-real-capture-time-required");
 let responseDate=null;
 if(typeof meta.responseDate==="string"){
  if(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(meta.responseDate)&&new Date(meta.responseDate).toUTCString()===meta.responseDate)responseDate=new Date(meta.responseDate).toISOString();
  else responseDate=iso(meta.responseDate);
 }
 if(!responseDate||Math.abs(Date.parse(responseDate)-at)>FRESH_MS)throw fail("hit-source-response-date-stale-or-invalid");
 if(meta.responseAgeSeconds!==null&&(!Number.isSafeInteger(meta.responseAgeSeconds)||meta.responseAgeSeconds<0||meta.responseAgeSeconds>300))throw fail("hit-source-cache-age-stale-or-invalid");
 if(!/^[a-f0-9]{64}$/.test(meta.sourceResponseHash||""))throw fail("hit-source-response-hash-required");
 return{store,capturedAt,responseDate,responseAgeSeconds:meta.responseAgeSeconds,sourceResponseHash:meta.sourceResponseHash,sourceResponseUrl:sourceUrl(meta.sourceResponseUrl,store)};
}
function cents(value){
 if(typeof value==="string"){
  if(!/^(?:0|[1-9]\d{0,3})(?:[.,]\d{1,2})?$/.test(value))return null;
  const [whole,fraction=""]=value.replace(",",".").split(".");return Number(whole)*100+Number(fraction.padEnd(2,"0"));
 }
 if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>9999.99)return null;
 const n=Math.round(value*100);return Number.isSafeInteger(n)&&Math.abs(value*100-n)<1e-7?n:null;
}
function exactPack(value){
 if(typeof value!=="string"||value.length>100)return null;
 const raw=value.trim(),match=raw.match(/^(?:(\d{1,4})\s*[x×]\s*)?(\d{1,7}(?:[.,]\d{1,3})?)\s*(kg|kilogramm|g|gramm|ml|milliliter|cl|l|liter|st[uü]ck|stk\.?|st\.?|eier|rollen|piece)(?:\s+(?:Packung(?:en)?|Beutel|Becher|Dose(?:n)?|Flasche(?:n)?|Karton|Glas|Gläser|Tube|Schale|Netz|Bund|Box|Multipack))?$/i);
 if(!match)return null;
 const amount=Number(match[2].replace(",",".")),count=match[1]?Number(match[1]):1;
 const units={kilogramm:"kg",gramm:"g",liter:"l",milliliter:"ml","stück":"piece",stuck:"piece",stk:"piece","stk.":"piece",st:"piece","st.":"piece",eier:"piece",rollen:"piece"},unit=units[match[3].toLowerCase()]||match[3].toLowerCase();
 const multiplier={kg:1000,g:1,l:1000,ml:1,cl:10,piece:1}[unit],total=amount*count*multiplier;
 if(!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(count)||count<1||count>1000||!Number.isFinite(total)||total>1e9||unit==="piece"&&!Number.isSafeInteger(amount))return null;
 return{amount,unit,count,total:{amount:total,unit:["kg","g"].includes(unit)?"g":unit==="piece"?"piece":"ml"}};
}
const entities=Object.freeze({quot:'"',apos:"'",amp:"&",lt:"<",gt:">",nbsp:"\u00a0",euro:"€",times:"×",auml:"ä",ouml:"ö",uuml:"ü",Auml:"Ä",Ouml:"Ö",Uuml:"Ü",szlig:"ß",rsquo:"’",lsquo:"‘",ldquo:"“",rdquo:"”",ndash:"–",mdash:"—"});
function decode(value){return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi,(_whole,key)=>{
 if(key[0]!=="#"){if(!Object.hasOwn(entities,key))throw fail("hit-native-html-entity-invalid");return entities[key]}
 const n=key[1].toLowerCase()==="x"?parseInt(key.slice(2),16):Number(key.slice(1));if(!Number.isInteger(n)||n<1||n>0x10ffff||n>=0xd800&&n<=0xdfff)throw fail("hit-native-html-entity-invalid");return String.fromCodePoint(n);
})}
function extractRows(html){
 if(typeof html!=="string"||Buffer.byteLength(html)>MAX_BYTES)throw fail("hit-page-body-invalid-or-too-large");
 const cleaned=html.replace(/<!--[\s\S]*?-->/g,"").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,"");
 const leaflets=[],lists=[];
 for(const tag of cleaned.matchAll(/<([a-z][a-z\d:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)){
  const attrs=new Map();let duplicate=false;
  for(const attr of tag[2].matchAll(/([a-z_:][a-z\d_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)){const key=attr[1].toLowerCase();if(attrs.has(key))duplicate=true;attrs.set(key,attr[2]??attr[3]);}
  if(attrs.has("data-leaflet")){if(duplicate)throw fail("hit-duplicate-native-attribute");leaflets.push(attrs.get("data-leaflet"))}
  if(attrs.get("data-component")==="assortment/list"){
   if(duplicate||!attrs.has("data-data"))throw fail("hit-native-list-schema-invalid");
   let data,params;try{data=JSON.parse(decode(attrs.get("data-data")));params=attrs.has("data-params")?JSON.parse(decode(attrs.get("data-params"))):null}catch{throw fail("hit-native-list-schema-invalid")}
   if(!object(data)||data.status!==200||!Array.isArray(data.data)||!object(data.pagination)||!Number.isSafeInteger(data.pagination.page)||data.pagination.page<0||!Number.isSafeInteger(data.pagination.limit)||data.pagination.limit<1||data.pagination.limit>MAX_ROWS||!Number.isSafeInteger(data.pagination.total)||data.pagination.total<0||!Number.isSafeInteger(data.pagination.page*data.pagination.limit)||data.data.length!==Math.min(data.pagination.limit,data.pagination.total-data.pagination.page*data.pagination.limit))throw fail("hit-native-list-schema-invalid");
   lists.push({rows:data.data,pagination:{page:data.pagination.page,limit:data.pagination.limit,total:data.pagination.total},params});
  }
 }
 if(lists.length>1)throw fail("hit-multiple-native-lists-unresolved");
 if(lists.length){if(lists[0].rows.length>MAX_ROWS)throw fail("hit-page-row-bound-exceeded");return{...lists[0],kind:"assortment-list",errors:[]}}
 if(leaflets.length>MAX_ROWS)throw fail("hit-page-row-bound-exceeded");
 const rows=[],errors=[];for(const [index,value]of leaflets.entries()){try{rows.push(JSON.parse(decode(value)))}catch{errors.push({index,retailerSku:null,reasons:["hit-native-row-json-invalid"]})}}
 return{rows,pagination:null,params:null,kind:"product-leaflet",errors};
}
function categoryLocation(value,base,market=null){
 if(typeof value!=="string"||value!==value.trim()||value.length>1000||/[\\%\r\n\t]/.test(value)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(value)||!(value.startsWith("/sortiment/")||/^https:\/\/(?:www\.)?hit\.de\//.test(value)))throw fail("hit-native-category-url-not-allowed");
 let url;try{url=new URL(value,base)}catch{throw fail("hit-native-category-url-not-allowed")}
 const match=url.pathname.match(/^\/sortiment\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*-([1-9]\d{0,11})\/?$/);
 if(url.protocol!=="https:"||!["www.hit.de","hit.de"].includes(url.hostname)||url.port||url.username||url.password||url.hash||!match||[...url.searchParams.keys()].some(key=>key!=="markt")||url.searchParams.getAll("markt").length>1||url.searchParams.has("markt")&&(!/^[1-9]\d{0,5}$/.test(url.searchParams.get("markt"))||market==null||url.searchParams.get("markt")!==market))throw fail("hit-native-category-url-not-allowed");
 return{id:match[1],url:url.href,topLevel:url.pathname.split("/").filter(Boolean).length===2};
}
function extractCategories(html,source){
 if(typeof html!=="string"||Buffer.byteLength(html)>MAX_BYTES)throw fail("hit-page-body-invalid-or-too-large");
 if(typeof source!=="string"||source!==source.trim()||/[\\\r\n\t]/.test(source))throw fail("hit-category-source-url-not-allowed");
 let base;try{base=new URL(source)}catch{throw fail("hit-category-source-url-not-allowed")}
 if(base.protocol!=="https:"||!["www.hit.de","hit.de"].includes(base.hostname)||base.port||base.username||base.password||base.hash||!/^\/sortiment(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(base.pathname)||/-\d+[A-Z]{1,3}\/?$/.test(base.pathname)||[...base.searchParams.keys()].some(key=>!["markt","page"].includes(key))||base.searchParams.getAll("markt").length>1||base.searchParams.getAll("page").length>1||base.searchParams.has("markt")&&!/^[1-9]\d{0,5}$/.test(base.searchParams.get("markt"))||base.searchParams.has("page")&&!/^\d{1,5}$/.test(base.searchParams.get("page")))throw fail("hit-category-source-url-not-allowed");
 const extracted=extractRows(html),cleaned=html.replace(/<!--[\s\S]*?-->/g,"").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,"");
 const rejected=[],filters=[],navigation=[];let data=null;
 for(const tag of cleaned.matchAll(/<([a-z][a-z\d:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)){
  const attrs=new Map();let duplicate=false;for(const attr of tag[2].matchAll(/([a-z_:][a-z\d_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)){const key=attr[1].toLowerCase();if(attrs.has(key))duplicate=true;attrs.set(key,attr[2]??attr[3]);}
  if(attrs.get("data-component")==="assortment/list"){if(duplicate)throw fail("hit-duplicate-native-attribute");try{data=JSON.parse(decode(attrs.get("data-data")))}catch{throw fail("hit-native-category-filters-schema-invalid")}}
 }
 if(data?.filters!=null&&(!object(data.filters)||data.filters.categories!=null&&!Array.isArray(data.filters.categories)))throw fail("hit-native-category-filters-schema-invalid");
 const rawCategories=data?.filters?.categories??[];if(rawCategories.length>MAX_ROWS)throw fail("hit-native-category-bound-exceeded");
 let nativeStoreId=null,currentCategoryId=null;
 if(extracted.kind==="assortment-list"){
  if(extracted.params?.for_store!=null){if(!Number.isSafeInteger(extracted.params.for_store)||extracted.params.for_store<=0)throw fail("hit-native-category-store-context-conflict");nativeStoreId=extracted.params.for_store}
  if(extracted.params?.for_category!=null){const id=String(extracted.params.for_category);if(!/^[1-9]\d{0,11}$/.test(id))throw fail("hit-native-category-context-conflict");currentCategoryId=id}
  if(data.meta?.category!=null){const meta=data.meta.category,id=String(meta?.id);if(!object(meta)||!/^[1-9]\d{0,11}$/.test(id)||currentCategoryId&&id!==currentCategoryId)throw fail("hit-native-category-context-conflict");currentCategoryId=id}
  const sourceId=base.pathname.match(/-([1-9]\d{0,11})\/?$/)?.[1];if(sourceId&&currentCategoryId&&sourceId!==currentCategoryId)throw fail("hit-native-category-context-conflict");
 }
 const nativeMarkets=[...new Set(extracted.rows.map(row=>row?.storeNumber).filter(value=>typeof value==="string"&&/^[1-9]\d{0,5}$/.test(value)))],sourceMarket=base.searchParams.get("markt");
 if(sourceMarket&&nativeMarkets.length===1&&sourceMarket!==nativeMarkets[0])throw fail("hit-native-category-store-context-conflict");
 const market=sourceMarket??(nativeMarkets.length===1?nativeMarkets[0]:null),stack=[];
 for(const [index,raw]of rawCategories.entries()){
  const level=raw?.level;for(let n=Number.isInteger(level)&&level>=1&&level<=3?level:1;n<stack.length;n++)delete stack[n];
  try{
   const id=typeof raw?.id==="number"&&Number.isSafeInteger(raw.id)?String(raw.id):raw?.id,name=text(raw?.name),count=raw?.count??null,order=raw?.order??null;
   if(!object(raw)||typeof id!=="string"||!/^[1-9]\d{0,11}$/.test(id)||!name||/[\u0000-\u001f\u007f\ufffd<>]/.test(name)||![1,2,3].includes(level)||count!==null&&(!Number.isSafeInteger(count)||count<0)||order!==null&&(!Number.isSafeInteger(order)||order<0))throw fail("hit-native-category-metadata-invalid");
   const location=categoryLocation(raw.url,base.href,market);if(location.id!==id)throw fail("hit-native-category-url-id-conflict");
   const parent=stack[level-1],entry={id,name,url:location.url,level,count,order,parentId:parent&&parent.order!==null&&order!==null&&parent.order<order?parent.id:null,observedChildIds:[],evidence:"native-assortment-filters"};filters.push(entry);stack[level]=entry;
  }catch(error){rejected.push({index,id:raw?.id??null,reasons:[error.code||"hit-native-category-metadata-invalid"]})}
 }
 for(const [index,tag]of [...cleaned.matchAll(/<a\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/a\s*>/gi)].entries()){
  const attrs=new Map();let duplicate=false;for(const attr of tag[1].matchAll(/([a-z_:][a-z\d_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)){const key=attr[1].toLowerCase();if(attrs.has(key))duplicate=true;attrs.set(key,attr[2]??attr[3]);}
  if(!(attrs.get("class")||"").split(/\s+/).includes("ga_filter_assortment_category"))continue;
  try{
   if(duplicate)throw fail("hit-duplicate-native-attribute");const location=categoryLocation(decode(attrs.get("href")||""),base.href,market),labels=[...tag[2].matchAll(/<span\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/span\s*>/gi)].filter(match=>/\bhit-font-h5\b/.test(match[1])),label=labels.length===1?labels[0][2]:tag[2],name=text(decode(label.replace(/<[^>]*>/g," ")));
   if(!location.topLevel||!name||/[\u0000-\u001f\u007f\ufffd<>]/.test(name))throw fail("hit-native-category-navigation-invalid");
   navigation.push({id:location.id,name,url:location.url,level:1,count:null,order:null,parentId:null,observedChildIds:[],evidence:"native-navigation-link"});
   if(filters.length+navigation.length>MAX_ROWS)throw fail("hit-native-category-bound-exceeded");
  }catch(error){if(error.code==="hit-native-category-bound-exceeded")throw error;rejected.push({index,id:null,reasons:[error.code||"hit-native-category-navigation-invalid"]})}
 }
 const groups=new Map();for(const entry of filters){const entries=groups.get(entry.id)||[];entries.push(entry);groups.set(entry.id,entries)}const conflicts=new Set([...groups].filter(([,entries])=>new Set(entries.map(e=>JSON.stringify([e.name,e.url,e.level,e.count,e.order,e.parentId]))).size>1).map(([id])=>id));
 const byId=new Map();for(const entry of filters){if(conflicts.has(entry.id)){rejected.push({id:entry.id,index:null,reasons:["hit-conflicting-native-category-metadata"]});continue}if(!byId.has(entry.id))byId.set(entry.id,entry)}
 for(const entry of navigation)if(!conflicts.has(entry.id)&&!byId.has(entry.id))byId.set(entry.id,entry);
 for(const entry of byId.values()){const parent=entry.parentId&&byId.get(entry.parentId);if(parent)parent.observedChildIds.push(entry.id);else entry.parentId=null}
 return{categories:[...byId.values()],rejected,nativePagination:extracted.pagination,currentCategoryId,nativeStoreId,categoryTreeComplete:false,assortmentComplete:false};
}
function parseNativeRow(raw,p){
 const reasons=[];
 if(!object(raw))return{ok:false,retailerSku:null,reasons:["hit-native-row-schema-invalid"]};
 const retailerSku=typeof raw.external_id==="string"?raw.external_id:null,name=text(raw.headline),pack=text(raw.overview,100),parsed=exactPack(raw.overview),gtin=typeof raw.ean==="string"?raw.ean:null,brand=raw.brand==null?null:text(raw.brand,120)||null;
 if(raw.storeId!==p.store.storeId||raw.storeNumber!==p.store.storeNumber)reasons.push("hit-native-store-identity-conflict");
 if(!retailerSku||!/^\d{1,24}[A-Z]{1,3}$/.test(retailerSku))reasons.push("hit-native-sku-required");
 if(!gtin||!/^\d{8}$|^\d{12,14}$/.test(gtin)||!Identity.gtinValid(gtin))reasons.push("hit-valid-native-main-gtin-required");
 if(!name||/[\u0000-\u001f\u007f\ufffd<>]/.test(name))reasons.push("hit-native-product-name-required");
 if(!parsed)reasons.push("hit-exact-native-sales-pack-required");
 if(/verschiedene\s+(?:sorten|varianten|ausf[uü]hrungen)|je\s+nach|\boder\b|\S\s*\/\s*\S/i.test(name)||raw.packageVariants!=null&&(!Array.isArray(raw.packageVariants)||raw.packageVariants.length)||raw.variantArticles!=null&&(!Array.isArray(raw.variantArticles)||raw.variantArticles.length))reasons.push("hit-product-variant-unresolved");
 let urls;try{urls=productUrl(raw.url,retailerSku||"",p.store)}catch(error){reasons.push(error.code)}
 const native=raw.priceTag,priceCents=cents(raw.price),depositCents=raw.deposit==null?null:cents(raw.deposit);
 if(priceCents==null||priceCents<=0)reasons.push("hit-current-pack-price-required");
 if(raw.deposit!=null&&depositCents==null)reasons.push("hit-native-deposit-invalid");
 const standard=object(native)&&native.type==="standard"&&(native.badgeText==null||native.badgeText===""),permanent=object(native)&&native.type==="discount"&&text(native.badgeText,100)==="DAUER DISCOUNT PREIS";
 if(!standard&&!permanent)reasons.push("hit-unconditional-normal-price-tag-required");
 const tagEuro=object(native)&&typeof native.priceEuro==="string"&&/^(?:0|[1-9]\d{0,3})$/.test(native.priceEuro)?Number(native.priceEuro):null;
 const tagCent=object(native)&&typeof native.priceCent==="string"&&/^(?:\d{2}|-)$/.test(native.priceCent)?native.priceCent==="-"?0:Number(native.priceCent):null;
 if(tagEuro==null||tagCent==null||priceCents!==tagEuro*100+tagCent)reasons.push("hit-native-price-tag-cents-conflict");
 const conditional=[raw.stringBeforePrice,raw.stringBelowPrice,native?.beforeText,native?.belowText,native?.priceBelowText,native?.badgeBeforeText,native?.badgeBelowText,native?.inset,raw.inset].filter(v=>v!=null&&v!=="");
 if(conditional.some(v=>typeof v!=="string"||/\b(?:app|coupon|gutschein|uvp|vorwoche|rabatt|aktion|angebot|g[uü]ltig\s+bis|mit\s+karte|ab\s+\d|je\s*100\s*g|pro\s*100\s*g)\b/i.test(v))||native?.couponCode||native?.couponName||raw.inApp===true)reasons.push("hit-price-condition-unresolved");
 if(raw.stringBeforePriceIsStrikethrough===true||raw.stringBelowPriceIsStrikethrough===true||native?.priceStrikeThroughText!=null&&native.priceStrikeThroughText!=="")reasons.push("hit-strikethrough-price-not-supported");
 if(raw.published===false||raw.inventoryHidden===true||raw.inventoryError===true)reasons.push("hit-native-product-not-published");
 if(reasons.length)return{ok:false,retailerSku,reasons:[...new Set(reasons)]};
 const nativeProof={external_id:retailerSku,ean:gtin,storeId:raw.storeId,storeNumber:raw.storeNumber,headline:raw.headline,overview:raw.overview,url:raw.url,price:raw.price,deposit:raw.deposit??null,priceTag:structuredClone(native),brand:raw.brand??null,published:raw.published??null,inApp:raw.inApp??null,inset:raw.inset??null,stringBeforePrice:raw.stringBeforePrice??null,stringBelowPrice:raw.stringBelowPrice??null,stringBeforePriceIsStrikethrough:raw.stringBeforePriceIsStrikethrough??null,stringBelowPriceIsStrikethrough:raw.stringBelowPriceIsStrikethrough??null,packageVariants:structuredClone(raw.packageVariants??null),variantArticles:structuredClone(raw.variantArticles??null),inventoryHidden:raw.inventoryHidden??null,inventoryError:raw.inventoryError??null,inventoryAvailable:raw.inventoryAvailable??null,inventoryUpdatedAt:raw.inventoryUpdatedAt??null};
 const candidate={sourceId:SOURCE,merchant:"HIT",retailerSku,nativeSku:retailerSku,gtin,name,brand,pack,packAmount:parsed.amount,packUnit:parsed.unit,packCount:parsed.count,normalizedPack:parsed.total,price:priceCents/100,priceCents,currency:"EUR",priceBasis:"pack",priceKind:"published-current",regularPrice:null,promotionStatus:"unknown",nativePriceType:native.type,normalPriceEvidence:standard?"native-standard-price-tag":"native-permanent-discount-tag",deposit:depositCents==null?null:depositCents/100,depositCents,depositIncluded:depositCents==null?null:false,priceIncludesDeposit:depositCents==null?null:false,nativeStoreId:p.store.storeId,nativeStoreNumber:p.store.storeNumber,storeName:p.store.name,storeId:null,city:"Berlin",country:"DE",scopeCountry:"DE",scopeChannel:"store-assortment-publication",locationScope:"native-store",truthEligible:false,physicalStorePriceVerified:false,availability:"unknown",nativeInventoryAvailable:typeof raw.inventoryAvailable==="boolean"?raw.inventoryAvailable:null,nativeInventoryUpdatedAt:typeof raw.inventoryUpdatedAt==="string"?raw.inventoryUpdatedAt:null,publicationAvailable:true,nativeProductUrl:urls.nativeUrl,sourceUrl:urls.sourceUrl,sourceResponseUrl:p.sourceResponseUrl,sourceResponseHash:p.sourceResponseHash,sourceResponseDate:p.responseDate,sourceAgeSeconds:p.responseAgeSeconds,capturedAt:p.capturedAt,expiresAt:new Date(Date.parse(p.capturedAt)+TTL_MS).toISOString(),nativeProof,proofHash:hash(JSON.stringify({sourceResponseHash:p.sourceResponseHash,sourceResponseUrl:p.sourceResponseUrl,nativeProof}))};
 return{ok:true,candidate,retailerSku,reasons:[]};
}
function parseRow(raw,meta){try{return parseNativeRow(raw,proof(meta))}catch(error){return{ok:false,retailerSku:typeof raw?.external_id==="string"?raw.external_id:null,reasons:[error.code||"hit-source-proof-invalid"]}}}
function quoteSignature(row){return JSON.stringify([row?.storeId,row?.storeNumber,row?.ean,text(row?.headline),row?.overview,row?.price,row?.deposit??null,row?.priceTag?.type,row?.priceTag?.badgeText,row?.priceTag?.priceEuro,row?.priceTag?.priceCent,row?.priceTag?.priceStrikeThroughText,row?.priceTag?.beforeText,row?.priceTag?.belowText,row?.priceTag?.priceBelowText,row?.priceTag?.couponCode,row?.priceTag?.couponName,row?.stringBeforePrice,row?.stringBelowPrice,row?.inApp,row?.packageVariants,row?.variantArticles])}
function parsePage(html,meta){
 const accepted=[],rejected=[];let p,extracted;
 try{p=proof(meta);if(typeof html!=="string"||Buffer.byteLength(html)>MAX_BYTES)throw fail("hit-page-body-invalid-or-too-large");if(hash(html)!==p.sourceResponseHash)throw fail("hit-source-response-body-hash-conflict");extracted=extractRows(html);if(extracted.params?.for_store!=null&&extracted.params.for_store!==p.store.storeId)throw fail("hit-native-list-store-context-conflict")}catch(error){return{accepted,rejected:[{retailerSku:null,reasons:[error.code||"hit-page-schema-invalid"]}],rowCount:0,emptyPage:false,extractionKind:null,nativePagination:null,assortmentComplete:false}}
 const grouped=new Map(),identities=new Map(),parsed=[];
 const rowIdentity=row=>{const pack=exactPack(row?.overview);return typeof row?.ean==="string"&&/^\d{8}$|^\d{12,14}$/.test(row.ean)&&Identity.gtinValid(row.ean)&&pack?JSON.stringify([row.ean,pack.total.unit,pack.total.amount/pack.count,pack.count]):null};
 const identitySignature=row=>JSON.stringify([row?.storeId,row?.storeNumber,text(row?.headline),row?.price,row?.deposit??null,row?.priceTag?.type,row?.priceTag?.badgeText,row?.priceTag?.priceEuro,row?.priceTag?.priceCent,row?.priceTag?.priceStrikeThroughText,row?.priceTag?.couponCode]);
 for(const row of extracted.rows){const sku=typeof row?.external_id==="string"?row.external_id:null;if(sku){const rows=grouped.get(sku)||[];rows.push(row);grouped.set(sku,rows)}const key=rowIdentity(row);if(key){const rows=identities.get(key)||[];rows.push(row);identities.set(key,rows)}}
 const conflictingSkus=new Set([...grouped].filter(([,rows])=>new Set(rows.map(quoteSignature)).size>1).map(([sku])=>sku));
 const conflictingIdentities=new Set([...identities].filter(([,rows])=>new Set(rows.map(identitySignature)).size>1).map(([key])=>key));
 const primary=extracted.kind==="product-leaflet"?new URL(p.sourceResponseUrl).pathname.match(/-(\d{1,24}[A-Z]{1,3})$/)?.[1]:null;
 for(const [index,row]of extracted.rows.entries()){
  if(extracted.kind==="product-leaflet"&&(!primary||row?.external_id!==primary)){rejected.push({index,retailerSku:row?.external_id??null,reasons:["hit-related-product-not-primary"]});continue}
  if(conflictingSkus.has(row?.external_id)){rejected.push({index,retailerSku:row.external_id,reasons:["hit-conflicting-native-sku-quotes"]});continue}
  if(conflictingIdentities.has(rowIdentity(row))){rejected.push({index,retailerSku:row?.external_id??null,reasons:["hit-conflicting-native-gtin-pack-quotes"]});continue}
  const result=parseNativeRow(row,p);if(!result.ok)rejected.push({index,retailerSku:result.retailerSku,reasons:result.reasons});else parsed.push({index,candidate:result.candidate});
 }
 const byIdentity=new Map();for(const entry of parsed){const c=entry.candidate,key=JSON.stringify([c.gtin,c.normalizedPack.unit,c.normalizedPack.amount/c.packCount,c.packCount]);const list=byIdentity.get(key)||[];list.push(entry);byIdentity.set(key,list)}
 const seen=new Set();for(const entries of byIdentity.values()){
  const quotes=new Set(entries.map(({candidate:c})=>JSON.stringify([c.name,c.priceCents,c.depositCents,c.nativePriceType,c.sourceUrl.replace(/-[0-9]{1,24}[A-Z]{1,3}\?markt=\d+$/,"-")])));
  if(quotes.size>1){for(const {index,candidate:c}of entries)rejected.push({index,retailerSku:c.retailerSku,reasons:["hit-conflicting-native-gtin-pack-quotes"]});continue}
  for(const {candidate}of entries)if(!seen.has(candidate.retailerSku)){seen.add(candidate.retailerSku);accepted.push(candidate)}
 }
 rejected.push(...extracted.errors);
 if(!extracted.rows.length&&extracted.kind!=="assortment-list")rejected.push({retailerSku:null,reasons:["hit-page-native-offers-required"]});
 return{accepted,rejected,rowCount:extracted.rows.length,emptyPage:extracted.kind==="assortment-list"&&extracted.rows.length===0,extractionKind:extracted.kind,nativePagination:extracted.pagination,assortmentComplete:false};
}
module.exports={SOURCE,parsePage,parseRow,extractRows,extractCategories,exactPack};
