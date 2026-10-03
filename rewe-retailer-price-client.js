"use strict";

const crypto=require("node:crypto"),Inventory=require("./canonical-inventory-import"),Identity=require("./product-identity");
const SOURCE="REWE Berlin pickup",MARKET_ID="8321066",NATIVE_STORE_ID="7ae33841-fa98-3b7e-9ee5-8132f39c189c",ORIGIN="https://www.rewe.de",PRODUCTS_URL=ORIGIN+"/shop/api/products",FILTERS_URL=ORIGIN+"/shop/api/filters";
const ARTICLE_SOURCE="REWE Berlin pickup articles",MAX_ORIGINAL_BYTES=4*1024*1024;
// This public guest pickup selection was verified in REWE's own Berlin market chooser.
const MARKET=Object.freeze({nativeMarketId:MARKET_ID,nativeStoreId:NATIVE_STORE_ID,name:"REWE Steven Horn oHG",address:"Hallesches Ufer 40",postalCode:"10963",city:"Berlin",country:"DE",serviceType:"PICKUP",scopeChannel:"pickup",currency:"EUR",sourceUrl:ORIGIN+"/shop/",publicGuestBrowserVerified:true});
const PRODUCTS_ACCEPT="application/vnd.rewe.digital.products+json;client=web;version=2",FILTERS_ACCEPT="application/vnd.rewe.digital.filters+json;client=web;version=1",PAGE_SIZE=40,SEARCH_CEILING=10000;
const STAPLE_SLUGS=["kaese-eier-molkerei","backwaren-cerealien-aufstriche","kochen-backen","getraenke-genussmittel","obst-gemuese","fleisch-wurst-fisch","fertiggerichte-konserven","oele-sossen-gewuerze","kaffee-tee-kakao"];
const sha=value=>crypto.createHash("sha256").update(value).digest("hex"),clean=value=>typeof value==="string"?value.trim():"",fail=(code,extra={})=>Object.assign(new Error(code),{code,...extra}),bounded=(value,fallback,max)=>Number.isSafeInteger(value)&&value>0?Math.min(value,max):fallback;
const plain=value=>!!value&&typeof value==="object"&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exactKeys=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
function originalTimestamp(value){return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value?Date.parse(value):null;}
function articleProof(proof){
 if(!plain(proof)||originalTimestamp(proof.capturedAt)===null||originalTimestamp(proof.sourceResponseDate)===null||!/^[a-f0-9]{64}$/.test(proof.sourceResponseHash||""))throw fail("rewe-article-original-proof-required");
 const address=allowedUrl(proof.sourceResponseUrl);if(new URL(address).pathname!=="/shop/api/products")throw fail("rewe-article-original-proof-required");
 const at=Date.parse(proof.capturedAt),date=Date.parse(proof.sourceResponseDate),age=proof.sourceAgeSeconds;
 if(age!==null&&(!Number.isSafeInteger(age)||age<0||age>900)||date>at+300000||date<at-900000)throw fail("rewe-article-original-clock-invalid");
 const shop=proof.shop??MARKET;if(!plain(shop)||Object.keys(MARKET).some(key=>shop[key]!==MARKET[key]))throw fail("rewe-article-market-proof-required");
 return{at:proof.capturedAt,address,shop};
}
function captured(value){const n=Date.parse(value);if(!Number.isFinite(n))throw fail("rewe-live-capture-time-required");return new Date(n).toISOString()}
function allowedUrl(value){
 let url;try{url=new URL(value)}catch{throw fail("rewe-source-url-not-allowed")}
 if(url.origin!==ORIGIN||url.username||url.password||url.hash||!["/shop/api/products","/shop/api/filters"].includes(url.pathname))throw fail("rewe-source-url-not-allowed");
 const allowed=url.pathname.endsWith("/products")?["marketId","serviceTypes","categorySlug","page","objectsPerPage"]:["marketId","serviceTypes","categorySlug"];
 if([...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1)||url.searchParams.get("marketId")!==MARKET_ID||url.searchParams.get("serviceTypes")!=="PICKUP")throw fail("rewe-source-url-not-allowed");
 const category=url.searchParams.get("categorySlug");if(category!==null&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category))throw fail("rewe-source-url-not-allowed");
 if(url.pathname.endsWith("/products")&&(!category||!/^\d+$/.test(url.searchParams.get("page")||"")||Number(url.searchParams.get("page"))<1||Number(url.searchParams.get("page"))>999||url.searchParams.get("objectsPerPage")!==String(PAGE_SIZE)))throw fail("rewe-source-url-not-allowed");
 return url.href;
}
function sourceUrl(value,productId){
 if(typeof value!=="string"||!/^\/p\/[a-z0-9]+(?:-[a-z0-9]+)*\/\d+$/.test(value))return null;
 const url=new URL("/shop"+value,ORIGIN);return url.pathname.endsWith("/"+productId)?url.href:null;
}
function parseCategories(raw){
 if(!raw||!Array.isArray(raw.items)||!Number.isSafeInteger(raw.productCount)||raw.productCount<0)throw fail("rewe-native-category-tree-required");
 const categories=raw.items.filter(item=>item?.key==="CATEGORY"&&item.type==="category");if(categories.length!==1||!Array.isArray(categories[0].options)||!categories[0].options.length)throw fail("rewe-native-category-tree-required");
 const roots=[],ids=new Set(),slugs=new Set();let nodes=0;
 function check(c,depth=0){
  if(++nodes>1500||depth>6||!c||!/^\d+$/.test(c.id||"")||!clean(c.label)||!/^([a-z0-9]+-)*[a-z0-9]+$/.test(c.value||"")||!Number.isSafeInteger(c.productCount)||c.productCount<0||ids.has(c.id)||slugs.has(c.value)||c.applied!==false||c.subCategories!=null&&!Array.isArray(c.subCategories))throw fail("rewe-native-category-tree-invalid");
  ids.add(c.id);slugs.add(c.value);
  if(!Array.isArray(c.queryParams)||c.queryParams.length!==1||c.queryParams[0]?.name!=="categorySlug"||c.queryParams[0].value!==c.value)throw fail("rewe-native-category-query-conflict");
  if(c.toggleQuery!=null){const query=new URLSearchParams(c.toggleQuery);if([...query.keys()].some(key=>!["categorySlug","marketId","serviceType"].includes(key)||query.getAll(key).length!==1)||query.get("categorySlug")!==c.value||query.get("marketId")!==MARKET_ID||query.get("serviceType")!=="PICKUP")throw fail("rewe-native-category-query-conflict");}
  for(const child of c.subCategories||[])check(child,depth+1);
 }
 for(const c of categories[0].options){check(c);if(c.productCount>=SEARCH_CEILING)throw fail("rewe-category-search-ceiling-requires-splitting");roots.push({id:c.id,slug:c.value,name:c.label,nativeCount:c.productCount});}
 const priority=new Map(STAPLE_SLUGS.map((slug,index)=>[slug,index]));roots.sort((a,b)=>(priority.get(a.slug)??1000)-(priority.get(b.slug)??1000));
 return{categories:roots,assortmentHash:sha(JSON.stringify({marketId:MARKET_ID,serviceType:"PICKUP",categories:roots.map(c=>[c.id,c.slug])})),nativeRootCount:raw.productCount,nativeRootCountCapped:raw.productCount>=SEARCH_CEILING};
}
function salesPack(value){
 let pack=clean(value).replace(/,/g,".").replace(/×/g,"x");
 // Only remove the retailer's trailing comparison price, never sales quantity text.
 pack=pack.replace(/\s*\(\s*\d+(?:\.\d+)?\s*(?:kg|g|l|ml|cl|Stück|Stk\.?)\s*=\s*\d+(?:\.\d+)?\s*€\s*\)\s*$/i,"").replace(/(?:Stk\.?|Stück|Stuck|pcs|pieces)\b\.?/gi,"piece").replace(/\s+/g," ");
 if(!/^(?:\d+(?:\.\d+)?\s*x\s*)?\d+(?:\.\d+)?\s*(?:kg|g|l|ml|cl|piece)$/i.test(pack))return null;
 const parsed=Inventory.productPack({quantity:pack}).parsed;return parsed?{pack,parsed}:null;
}
function packConflict(item,pack){
 const multi=item.multi1;
 if(multi!=null&&(!Number.isSafeInteger(multi)||multi<1||multi!==pack.parsed.count))return true;
 const nativeAmount=item.baseQuantity,nativeUnit=clean(item.quantityType).toLowerCase();
 if(nativeAmount!=null){
  if(typeof nativeAmount!=="number"||!Number.isFinite(nativeAmount)||nativeAmount<=0)return true;
  if(!["g","kg","ml","l","cl","st"].includes(nativeUnit))return true;
  const native=Identity.base(nativeAmount,nativeUnit==="st"?"piece":nativeUnit),single=Identity.base(pack.parsed.amount,pack.parsed.unit);if(native.unit!==single.unit||Math.abs(native.amount-single.amount)/Math.max(single.amount,1)>.001)return true;
 }
 const namePack=clean(item.title).match(/(?:^|\s)((?:\d+\s*[x×]\s*)?\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl|Stück|Stk\.?))\s*$/i);
 if(namePack){const named=salesPack(namePack[1]);if(!named||/[x×]/i.test(namePack[1])&&named.parsed.count!==pack.parsed.count||named.parsed.total.unit!==pack.parsed.total.unit||Math.abs(named.parsed.total.amount-pack.parsed.total.amount)/Math.max(pack.parsed.total.amount,1)>.001)return true;}
 return false;
}
function parseItems(items,{shop=MARKET,capturedAt,sourceResponseUrl,sourceResponseHash,sourceResponseDate=null,sourceAgeSeconds=null}={}){
 const at=captured(capturedAt);allowedUrl(sourceResponseUrl);
 if(shop?.nativeMarketId!==MARKET_ID||shop.nativeStoreId!==NATIVE_STORE_ID||shop.serviceType!=="PICKUP"||shop.scopeChannel!=="pickup"||shop.country!=="DE"||shop.currency!=="EUR"||shop.name!==MARKET.name||shop.address!==MARKET.address||shop.postalCode!==MARKET.postalCode||shop.city!==MARKET.city||!/^([a-f0-9]{64})$/.test(sourceResponseHash||""))throw fail("rewe-live-source-proof-required");
 if(!Array.isArray(items)||items.length>PAGE_SIZE)throw fail("rewe-native-items-invalid");const offers=[],rejected=[];
 for(const item of items){
  const reasons=[],sku=clean(item?.listingId),article=clean(item?.articleId),product=clean(item?.productId),name=clean(item?.title),gtin=clean(item?.gtin)||null,pricing=item?.pricing,pack=salesPack(pricing?.grammage),proof=sourceUrl(item?.detailsUrl,product);
  if(item?.type!=="LISTING"||!/^[A-Z0-9]{1,40}$/.test(article)||!/^\d{1,20}$/.test(product)||!new RegExp("^[1-9]\\d{0,4}-"+article+"-"+NATIVE_STORE_ID+"$").test(sku)||!name||name.length>500||!proof)reasons.push("rewe-native-product-identity-required");
  if(item?.serviceType!=="PICKUP"||item.marketId!=null&&String(item.marketId)!==MARKET_ID||item.nativeStoreId!=null&&item.nativeStoreId!==NATIVE_STORE_ID)reasons.push("rewe-native-market-or-channel-conflict");
  if(item?.currency!=null&&item.currency!=="EUR"||pricing?.currency!=null&&pricing.currency!=="EUR")reasons.push("rewe-currency-outside-EUR");
  if(gtin&&!Identity.gtinValid(gtin))reasons.push("rewe-product-invalid-gtin");
  if(!pack)reasons.push("rewe-exact-sales-pack-required");else if(packConflict(item,pack))reasons.push("rewe-native-sales-pack-conflict");
  if(item?.volumeCode!=="STK"||item?.variableWeight===true||item?.sellByWeight===true||/\b(?:ca\.?|circa|ungefähr|approx)\s*\d+(?:[.,]\d+)?\s*(?:kg|g)\b|[~≈]\s*\d/i.test(name+" "+clean(pricing?.grammage)))reasons.push("rewe-variable-weight-price");
  if(item?.viewInfo?.detailsViewRequired!==false||item?.hasVariants===true||item?.hasDiverseVariantPrices===true||item?.variants!=null||item?.options!=null||item?.variant!=null)reasons.push("rewe-variant-or-option-price-unresolved");
  if(pricing?.bulkDiscountTiers!=null||pricing?.tiers!=null||pricing?.conditions!=null||item?.conditions!=null||item?.tags?.some?.(tag=>["bulk-discounted","app-exclusive","loyalty-exclusive","coupon"].includes(tag))||item?.minOrderQuantity!=null&&item.minOrderQuantity>1)reasons.push("rewe-conditional-price-unresolved");
  const cents=pricing?.currentRetailPrice,depositCents=pricing?.totalRefundPrice;
  if(!Number.isSafeInteger(cents)||cents<=0||cents>1000000)reasons.push("rewe-gross-pack-price-required");
  if(depositCents!=null&&(!Number.isSafeInteger(depositCents)||depositCents<0||depositCents>1000000))reasons.push("rewe-native-deposit-invalid");
  if(reasons.length){rejected.push({retailerSku:sku||null,name:name||null,reasons});continue;}
  const deposit=depositCents==null?null:depositCents/100,price=cents/100;
  offers.push({merchant:"REWE",sourceId:SOURCE,nativeMarketId:MARKET_ID,nativeStoreId:NATIVE_STORE_ID,retailerSku:sku,retailerProductId:product,nativeArticleId:article,gtin,name,brand:clean(item.brand)||null,description:null,pack:pack.pack,packParsed:pack.parsed,price,currency:"EUR",deposit,displayedPrice:price,nativePriceEUR:price,nativePriceIncludesDeposit:false,depositIncludedInDisplayedPrice:false,payablePackPrice:deposit===null?null:(cents+depositCents)/100,originalPrice:Number.isSafeInteger(pricing?.discount?.regularPrice)&&pricing.discount.regularPrice>=cents?pricing.discount.regularPrice/100:null,nativePromotionValidTo:typeof pricing?.discount?.validTo==="string"?pricing.discount.validTo:null,priceType:"unknown",promotionStatus:"unknown",priceBasis:"pack",scopeChannel:"pickup",scopeCountry:"DE",feesIncluded:false,sourceUrl:proof,proofUrl:proof,sourceResponseUrl,sourceResponseHash,proofHash:sourceResponseHash,sourceResponseDate,sourceAgeSeconds,capturedAt:at,identityStatus:gtin?"native-gtin":"native-sku",availability:"unknown",variantAmbiguous:false,shop});
 }
 return{offers,rejected,received:items.length};
}
// Identity admission is separate from price eligibility. The unchanged item is
// private evidence; service admission must reparse its original product page.
function parseArticles(items,proof={}){
 const {at,address,shop}=articleProof(proof);if(!Array.isArray(items)||items.length>PAGE_SIZE)throw fail("rewe-native-items-invalid");
 const products=[],identityRejected=[];
 for(const item of items){
  const reasons=[],sku=item?.listingId,article=item?.articleId,product=item?.productId,name=item?.title,gtin=item?.gtin??null,pricing=item?.pricing,pack=salesPack(pricing?.grammage),url=sourceUrl(item?.detailsUrl,product);
  if(!plain(item)||item.type!=="LISTING"||typeof article!=="string"||!/^[A-Z0-9]{1,40}$/.test(article)||typeof product!=="string"||!/^[1-9]\d{0,11}$/.test(product)||typeof sku!=="string"||!new RegExp("^[1-9]\\d{0,4}-"+article+"-"+NATIVE_STORE_ID+"$").test(sku)||typeof name!=="string"||name!==name.trim()||!name||name.length>500||/[<>\x00-\x1f\x7f]/.test(name)||!url)reasons.push("rewe-native-article-identity-required");
  if(item?.serviceType!=="PICKUP"||item?.marketId!=null&&String(item.marketId)!==MARKET_ID||item?.nativeStoreId!=null&&item.nativeStoreId!==NATIVE_STORE_ID)reasons.push("rewe-native-market-or-channel-conflict");
  if(gtin!==null&&gtin!==""&&(typeof gtin!=="string"||!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)||!Identity.gtinValid(gtin)))reasons.push("rewe-native-article-invalid-gtin");
  if(item?.brand!=null&&(typeof item.brand!=="string"||item.brand.length>120||/[<>\x00-\x1f\x7f]/.test(item.brand)))reasons.push("rewe-native-article-label-invalid");
  if(!pack)reasons.push("rewe-exact-sales-pack-required");else{
   const single=Identity.base(pack.parsed.amount,pack.parsed.unit);
   if(!Number.isSafeInteger(pack.parsed.count)||pack.parsed.count<1||pack.parsed.count>1000||!Number.isFinite(single.amount)||single.amount<=0||single.amount>100000000||!["g","ml","piece"].includes(single.unit)||!Number.isFinite(pack.parsed.total.amount)||pack.parsed.total.amount<=0||pack.parsed.total.amount>100000000||packConflict(item,pack))reasons.push("rewe-native-sales-pack-conflict");
  }
  if(item?.volumeCode!=="STK"||item?.variableWeight!=null&&item.variableWeight!==false||item?.sellByWeight!=null&&item.sellByWeight!==false||/\b(?:ca\.?|circa|ungefähr|approx)\s*\d+(?:[.,]\d+)?\s*(?:kg|g)\b|[~≈]\s*\d/i.test(clean(name)+" "+clean(pricing?.grammage)))reasons.push("rewe-variable-weight-identity");
  if(item?.viewInfo?.detailsViewRequired!==false||item?.hasVariants!=null&&item.hasVariants!==false||item?.hasDiverseVariantPrices!=null&&item.hasDiverseVariantPrices!==false||item?.variants!=null||item?.options!=null||item?.variant!=null)reasons.push("rewe-variant-or-option-identity-unresolved");
  if(reasons.length){identityRejected.push({retailerSku:typeof sku==="string"?sku:null,name:typeof name==="string"?name:null,reasons});continue;}
  const single=Identity.base(pack.parsed.amount,pack.parsed.unit);
  products.push({sourceId:ARTICLE_SOURCE,merchant:"REWE",nativeMarketId:MARKET_ID,nativeStoreId:NATIVE_STORE_ID,retailerSku:sku,retailerProductId:product,nativeArticleId:article,gtin:gtin||null,name,brand:clean(item.brand)||null,description:null,variant:null,pack:pack.pack,packAmount:single.amount,packUnit:single.unit,packCount:pack.parsed.count,sourceUrl:url,sourceResponseUrl:address,sourceResponseHash:proof.sourceResponseHash,sourceResponseDate:proof.sourceResponseDate,sourceAgeSeconds:proof.sourceAgeSeconds,observedAt:at,shop,scopeCountry:"DE",scopeChannel:"pickup",locationScope:"pickup-market",purpose:"identity",identityScope:"retailer-sku",truthEligible:false,storeId:null,nativeWitness:item});
 }
 return{products,identityRejected,received:items.length};
}
function originalRecord(original,options={},kind="products"){
 if(!exactKeys(original,["body","meta"]))throw fail("rewe-article-original-required");
 const {body,meta}=original,mime=(kind==="products"?PRODUCTS_ACCEPT:FILTERS_ACCEPT).split(";")[0];
 if(!exactKeys(meta,["status","sourceResponseUrl","sourceResponseHash","capturedAt","sourceResponseDate","sourceAgeSeconds","responseDate","responseAge","contentType","bytes"])||meta.status!==200||typeof meta.contentType!=="string"||meta.contentType.split(";")[0].trim().toLowerCase()!==mime||/[\r\n]/.test(meta.contentType)||typeof meta.responseDate!=="string"||!Number.isFinite(Date.parse(meta.responseDate))||Date.parse(meta.responseDate)!==Date.parse(meta.sourceResponseDate)||meta.responseAge!==null&&(typeof meta.responseAge!=="string"||!/^\d+$/.test(meta.responseAge))||(meta.responseAge===null?null:Number(meta.responseAge))!==meta.sourceAgeSeconds)throw fail("rewe-article-original-meta-invalid");
 if(typeof body!=="string"||body.length===0)throw fail("rewe-article-original-body-invalid");
 const bytes=Buffer.from(body,"utf8");if(!Number.isSafeInteger(meta.bytes)||meta.bytes!==bytes.length||meta.bytes>MAX_ORIGINAL_BYTES||new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes)!==body||sha(bytes)!==meta.sourceResponseHash)throw fail("rewe-article-original-body-invalid");
 if(originalTimestamp(meta.capturedAt)===null||originalTimestamp(meta.sourceResponseDate)===null||!/^[a-f0-9]{64}$/.test(meta.sourceResponseHash||""))throw fail("rewe-article-original-proof-required");
 const address=allowedUrl(meta.sourceResponseUrl);if(new URL(address).pathname!=="/shop/api/"+kind)throw fail("rewe-article-original-proof-required");
 const atDate=Date.parse(meta.capturedAt),date=Date.parse(meta.sourceResponseDate),age=meta.sourceAgeSeconds;
 if(age!==null&&(!Number.isSafeInteger(age)||age<0||age>900)||date>atDate+300000||date<atDate-900000)throw fail("rewe-article-original-clock-invalid");
 const now=options.now===undefined?Date.now():typeof options.now==="number"?options.now:typeof options.now==="string"?Date.parse(options.now):NaN,at=Date.parse(meta.capturedAt);
 if(!Number.isFinite(now)||!Number.isSafeInteger(now)||at>now||now-at>300000)throw fail("rewe-article-original-live-capture-invalid");
 let raw;try{raw=JSON.parse(body)}catch{throw fail("rewe-source-json-invalid")}
 return{raw,meta};
}
function reparseOriginalFilters(original,options={}){
 const {raw,meta}=originalRecord(original,options,"filters");return{...parseCategories(raw),meta};
}
function reparseOriginalPage(original,options={}){
 if(!exactKeys(original,["body","meta","category","pageNumber"]))throw fail("rewe-article-original-required");
 const {body,meta,category,pageNumber}=original,{raw}=originalRecord({body,meta},options);
 if(!exactKeys(category,["id","slug","name","nativeCount"])||typeof category.id!=="string"||!/^\d{1,12}$/.test(category.id)||typeof category.slug!=="string"||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.slug)||category.slug.length>150||typeof category.name!=="string"||!category.name.trim()||category.name.length>200||!Number.isSafeInteger(category.nativeCount)||category.nativeCount<0||category.nativeCount>=SEARCH_CEILING||!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>999)throw fail("rewe-article-original-category-invalid");
 const url=new URL(meta.sourceResponseUrl);if(url.searchParams.get("categorySlug")!==category.slug||Number(url.searchParams.get("page"))!==pageNumber)throw fail("rewe-article-original-category-invalid");
 const page=categoryPage(raw,category,pageNumber),parsed=parseArticles(page.hits,{shop:MARKET,...meta}),priced=parseItems(page.hits,{shop:MARKET,...meta});
 return{...parsed,offers:priced.offers,rejected:priced.rejected,page,category,pageNumber,meta};
}
function categoryPage(raw,category,pageNumber){
 const p=raw?.pagination;
 if(!raw||!Array.isArray(raw.hits)||raw.hits.length>PAGE_SIZE||!p||!Number.isSafeInteger(p.currentPage)||p.currentPage<1||p.objectsPerPage!==PAGE_SIZE||!Number.isSafeInteger(p.pageCount)||p.pageCount<0||!Number.isSafeInteger(p.objectCount)||p.objectCount<0||p.objectCount>=SEARCH_CEILING||p.pageCount!==Math.ceil(p.objectCount/PAGE_SIZE))throw fail("rewe-native-category-page-conflict");
 if(raw.search?.marketCode!=null&&String(raw.search.marketCode)!==MARKET_ID||raw.search?.serviceTypes!=null&&(!Array.isArray(raw.search.serviceTypes)||raw.search.serviceTypes.length!==1||raw.search.serviceTypes[0]!=="PICKUP")||raw.search?.activeCategorySlug!=null&&raw.search.activeCategorySlug!==category.slug)throw fail("rewe-native-category-page-scope-conflict");
 if(pageNumber>1&&pageNumber>p.pageCount){const finalSize=p.objectCount===0?0:p.objectCount-PAGE_SIZE*(p.pageCount-1),emptyRequested=p.currentPage===pageNumber&&raw.hits.length===0,clampedLast=p.pageCount>0&&p.currentPage===p.pageCount&&raw.hits.length===finalSize,nowEmpty=p.objectCount===0&&p.currentPage===1&&raw.hits.length===0;if(emptyRequested||clampedLast||nowEmpty)throw fail("rewe-native-category-pagination-count-drift");}
 if(p.currentPage!==pageNumber)throw fail("rewe-native-category-page-conflict");
 const expected=p.objectCount===0?0:pageNumber<p.pageCount?PAGE_SIZE:p.objectCount-PAGE_SIZE*(p.pageCount-1);
 if(p.objectCount===0&&pageNumber!==1||p.objectCount>0&&pageNumber>p.pageCount||raw.hits.length!==expected)throw fail("rewe-native-category-page-conflict");
 return raw;
}
function cursorState(value,listing){
 const initial={version:1,nativeMarketId:MARKET_ID,scopeChannel:"pickup",serviceType:"PICKUP",assortmentHash:listing.assortmentHash,categoryIndex:0,pageNumber:1,received:0,pagesFetched:0};if(value==null)return initial;
 if(typeof value!=="object"||Array.isArray(value)||value.version!==1||value.nativeMarketId!==MARKET_ID||value.scopeChannel!=="pickup"||value.serviceType!=="PICKUP"||value.assortmentHash!==listing.assortmentHash||!Number.isSafeInteger(value.categoryIndex)||value.categoryIndex<0||value.categoryIndex>=listing.categories.length||!Number.isSafeInteger(value.pageNumber)||value.pageNumber<1||value.pageNumber>999||![value.received,value.pagesFetched].every(n=>Number.isSafeInteger(n)&&n>=0))throw fail("rewe-continuation-cursor-conflict");
 return{...initial,...value};
}
async function fetchOffers(options={},fetchImpl=options.fetchImpl||globalThis.fetch){
 if(typeof fetchImpl!=="function")throw fail("rewe-fetch-required");
 if(options.canFetch!==undefined&&typeof options.canFetch!=="function")throw fail("rewe-fetch-gate-required");
 const maxRequests=bounded(options.maxRequests,2,48),maxResponseBytes=bounded(options.maxResponseBytes,2*1024*1024,4*1024*1024),maxTotalBytes=bounded(options.maxTotalBytes,12*1024*1024,30*1024*1024),timeoutMs=bounded(options.timeoutMs,8000,15000),maxSourceAgeMs=15*60*1000,maxPagesPerCategory=bounded(options.maxPagesPerCategory,250,250),pauseMs=Number.isSafeInteger(options.pauseMs)&&options.pauseMs>=0?Math.min(options.pauseMs,5000):1000,now=typeof options.now==="function"?options.now:()=>new Date().toISOString();let requests=0,totalBytes=0,lastRequestAt=0;
 async function get(address,accept){
  address=allowedUrl(address);if(requests>=maxRequests)throw fail("rewe-request-budget-exhausted");
  const requestStage=accept===FILTERS_ACCEPT?"filters":"products",requestOrdinal=requests+1;let controller,timer;
  try{
   const permission=async()=>{if(options.canFetch&&await options.canFetch()!==true)throw fail("rewe-source-fetch-not-allowed",{skipped:"source-gate"});};
   await permission();if(requests&&pauseMs){const delay=Math.max(0,pauseMs-(Date.now()-lastRequestAt));if(delay){await new Promise(resolve=>setTimeout(resolve,delay));await permission();}}lastRequestAt=Date.now();requests++;
   controller=new AbortController();return await Promise.race([(async()=>{
   const res=await fetchImpl(address,{method:"GET",redirect:"error",credentials:"omit",signal:controller.signal,headers:{Accept:accept,"User-Agent":"Sparkorb-PriceSource/1.0 (public retail prices)"}});
   if(res.status!==200){const value=res.headers?.get?.("retry-after"),seconds=Number(value),retryDate=Date.parse(value);throw fail("rewe-source-http-"+res.status,{status:res.status,retryAfterMs:Number.isFinite(seconds)&&seconds>0?seconds*1000:Number.isFinite(retryDate)&&retryDate>Date.now()?retryDate-Date.now():null});}
   if(res.url&&allowedUrl(res.url)!==address)throw fail("rewe-source-redirect-not-allowed");
   const declared=Number(res.headers?.get?.("content-length")||0);if(declared>maxResponseBytes||totalBytes+declared>maxTotalBytes)throw fail("rewe-source-body-too-large");
   const type=res.headers?.get?.("content-type");if(!type||!type.toLowerCase().includes(accept.split(";")[0]))throw fail("rewe-native-source-content-type-required");
   let bytes,textBody;
   if(res.body?.getReader){const reader=res.body.getReader(),chunks=[];let length=0;try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>maxResponseBytes||totalBytes+length>maxTotalBytes){await reader.cancel();throw fail("rewe-source-body-too-large");}chunks.push(Buffer.from(part.value));}}finally{reader.releaseLock();}bytes=Buffer.concat(chunks);}else{textBody=await res.text();if(typeof textBody!=="string")throw fail("rewe-source-utf8-invalid");bytes=Buffer.from(textBody);if(bytes.length>maxResponseBytes||totalBytes+bytes.length>maxTotalBytes)throw fail("rewe-source-body-too-large");}totalBytes+=bytes.length;
   const capturedAt=captured(now()),age=res.headers?.get?.("age"),date=res.headers?.get?.("date"),sourceAgeSeconds=age==null?null:Number(age),dateMs=date==null?null:Date.parse(date);
   if(age!=null&&(!/^\d+$/.test(age)||!Number.isSafeInteger(sourceAgeSeconds)||sourceAgeSeconds*1000>maxSourceAgeMs))throw fail("rewe-source-cache-age-stale-or-invalid");
   if(!Number.isFinite(dateMs)||dateMs>Date.parse(capturedAt)+5*60*1000||dateMs<Date.parse(capturedAt)-maxSourceAgeMs)throw fail("rewe-source-response-date-stale-or-invalid");
   let body;try{body=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);if(textBody!==undefined&&body!==textBody)throw Error();}catch{throw fail("rewe-source-utf8-invalid");}
   let data;try{data=JSON.parse(body);}catch{throw fail("rewe-source-json-invalid");}
   const meta={status:200,sourceResponseUrl:address,sourceResponseHash:sha(bytes),capturedAt,sourceResponseDate:new Date(dateMs).toISOString(),sourceAgeSeconds,responseDate:date,responseAge:age,contentType:type,bytes:bytes.length};
   return{data,body,meta,...meta};
  })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail("rewe-source-timeout"));},timeoutMs);})]);
  }catch(error){throw Object.assign(error instanceof Error?error:fail("rewe-source-failed"),{sourceResponseUrl:address,requestStage,requestOrdinal,requests,totalBytes});}finally{clearTimeout(timer);}
 }
 if(maxRequests<2)throw fail("rewe-request-budget-exhausted");
 const filters=new URL(FILTERS_URL);filters.searchParams.set("marketId",MARKET_ID);filters.searchParams.set("serviceTypes","PICKUP");
 const listingProof=await get(filters.href,FILTERS_ACCEPT),listing=parseCategories(listingProof.data),state=cursorState(options.cursor,listing),offers=[],rejected=[],products=[],identityRejected=[],originalPages=[];let received=0,pagesThisBatch=0;const deduplicated=new Map();
 while(state.categoryIndex<listing.categories.length&&requests<maxRequests&&state.pageNumber<=maxPagesPerCategory){
  const category=listing.categories[state.categoryIndex],url=new URL(PRODUCTS_URL);for(const [key,value]of Object.entries({categorySlug:category.slug,marketId:MARKET_ID,serviceTypes:"PICKUP",page:String(state.pageNumber),objectsPerPage:String(PAGE_SIZE)}))url.searchParams.set(key,value);
  const proof=await get(url.href,PRODUCTS_ACCEPT),raw=categoryPage(proof.data,category,state.pageNumber),parsed=parseItems(raw.hits,{shop:MARKET,...proof}),articles=parseArticles(raw.hits,{shop:MARKET,...proof});
  products.push(...articles.products);identityRejected.push(...articles.identityRejected);originalPages.push({body:proof.body,meta:proof.meta,category:{...category},pageNumber:state.pageNumber});
  for(const offer of parsed.offers){const prior=deduplicated.get(offer.retailerSku);if(prior&&(prior.retailerProductId!==offer.retailerProductId||prior.gtin!==offer.gtin||prior.pack!==offer.pack))throw fail("rewe-native-listing-identity-conflict");deduplicated.set(offer.retailerSku,offer);}
  rejected.push(...parsed.rejected);received+=parsed.received;state.received+=parsed.received;state.pagesFetched++;pagesThisBatch++;
  if(raw.pagination.objectCount===0||state.pageNumber===raw.pagination.pageCount){state.categoryIndex++;state.pageNumber=1;}else state.pageNumber++;
 }
 offers.push(...deduplicated.values());const complete=state.categoryIndex===listing.categories.length,stalled=!complete&&state.pageNumber>maxPagesPerCategory;
 return{offers,rejected,products,identityRejected,originalFilters:{body:listingProof.body,meta:listingProof.meta},originalPages,received,receivedCumulative:state.received,productCount:offers.length,shop:MARKET,shops:[MARKET],requests,totalBytes,complete,publishedAssortmentComplete:complete,fullAssortmentVerified:false,physicalStoreAssortmentVerified:false,sourceMarketVerified:true,categoryCount:listing.categories.length,categoriesCompleted:state.categoryIndex,pagesFetched:state.pagesFetched,pagesThisBatch,nextCursor:complete?null:state,stalled,stalledReason:stalled?"rewe-native-pagination-safety-ceiling":null,nativeTotal:null,nativeRootCount:listing.nativeRootCount,nativeRootCountCapped:listing.nativeRootCountCapped,assortmentHash:listing.assortmentHash,categoryProofHash:listingProof.sourceResponseHash};
}
module.exports={SOURCE,ARTICLE_SOURCE,MARKET_ID,NATIVE_STORE_ID,MARKET,ORIGIN,PRODUCTS_URL,FILTERS_URL,PRODUCTS_ACCEPT,FILTERS_ACCEPT,PAGE_SIZE,SEARCH_CEILING,MAX_ORIGINAL_BYTES,allowedUrl,sourceUrl,parseCategories,salesPack,parseItems,parseArticles,reparseOriginalPage,reparseOriginalFilters,categoryPage,cursorState,fetchOffers,fetchInventory:fetchOffers};
