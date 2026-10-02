(function(root){
"use strict";
const SOURCE="Lidl DE dated price announcements",URL_EXACT="https://unternehmen.lidl.de/pressemitteilungen/2026/261001_preissenkung-snack-getraenke",PUBLISHED="2026-10-01",CHANNEL="retailer-price-publication",HASH=/^[0-9a-f]{64}$/,WITHHELD=new Set([8,10,17,19]);
const object=v=>v&&typeof v==="object"&&!Array.isArray(v),text=v=>typeof v==="string"?v.trim():"";
const berlinDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"});
function day(time){const parts=Object.fromEntries(berlinDate.formatToParts(time).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));return parts.year+"-"+parts.month+"-"+parts.day;}
function isoTime(value){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return null;const n=Date.parse(value);return Number.isFinite(n)&&new Date(n).toISOString().slice(0,19)===value.slice(0,19)?n:null;}
function pack(value){
 const m=text(value).toLowerCase().match(/^(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)$/);if(!m)return null;
 const units={kg:["g",1000],g:["g",1],l:["ml",1000],cl:["ml",10],ml:["ml",1]},count=Number(m[1]||1),amount=Number(m[2].replace(",","."))*units[m[3]][1];
 return Number.isSafeInteger(count)&&count>0&&count<=1000&&Number.isFinite(amount)&&amount>0&&amount*count<=100000000?{amount,unit:units[m[3]][0],count}:null;
}
function nativePack(value){
 const s=text(value),mass=s.match(/^(\d+(?:[.,]\d+)?)\s+Gramm$/),volume=s.match(/^(\d+(?:[.,]\d+)?)-Liter-(PET-Flasche|Dose|Packung)(?:\s+\((\d+)\s+x\s+(\d+(?:[.,]\d+)?)\s+l\))?$/);
 if(mass)return pack(mass[1]+" g");if(!volume)return null;
 const total=Number(volume[1].replace(",","."))*1000,parsed=volume[3]?pack(volume[3]+" x "+volume[4]+" l"):pack(volume[1]+" l");
 return parsed&&Math.abs(total-parsed.amount*parsed.count)<=Math.max(total,1)*1e-9?parsed:null;
}
const samePack=(a,b)=>a&&b&&a.unit===b.unit&&a.count===b.count&&Math.abs(a.amount-b.amount)<=Math.max(a.amount,b.amount)*1e-9;
function cents(value){return typeof value==="number"&&Number.isFinite(value)&&value>0&&value<=10000&&Math.abs(value*100-Math.round(value*100))<1e-6?Math.round(value*100):null;}
function baseConsistent(value,parsed,goods){
 const s=text(value),m=s.match(/^(?:\(Grundpreis:\s*)?(\d+(?:[.,]\d{1,2})?)\s+Euro\/(kg|l)\)?$/);if(!m)return false;
 // Either the native whole parenthesis or its content is allowed; unpaired
 // parentheses and "ab" ranges never authorize one exact sale pack.
 if(s.startsWith("(")!==s.endsWith(")"))return false;
 const published=Number(m[1].replace(",","."));return parsed.unit===(m[2]==="kg"?"g":"ml")&&Math.round(goods*1000/(parsed.amount*parsed.count))===Math.round(published*100);
}
function key(p){return JSON.stringify(["publication-group-not-sku",SOURCE,URL_EXACT,p.groupOrdinal,p.packCount,p.packAmount,p.packUnit]);}
function queryMatches(p,request){
 if(request===undefined)return true;if(!object(request)||Object.keys(request).some(k=>!["search","gtin","pack","merchant","scopeChannel","limit"].includes(k)))return false;
 if(request.gtin!==undefined||request.merchant!==undefined&&request.merchant!=="Lidl"||request.scopeChannel!==undefined&&request.scopeChannel!==CHANNEL)return false;
 const normalize=s=>s.normalize("NFD").replace(/[\u0300-\u036f\u00ad]/g,"").replace(/\s+/g," ").trim().toLowerCase();
 if(request.search!==undefined&&(typeof request.search!=="string"||text(request.search).length<2||text(request.search).length>120||normalize(request.search).length<2||!normalize(p.name).includes(normalize(request.search))))return false;
 if(request.pack!==undefined&&!samePack(pack(request.pack),pack(p.pack)))return false;
 return request.limit===undefined||Number.isSafeInteger(request.limit)&&request.limit>=1&&request.limit<=200;
}
function ordinal(p){return object(p)&&Number.isSafeInteger(p.groupOrdinal)&&p.groupOrdinal>=1&&p.groupOrdinal<=24?p.groupOrdinal:null;}
function candidate(input,options={}){
 const p=input?.publication,r=input?.reference;if(!object(options)||!object(p)||!object(r)||ordinal(p)===null||WITHHELD.has(p.groupOrdinal))return null;
 if(p.sourceId!==SOURCE||p.merchant!=="Lidl"||p.kind!=="dated-national-price-publication"||p.identityKind!=="publication-group-not-sku"||p.publicationId!==URL_EXACT||p.sourceUrl!==URL_EXACT||p.sourceResponseUrl!==URL_EXACT||p.sourcePublishedDate!==PUBLISHED||p.currency!=="EUR"||p.state!=="published")return null;
 if(p.gtin!==null||p.retailerSku!==null||p.shop!==null||p.nativeMarketId!==null||p.scopeCountry!=="DE"||p.scopeCity!==null||p.scopeChannel!==CHANNEL||p.nationalScopeVerified!==true||p.appliesToBerlin!==true)return null;
 if(p.nativeValidity!==null||p.publicationOriginalValidityVerified!==false||p.current!==false||p.expiresAt!==null||p.priceObservedAt!==null||p.deposit!==null||p.payablePackPrice!==null||p.truthEligible!==false||p.physicalStorePriceVerified!==false||p.normalPriceClassificationVerified!==false||p.priceType!=="unknown"||p.promotionStatus!=="dated-price-reduction-announcement")return null;
 if(p.shippingIncluded!=null||p.serviceFeesIncluded!=null||p.storeId!=null||p.store_id!=null||p.productId!=null||p.nativeVenueId!=null||p.locationLevel==="store"||p.priceAudience!=null&&p.priceAudience!=="public"||["identityVerified","canonicalSelectionEligible","checkoutPriceVerified","requiresMembership","requiresCoupon","requiresApp","conditional","multiBuy","personalizedPrice","loyaltyPrice","personalPrice","priceFrom","actionPrice","actionPriceFrom","bargainPrice","onlyOnline","alsoOnline"].some(k=>p[k]!=null&&p[k]!==false)||["minimumQuantity","minQuantity","minimumSpend","validFrom","validTo"].some(k=>p[k]!=null))return null;
 const name=text(p.name),parsed=pack(p.pack),native=nativePack(p.nativeQuantity),goods=cents(p.price),displayed=cents(p.displayedPrice),previous=p.previousPublishedPrice===null?null:cents(p.previousPublishedPrice);
 if(!name||name.length>250||/[<>]/.test(name)||!parsed||!samePack(parsed,native)||p.packUnit!==parsed.unit||p.packAmount!==parsed.amount||p.packCount!==parsed.count||goods===null||displayed!==goods||p.previousPublishedPrice!==null&&(previous===null||previous<=goods)||!baseConsistent(p.nativeBasePrice,parsed,goods))return null;
 const now=options.now===undefined?Date.now():options.now,captured=isoTime(p.capturedAt);
 if(typeof now!=="number"||!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime())||captured===null||captured>now||day(captured)<PUBLISHED||day(now)<PUBLISHED||!["sourceResponseHash","proofHash"].every(k=>typeof p[k]==="string"&&HASH.test(p[k]))||!queryMatches(p,options.request))return null;
 if(r.kind!=="dated-national-publication"||r.identityKind!=="publication-group-not-sku"||r.city!=="Berlin"||r.country!=="DE"||r.merchant!=="Lidl"||r.key!==key(p)||r.publishedOn!==PUBLISHED||r.sourceMarket!==null||r.observedMarkets!==0||r.observedAt!=null||r.knownPriceRange!=null)return null;
 const publication={kind:p.kind,identityKind:p.identityKind,sourceId:SOURCE,merchant:"Lidl",publicationId:URL_EXACT,groupOrdinal:p.groupOrdinal,gtin:null,retailerSku:null,name:p.name,nativeQuantity:p.nativeQuantity,pack:p.pack,packCount:parsed.count,packAmount:parsed.amount,packUnit:parsed.unit,price:goods/100,displayedPrice:goods/100,currency:"EUR",previousPublishedPrice:previous===null?null:previous/100,nativeBasePrice:p.nativeBasePrice,sourcePublishedDate:PUBLISHED,nativeValidity:null,publicationOriginalValidityVerified:false,current:false,expiresAt:null,priceObservedAt:null,capturedAt:p.capturedAt,scopeCountry:"DE",scopeCity:null,scopeChannel:CHANNEL,nationalScopeVerified:true,appliesToBerlin:true,shop:null,nativeMarketId:null,deposit:null,payablePackPrice:null,truthEligible:false,physicalStorePriceVerified:false,normalPriceClassificationVerified:false,priceType:"unknown",promotionStatus:p.promotionStatus,sourceUrl:URL_EXACT,sourceResponseUrl:URL_EXACT,sourceResponseHash:p.sourceResponseHash,proofHash:p.proofHash,state:"published"};
 return{publication,reference:{kind:"dated-national-publication",identityKind:"publication-group-not-sku",city:"Berlin",country:"DE",merchant:"Lidl",key:key(publication),publishedOn:PUBLISHED,sourceMarket:null,observedMarkets:0}};
}
function normalizeResponse(raw,options={}){
 if(!object(raw)||raw.ok!==true||raw.city!=="Berlin"||raw.country!=="DE"||raw.datedPublications!==undefined&&(!Array.isArray(raw.datedPublications)||raw.datedPublications.length>24))return{ok:false,datedPublications:[],reason:"invalid-lidl-reference-response"};
 const rows=raw.datedPublications||[],counts=new Map();for(const row of rows){const id=ordinal(row?.publication);if(id!==null)counts.set(id,(counts.get(id)||0)+1);}
 // Group ordinals are counted before source validation or query filtering.
 // An invalid/conflicting copy cannot revive an older matching group.
 const datedPublications=[];for(const row of rows){const id=ordinal(row?.publication);if(id===null||counts.get(id)!==1)continue;const valid=candidate(row,options);if(valid)datedPublications.push(valid);}
 return{ok:true,city:"Berlin",country:"DE",datedPublications,datedPublicationCoverage:{publicationGroups:datedPublications.length,coverageComplete:false,fullAssortment:false},coverageComplete:false,truncated:raw.truncated===true};
}
const api=Object.freeze({candidate,normalizeResponse});if(root)root.CaddyLidlReferenceClient=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
