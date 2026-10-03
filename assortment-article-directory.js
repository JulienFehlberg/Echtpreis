"use strict";

// A native article directory is not the generic taxonomy, stock or price authority.
const Aldi=require("./aldi-assortment-article-service"),AldiClient=require("./aldi-assortment-client"),Wolt=require("./wolt-retailer-article-service"),Rewe=require("./rewe-retailer-price-service"),Discovery=require("./price-query-discovery");
const MERCHANTS=Object.freeze(["PENNY","EDEKA","Lidl","ALDI","Kaufland","REWE"]),DEFAULT_LIMIT=50,MAX_LIMIT=200,MAX_OFFSET=10000;
const defaults=Object.freeze({aldi:Aldi,wolt:Wolt,rewe:Rewe});
const configs=Object.freeze({
 ALDI:Object.freeze({key:"aldi",service:Aldi,sourceId:Aldi.SOURCE,sourceMerchant:Aldi.MERCHANT,scopeChannel:"assortment-publication",locationScope:"unknown",pricedOnly:false,scopeLabel:"Öffentliche ALDI-Nord-Sortimentsseiten in Deutschland; Berliner Filiale und heutiger Bestand nicht bestätigt."}),
 EDEKA:Object.freeze({key:"wolt",service:Wolt,sourceId:Wolt.SOURCE,sourceMerchant:Wolt.MERCHANT,scopeChannel:"online",locationScope:"native-venue",pricedOnly:false,scopeLabel:"Datierte Artikelfunde im Wolt-Lieferangebot von EDEKA Hilbrecht in Berlin; heutiger Bestand und Filialkassenpreis sind nicht bestätigt."}),
 REWE:Object.freeze({key:"rewe",service:Rewe,sourceId:Rewe.SOURCE,sourceMerchant:Rewe.MERCHANT,scopeChannel:"pickup",locationScope:"pickup-market",pricedOnly:true,scopeLabel:"REWE-Abholangebot am Halleschen Ufer 40 in Berlin; kein bestätigter Filialbestand oder Filialkassenpreis."})
});
const fail=code=>Object.assign(new Error(code),{code});
const plain=value=>value!==null&&typeof value==="object"&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function clock(options){const value=options.now===undefined?Date.now():options.now;if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0||!Number.isFinite(new Date(value).getTime()))throw fail("invalid-article-directory-time");return value;}
function integer(value,fallback,min,max,field){
 if(value===undefined)return fallback;
 if(typeof value!=="number"&&typeof value!=="string"||typeof value==="string"&&!/^(?:0|[1-9]\d*)$/.test(value))throw fail("invalid-article-directory-"+field);
 const number=Number(value);if(!Number.isSafeInteger(number)||number<min||number>max)throw fail("invalid-article-directory-"+field);return number;
}
function queryOptions(options={}){
 if(!plain(options)||Object.keys(options).some(key=>!["merchant","search","limit","offset","now"].includes(key)))throw fail("invalid-article-directory-query");
 if(!Object.hasOwn(options,"merchant")||typeof options.merchant!=="string"||!MERCHANTS.includes(options.merchant))throw fail("invalid-article-directory-merchant");
 let search;
 if(options.search!==undefined){if(typeof options.search!=="string"||/[\u0000-\u001f\u007f]/.test(options.search))throw fail("invalid-article-directory-search");search=options.search.trim();if(search.length<2||search.length>120)throw fail("invalid-article-directory-search");}
 const limit=integer(options.limit,DEFAULT_LIMIT,1,MAX_LIMIT,"limit"),offset=integer(options.offset,0,0,MAX_OFFSET,"offset");
 if(options.offset!==undefined&&!["ALDI","EDEKA"].includes(options.merchant))throw fail("article-directory-offset-not-supported");
 return{merchant:options.merchant,search,limit,offset,now:clock(options)};
}
function dependencies(overrides){if(overrides===undefined)return defaults;if(!plain(overrides)||Object.keys(overrides).some(key=>!["aldi","wolt","rewe"].includes(key)))throw fail("invalid-article-directory-dependencies");return{...defaults,...overrides};}
function poolRequired(pool){if(!pool||typeof pool.query!=="function")throw fail("database-required");}
function iso(value){if(typeof value!=="string")return null;const time=Date.parse(value);return Number.isFinite(time)&&new Date(time).toISOString()===value?value:null;}
function count(value){const number=Number(value);if(typeof value!=="number"&&typeof value!=="string"||typeof value==="string"&&!/^(?:0|[1-9]\d*)$/.test(value)||!Number.isSafeInteger(number)||number<0)throw fail("invalid-article-directory-source-count");return number;}
function statusTimestamp(value,now){const time=value instanceof Date?value.getTime():iso(value)?Date.parse(value):NaN;return Number.isFinite(time)&&time<=now?new Date(time).toISOString():null;}
function sourceMetadata(merchant){const config=configs[merchant];return{merchant,sourceId:config?.sourceId||null,sourceMerchant:config?.sourceMerchant||merchant,scopeCountry:"DE",scopeChannel:config?.scopeChannel||"unknown",locationScope:config?.locationScope||"unknown",scopeLabel:config?.scopeLabel||"Für diesen Händler ist noch kein geprüfter konkreter Artikelbestand erfasst. Daraus folgt keine Aussage darüber, welche Produkte er führt.",pricedOnly:config?.pricedOnly??false,independentOfPrice:config? !config.pricedOnly:null,state:config?"last-observed":"unknown",availability:"unknown",truthEligible:false,currentPriceVerified:false,physicalStorePriceVerified:false,assortmentComplete:false};}
function item(merchant,article){
 const metadata=sourceMetadata(merchant),shop=article.shop?{...article.shop}:null;
 return{identityKey:JSON.stringify([article.sourceId,article.scopeChannel,article.retailerSku]),kind:"native-retailer-article",merchant,sourceMerchant:article.merchant,name:article.name,brand:article.brand??null,variant:article.variant??null,pack:article.pack,packAmount:article.packAmount,packUnit:article.packUnit,packCount:article.packCount,retailerSku:article.retailerSku,gtin:article.gtin??null,sourceId:article.sourceId,sourceUrl:article.sourceUrl,observedAt:article.observedAt||article.capturedAt,sourceResponseHash:article.sourceResponseHash,scopeCountry:"DE",scopeChannel:article.scopeChannel,locationScope:metadata.locationScope,scopeLabel:metadata.scopeLabel,shop,availability:"unknown",state:"last-observed",truthEligible:false,currentPriceVerified:false,physicalStorePriceVerified:false,normalPriceClassificationVerified:false,assortmentComplete:false,pricedOnly:metadata.pricedOnly,independentOfPrice:metadata.independentOfPrice};
}
function normalizeAldi(raw,now){
 if(!plain(raw)||raw.state!=="last-observed"||raw.kind!=="native-retailer-article"||raw.availability!=="unknown"||raw.currentPriceVerified!==false||raw.assortmentComplete!==false)return null;
 const parsed=AldiClient.exactPack(raw.pack);if(!parsed)return null;
 const checked=Aldi.validateArticle({...raw,packAmount:parsed.amount,packUnit:parsed.unit,packCount:parsed.count,publicationAvailable:raw.nativePublicationAvailableAtObservation},{now});
 if(!checked.ok||raw.packAmount!==checked.article.packAmount||raw.packUnit!==checked.article.packUnit||raw.packCount!==checked.article.packCount)return null;
 return item("ALDI",checked.article);
}
function normalizePriced(merchant,raw,now){
 if(!plain(raw))return null;
 const service=configs[merchant].service,checked=service.validateOffer(raw,{now});if(!checked.ok)return null;
 const offer=checked.offer,captured=Date.parse(offer.capturedAt),expires=iso(raw.expiresAt);
 const parsed=Discovery.pack(raw.pack);if(!parsed||parsed.count>1000||parsed.amount*parsed.count>100000000||!Discovery.samePack(parsed,Discovery.productPack(offer)))return null;
 // Validate the stored original deadline; revalidation must not renew an old capture.
 if(!expires||expires!==offer.expiresAt||Date.parse(expires)<=now||captured>now||now-captured>=86400000)return null;
 if(raw.validationIssue!=null||raw.validation_issue!=null)return null;
 return item(merchant,offer);
}
function normalizeWolt(raw,now){const checked=Wolt.validateView(raw,{now});return checked.ok?item("EDEKA",checked.article):null;}
function identity(value){return JSON.stringify([value.sourceId,value.scopeChannel,value.retailerSku,value.gtin,value.name,value.brand,value.variant,value.pack,value.packAmount,value.packUnit,value.packCount,value.sourceUrl]);}
function uniqueArticles(items){
 const groups=new Map();for(const article of items){if(!groups.has(article.identityKey))groups.set(article.identityKey,[]);groups.get(article.identityKey).push(article);}
 const unique=[];let conflicts=0;
 for(const group of groups.values()){
  group.sort((a,b)=>b.observedAt.localeCompare(a.observedAt));const latest=group.filter(article=>article.observedAt===group[0].observedAt);
  if(new Set(latest.map(identity)).size!==1){conflicts+=latest.length;continue;}
  unique.push(group[0]);
 }
 return{items:unique.sort((a,b)=>b.observedAt.localeCompare(a.observedAt)||a.retailerSku.localeCompare(b.retailerSku)),conflicts};
}
async function search(pool,options={},overrides){
 const query=queryOptions(options),services=dependencies(overrides);poolRequired(pool);
 const metadata=sourceMetadata(query.merchant),config=configs[query.merchant],base={ok:true,...metadata,items:[],returnedCount:0,excludedRows:0,total:null,limit:query.limit,offset:query.offset,offsetSupported:["ALDI","EDEKA"].includes(query.merchant),matchMeaning:"text-search-not-product-equivalence"};
 if(!config)return{...base,status:"unsupported-source",reason:"no-captured-article-source",note:metadata.scopeLabel};
 const service=services[config.key];if(!service||typeof service.search!=="function")throw fail("invalid-article-directory-dependencies");
 const request={merchant:config.sourceMerchant,limit:query.limit,scopeChannel:config.scopeChannel,now:query.now,...(query.search===undefined?{}:{search:query.search}),...(["ALDI","EDEKA"].includes(query.merchant)?{offset:query.offset}:{})};
 const result=await service.search(pool,request);
 if(!plain(result)||result.ok===false||result.scopeCountry!=="DE"||result.scopeChannel!==config.scopeChannel||result.truthEligible!==false||!config.pricedOnly&&result.sourceId!==config.sourceId||!Array.isArray(result.items)||result.items.length>query.limit)throw fail("invalid-article-directory-source-response");
 let pagination={scannedRows:null,nextOffset:null,hasMore:false};if(!config.pricedOnly){if(!Number.isSafeInteger(result.scannedRows)||!Number.isSafeInteger(result.nextOffset))throw fail("invalid-article-directory-source-pagination");const scanned=count(result.scannedRows),next=count(result.nextOffset);if(scanned<result.items.length||scanned>query.limit||next!==query.offset+scanned||result.hasMore!==(scanned===query.limit&&next<=MAX_OFFSET))throw fail("invalid-article-directory-source-pagination");pagination={scannedRows:scanned,nextOffset:next,hasMore:result.hasMore};}
 const normalized=result.items.map(raw=>query.merchant==="ALDI"?normalizeAldi(raw,query.now):query.merchant==="EDEKA"?normalizeWolt(raw,query.now):normalizePriced(query.merchant,raw,query.now)).filter(Boolean),unique=uniqueArticles(normalized);
 return{...base,...pagination,items:unique.items,status:unique.items.length?"observed-articles":"no-observed-articles",reason:unique.items.length?null:"no-matching-captured-articles",returnedCount:unique.items.length,excludedRows:(pagination.scannedRows===null?0:pagination.scannedRows-result.items.length)+result.items.length-normalized.length+unique.conflicts,note:metadata.scopeLabel+(config.pricedOnly?" Artikelbelege stammen ausschließlich aus derzeit gültigen veröffentlichten Preiszeilen; ein eigener preisunabhängiger Artikelbestand besteht dafür noch nicht.":" Der ursprüngliche Artikelabruf bleibt datiert, auch wenn kein aktueller Preis vorliegt.")};
}
async function status(pool,options={},overrides){
 if(!plain(options)||Object.keys(options).some(key=>key!=="now"))throw fail("invalid-article-directory-query");
 const now=clock(options),services=dependencies(overrides);poolRequired(pool);
 const results=await Promise.all(MERCHANTS.map(async merchant=>{
  const metadata=sourceMetadata(merchant),config=configs[merchant];
  if(!config)return{...metadata,status:"unsupported-source",countBasis:"no-captured-article-source",storedNativeRows:null,lastObservedArticles:null,currentNativePricedRows:null,lastObservedAt:null,note:metadata.scopeLabel};
  const service=services[config.key];if(!service||typeof service.status!=="function")throw fail("invalid-article-directory-dependencies");
  const result=await service.status(pool,{now});if(!plain(result)||result.ok!==true)throw fail("invalid-article-directory-source-response");
  if(!config.pricedOnly){
   if(result.sourceId!==config.sourceId||result.merchant!==config.sourceMerchant||result.scopeCountry!=="DE"||result.scopeChannel!==config.scopeChannel)throw fail("invalid-article-directory-source-response");
   const observed=count(result.lastObservedArticles),stored=count(result.storedArticles),held=count(result.heldArticles),at=statusTimestamp(result.lastObservedAt,now);
   if(held>stored||observed>stored-held)throw fail("invalid-article-directory-source-count");
   return{...metadata,status:observed?"observed-articles":"no-observed-articles",countBasis:"native-article-ledger",storedNativeRows:stored,heldArticles:held,lastObservedArticles:observed,currentNativePricedRows:null,lastObservedAt:at,note:metadata.scopeLabel};
  }
  if(result.scopeCountry!=="DE"||result.scopeChannel!==config.scopeChannel)throw fail("invalid-article-directory-source-response");
  const current=count(result.currentPrices),stored=count(result.storedPrices),at=statusTimestamp(result.lastCapturedAt,now);if(current>stored)throw fail("invalid-article-directory-source-count");
  return{...metadata,status:current?"observed-articles":"no-observed-articles",countBasis:"current-published-price-rows",storedNativeRows:stored,lastObservedArticles:current,currentNativePricedRows:current,lastObservedAt:at,note:metadata.scopeLabel+" Zählung derzeit gültiger nativer Preiszeilen, kein unabhängiger Artikelbestand und keine GTIN-Gesamtzahl."};
 }));
 return{ok:true,merchants:results,total:null,scopeCountry:"DE",assortmentComplete:false,currentPriceVerified:false,physicalStorePriceVerified:false,note:"Getrennte native Artikelbelege je Händler und Kanal. Keine Summe unterschiedlicher Artikel-, Preiszeilen- oder GTIN-Zählungen und kein Nachweis des gesamten Händlersortiments."};
}
module.exports={MERCHANTS,DEFAULT_LIMIT,MAX_LIMIT,MAX_OFFSET,queryOptions,search,status};
