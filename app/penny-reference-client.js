(function(root){
"use strict";
const SOURCE="PENNY Berlin regional price publications",MARKET="8534449",REGION="15A-01-56",CHANNEL="retailer-price-publication",CATEGORY="dauerhaft-im-preis-gesenkt",DAY=86400000;
const MODULE_HASH="cc080a5e3e91c72a97dbadaa6915bd34a190c99e36a9c83d60b484bd358636b9";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,HASH=/^[0-9a-f]{64}$/;
const SHOP=Object.freeze({name:"Penny Emser Straße",address:"Emser Str. 1-2",postalCode:"12051",city:"Berlin",country:"DE",nativeMarketId:MARKET,nativeSellingRegion:REGION});
const text=value=>typeof value==="string"?value.trim():"",object=value=>value&&typeof value==="object"&&!Array.isArray(value);
const berlinFormat=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
function isoTime(value){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return null;const n=Date.parse(value);return Number.isFinite(n)&&new Date(n).toISOString().slice(0,19)===value.slice(0,19)?n:null;}
function berlinParts(time){return Object.fromEntries(berlinFormat.formatToParts(time).filter(part=>part.type!=="literal").map(part=>[part.type,Number(part.value)]));}
function weekBounds(time){
 const parts=berlinParts(time),local=Date.UTC(parts.year,parts.month-1,parts.day),day=(new Date(local).getUTCDay()+6)%7,thursday=local+(3-day)*DAY,year=new Date(thursday).getUTCFullYear();
 const january4=Date.UTC(year,0,4),firstThursday=january4+(3-(new Date(january4).getUTCDay()+6)%7)*DAY,week=1+Math.round((thursday-firstThursday)/(7*DAY)),nextMonday=local+(7-day)*DAY;
 let end=nextMonday;for(let i=0;i<3;i++){const p=berlinParts(end),represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);end+=nextMonday-represented;}
 return{week:year+"-"+String(week).padStart(2,"0"),end};
}
function pack(value,native=false){
 const raw=text(value).toLowerCase(),s=native?raw.replace(/^je\s+/,"").replace(/\s*-\s*(?:packung|beutel|dose|flasche|glas|becher)$/,""):raw;
 const m=s.match(/^(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*-?\s*(kg|g|ml|cl|l|piece|stk|stück)$/);if(!m)return null;
 const count=Number(m[1]||1),units={kg:["g",1000],g:["g",1],l:["ml",1000],cl:["ml",10],ml:["ml",1],piece:["piece",1],stk:["piece",1],"stück":["piece",1]},unit=units[m[3]],amount=Number(m[2].replace(",","."))*unit[1];
 return Number.isSafeInteger(count)&&count>0&&count<=1000&&Number.isFinite(amount)&&amount>0&&amount*count<=100000000?{amount,unit:unit[0],count}:null;
}
const samePack=(a,b)=>a&&b&&a.unit===b.unit&&a.count===b.count&&Math.abs(a.amount-b.amount)<=Math.max(a.amount,b.amount)*1e-9;
function cents(value){return typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=10000&&Math.abs(value*100-Math.round(value*100))<1e-6?Math.round(value*100):null;}
function baseConsistent(value,parsed,price){
 const m=text(value).match(/^\(1\s+(kg|l|Stück|piece)\s*=\s*(\d+(?:[.,]\d{1,2})?)\)$/);if(!m)return false;
 const unit=m[1]==="kg"?"g":m[1]==="l"?"ml":"piece",factor=unit==="piece"?1:1000,published=Number(m[2].replace(",","."));
 return parsed.unit===unit&&Math.abs(published*100-Math.round(published*100))<1e-6&&Math.round(price*factor/(parsed.amount*parsed.count))===Math.round(published*100);
}
function exactShop(value){return object(value)&&Object.entries(SHOP).every(([key,expected])=>value[key]===expected);}
function publicationKey(p){return JSON.stringify(["cms-document-not-sku",SOURCE,MARKET,REGION,p.cmsPublicationId,p.packCount,p.packAmount,p.packUnit]);}
function publicationIdentity(p){return object(p)&&p.sourceId===SOURCE&&p.nativeMarketId===MARKET&&p.nativeSellingRegion===REGION&&UUID.test(p.cmsPublicationId)?JSON.stringify([SOURCE,MARKET,REGION,p.cmsPublicationId]):null;}
function sourceUrls(p){
 const response="https://www.penny.de/.rest/offers/by-category/"+p.publicationWeek+"/"+CATEGORY+"/?region="+REGION;
 if(p.sourceResponseUrl!==response||p.marketResponseUrl!=="https://www.penny.de/.rest/market/markets/market_"+MARKET)return false;
 try{const url=new URL(p.sourceUrl);return url.protocol==="https:"&&url.hostname==="www.penny.de"&&!url.username&&!url.password&&!url.port&&!url.hash&&!url.search&&new RegExp("^/angebote/(?:"+REGION+"/)?"+CATEGORY+"/[a-z0-9]+(?:-[a-z0-9]+)*-?$").test(url.pathname);}catch(_){return false;}
}
function queryMatches(p,request){
 if(request===undefined)return true;if(!object(request)||Object.keys(request).some(key=>!["search","gtin","pack","merchant","scopeChannel","limit"].includes(key)))return false;
 if(request.gtin!==undefined||request.merchant!==undefined&&request.merchant!=="PENNY"||request.scopeChannel!==undefined&&request.scopeChannel!==CHANNEL)return false;
 const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f\u00ad]/g,'').replace(/[\u2028\u2029]/g,' ').replace(/\*+\s*$/,'').replace(/\s+/g,' ').trim().toLowerCase();
 if(request.search!==undefined&&(typeof request.search!=="string"||text(request.search).length<2||text(request.search).length>120||!normalize(p.name).includes(normalize(request.search))))return false;
 if(request.pack!==undefined&&!samePack(pack(request.pack),pack(p.pack)))return false;
 return request.limit===undefined||Number.isSafeInteger(request.limit)&&request.limit>=1&&request.limit<=200;
}
function candidate(input,options={}){
 const p=input?.publication,r=input?.reference;if(!object(options)||!object(p)||!object(r)||!publicationIdentity(p))return null;
 if(p.merchant!=="PENNY"||p.kind!=="regional-price-publication"||p.identityKind!=="cms-document-not-sku"||p.gtin!==null||p.retailerSku!==null||p.scopeCountry!=="DE"||p.scopeChannel!==CHANNEL||p.currency!=="EUR"||p.state!=="published"||p.current!==true)return null;
 if(p.truthEligible!==false||p.physicalStorePriceVerified!==false||p.normalPriceClassificationVerified!==false||p.publicationOriginalValidityVerified!==false||p.nativeValidity!==null||p.deposit!==null||p.payablePackPrice!==null||p.priceType!=="unknown"||p.promotionStatus!=="permanent-reduction-publication"||p.nativeCategory!==CATEGORY)return null;
 if(p.shippingIncluded!=null||p.serviceFeesIncluded!=null||p.storeId!=null||p.store_id!=null||p.productId!=null||p.locationLevel==="store"||p.priceAudience!=null&&p.priceAudience!=="public"||["identityVerified","canonicalSelectionEligible","checkoutPriceVerified","requiresMembership","requiresCoupon","requiresApp","conditional","multiBuy","personalizedPrice","loyaltyPrice","personalPrice","priceFrom","actionPrice","actionPriceFrom","bargainPrice","onlyOnline","alsoOnline"].some(key=>p[key]!=null&&p[key]!==false)||["minimumQuantity","minQuantity","minimumSpend","validFrom","validTo"].some(key=>p[key]!=null))return null;
 const name=text(p.name),parsed=pack(p.pack),native=pack(p.nativeQuantity,true),goods=cents(p.price),displayed=cents(p.displayedPrice),previous=p.previousPublishedPrice===null?null:cents(p.previousPublishedPrice);
 if(!name||name.length>250||/[<>]/.test(name)||!parsed||!samePack(parsed,native)||p.packUnit!==parsed.unit||p.packAmount!==parsed.amount||p.packCount!==parsed.count||goods===null||goods<=0||displayed!==goods||p.previousPublishedPrice!==null&&(previous===null||previous<=0)||!baseConsistent(p.nativeBasePrice,parsed,goods)||!exactShop(p.shop))return null;
 const now=options.now===undefined?Date.now():Number(options.now),captured=isoTime(p.capturedAt),expiry=isoTime(p.expiresAt),market=isoTime(p.marketCapturedAt),category=isoTime(p.categoryCapturedAt);
 if(!Number.isFinite(now)||captured===null||expiry===null||market===null||category===null||captured>now||captured<now-DAY||expiry<=now||expiry<=captured||market>captured||category>captured||captured-market>300000||captured-category>300000)return null;
 const bounds=weekBounds(captured);if(p.publicationWeek!==bounds.week||expiry>Math.min(captured+DAY,bounds.end)||!["sourceResponseHash","marketResponseHash","categoryPageHash","proofHash"].every(key=>typeof p[key]==="string"&&HASH.test(p[key]))||p.bindingModuleHash!==MODULE_HASH||!sourceUrls(p)||!queryMatches(p,options.request))return null;
 if(r.kind!=="regional-publication"||r.identityKind!=="cms-document-not-sku"||r.city!=="Berlin"||r.country!=="DE"||r.merchant!=="PENNY"||r.key!==publicationKey(p)||r.observedAt!==p.capturedAt||r.observedMarkets!==1||!exactShop(r.sourceMarket))return null;
 const publication={sourceId:SOURCE,merchant:"PENNY",kind:p.kind,identityKind:p.identityKind,nativeMarketId:MARKET,nativeSellingRegion:REGION,cmsPublicationId:p.cmsPublicationId,gtin:null,retailerSku:null,name:p.name,nativeQuantity:p.nativeQuantity,pack:p.pack,packAmount:parsed.amount,packUnit:parsed.unit,packCount:parsed.count,price:goods/100,displayedPrice:goods/100,deposit:null,payablePackPrice:null,currency:"EUR",priceType:"unknown",promotionStatus:p.promotionStatus,previousPublishedPrice:previous===null?null:previous/100,nativeCategory:CATEGORY,nativeBasePrice:p.nativeBasePrice,publicationWeek:p.publicationWeek,nativeValidity:null,state:"published",current:true,truthEligible:false,physicalStorePriceVerified:false,normalPriceClassificationVerified:false,publicationOriginalValidityVerified:false,scopeCountry:"DE",scopeChannel:CHANNEL,shippingIncluded:null,serviceFeesIncluded:null,shop:{...SHOP},capturedAt:p.capturedAt,expiresAt:p.expiresAt,sourceUrl:p.sourceUrl,sourceResponseUrl:p.sourceResponseUrl,sourceResponseHash:p.sourceResponseHash,marketResponseUrl:p.marketResponseUrl,marketResponseHash:p.marketResponseHash,categoryPageHash:p.categoryPageHash,marketCapturedAt:p.marketCapturedAt,categoryCapturedAt:p.categoryCapturedAt,bindingModuleHash:MODULE_HASH,proofHash:p.proofHash};
 return{publication,reference:{kind:"regional-publication",identityKind:"cms-document-not-sku",city:"Berlin",country:"DE",merchant:"PENNY",key:publicationKey(publication),observedAt:p.capturedAt,sourceMarket:{...SHOP},observedMarkets:1}};
}
function normalizeResponse(raw,options={}){
 if(!object(raw)||raw.ok!==true||raw.city!=="Berlin"||raw.country!=="DE"||raw.publications!==undefined&&(!Array.isArray(raw.publications)||raw.publications.length>200))return{ok:false,publications:[],reason:"invalid-penny-reference-response"};
 const rows=raw.publications||[],counts=new Map();for(const row of rows){const id=publicationIdentity(row?.publication);if(id)counts.set(id,(counts.get(id)||0)+1);}
 // Count before validation/query filtering, including withheld/invalid latest
 // versions: a conflicting publication can never revive an older matching row.
 const publications=[];for(const row of rows){const id=publicationIdentity(row?.publication);if(!id||counts.get(id)!==1)continue;const valid=candidate(row,options);if(valid)publications.push(valid);}
 return{ok:true,city:"Berlin",country:"DE",publications,coverageComplete:false,truncated:raw.truncated===true};
}
const api=Object.freeze({candidate,normalizeResponse});if(root)root.CaddyPennyReferenceClient=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
