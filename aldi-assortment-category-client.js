"use strict";

const crypto=require("node:crypto"),ProductClient=require("./aldi-assortment-client");
const SOURCE="ALDI Nord category publication",INDEX="an_prd_de_de_products2",MAX_BYTES=4*1024*1024,MAX_ROWS=1000,MAX_NATIVE_HITS=100000,FRESH_MS=5*60*1000;
const fail=(code,extra={})=>Object.assign(new Error(code),{code,...extra});
const object=value=>!!value&&typeof value==="object"&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
function iso(value){return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value?value:null;}
function text(value,max,optional=false){if(value==null&&optional)return null;if(typeof value!=="string")return null;const s=value.trim();return s&&s.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(s)?s:null;}
function categoryUrl(value){
 if(typeof value!=="string"||value.length>2048)throw fail("aldi-category-url-not-allowed");
 let url;try{url=new URL(value);}catch{throw fail("aldi-category-url-not-allowed");}
 if(url.origin!==ProductClient.ORIGIN||url.username||url.password||url.search||url.hash||!/^\/sortiment\/(?:[a-z0-9-]+\/){0,5}[a-z0-9-]+\.html$/.test(url.pathname))throw fail("aldi-category-url-not-allowed");
 return url.href;
}
function attribute(tag,key){const found=[...tag.matchAll(new RegExp("(?:^|\\s)"+key+"\\s*=\\s*([\"'])(.*?)\\1","gi"))];return found.length===1?found[0][2]:null;}
function original(html){
 if(typeof html!=="string"&&!Buffer.isBuffer(html))throw fail("aldi-category-html-required");
 const bytes=Buffer.isBuffer(html)?html:Buffer.from(html,"utf8");if(!bytes.length||bytes.length>MAX_BYTES)throw fail("aldi-category-body-bound-exceeded");
 let body;try{body=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw fail("aldi-category-utf8-required");}
 const links=[...body.matchAll(/<link\b[^>]*>/gi)].map(m=>m[0]).filter(tag=>attribute(tag,"rel")?.toLowerCase()==="canonical");
 if(links.length!==1)throw fail("aldi-category-canonical-required");const canonical=categoryUrl(attribute(links[0],"href"));
 const scripts=[...body.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)].filter(m=>attribute(m[0].slice(0,m[0].indexOf(">")+1),"id")==="__NEXT_DATA__");
 if(scripts.length!==1||attribute(scripts[0][0].slice(0,scripts[0][0].indexOf(">")+1),"type")!=="application/json")throw fail("aldi-category-next-data-required");
 let native;try{native=JSON.parse(scripts[0][0].slice(scripts[0][0].indexOf(">")+1,scripts[0][0].lastIndexOf("</script>")));}catch{throw fail("aldi-category-next-data-invalid");}
 return{native,canonical,bodyHash:hash(bytes),bodyBytes:bytes.length};
}
function proofFor(source,meta,now){
 if(!object(meta)||Object.keys(meta).some(k=>!["sourceResponseUrl","sourceResponseHash","sourceResponseDate","sourceAgeSeconds","capturedAt","scopeCountry"].includes(k)))throw fail("aldi-category-proof-schema-invalid");
 if(meta.scopeCountry!=null&&meta.scopeCountry!=="DE")throw fail("aldi-category-country-conflict");
 let responseUrl=null;if(meta.sourceResponseUrl!=null){responseUrl=categoryUrl(meta.sourceResponseUrl);if(responseUrl!==source.canonical)throw fail("aldi-category-source-canonical-conflict");}
 if(meta.sourceResponseHash!=null&&(!/^[a-f0-9]{64}$/.test(meta.sourceResponseHash)||meta.sourceResponseHash!==source.bodyHash))throw fail("aldi-category-original-response-hash-conflict");
 const capturedAt=meta.capturedAt==null?null:iso(meta.capturedAt);if(meta.capturedAt!=null&&!capturedAt)throw fail("aldi-category-capture-invalid");
 if(capturedAt&&Date.parse(capturedAt)>now)throw fail("aldi-category-capture-future");
 const agePresent=own(meta,"sourceAgeSeconds"),age=agePresent?meta.sourceAgeSeconds:null;
 if(agePresent&&age!==null&&(!Number.isSafeInteger(age)||age<0||age>300))throw fail("aldi-category-source-age-invalid");
 let responseDate=null;if(meta.sourceResponseDate!=null){if(!capturedAt)throw fail("aldi-category-date-without-capture");try{responseDate=ProductClient.responseFreshness({capturedAt,sourceResponseDate:meta.sourceResponseDate,sourceAgeSeconds:age},FRESH_MS);}catch(error){throw fail("aldi-category-source-proof-invalid",{reason:error.code});}}
 const freshCaptureVerified=!!(responseUrl&&meta.sourceResponseHash&&capturedAt&&responseDate&&agePresent);
 if(freshCaptureVerified&&now-Date.parse(capturedAt)>FRESH_MS)throw fail("aldi-category-capture-stale");
 return{categoryUrl:source.canonical,sourceResponseUrl:responseUrl,sourceResponseHash:source.bodyHash,sourceResponseDate:responseDate,sourceAgeSeconds:age,capturedAt,bodyBytes:source.bodyBytes,proofKind:"original-category-html",freshCaptureVerified,offlineOnly:!freshCaptureVerified};
}
function empty(value){return value==null||Array.isArray(value)&&value.length===0||object(value)&&Object.keys(value).length===0;}
function categoryResult(source){
 const n=source.native,p=n?.props?.pageProps,path=new URL(source.canonical).pathname.replace(/\.html$/,""),categories=path.slice("/sortiment/".length).split("/"),categoryId=categories.at(-1);
 if(!object(n)||n.page!=="/product-overview/[...categories]"||!object(n.query)||Object.keys(n.query).some(k=>k!=="categories")||!Array.isArray(n.query.categories)||JSON.stringify(n.query.categories)!==JSON.stringify(categories))throw fail("aldi-category-native-route-conflict");
 if(!object(p)||p.hasError===true||p.locale!=="de"||p.country!=null&&p.country!=="DE"||!object(p.page)||p.page["@path"]!=="/germany"+path||p.page.categoryKey!==categoryId||p.mgnlContext?.isMagnoliaEdit===true||p.mgnlContext?.isMagnoliaPreview===true)throw fail("aldi-category-native-country-or-category-conflict");
 const results=p.algoliaState?.initialResults;if(!object(results)||Object.keys(results).length!==1||!own(results,INDEX))throw fail("aldi-category-native-index-conflict");
 const entry=results[INDEX],state=entry?.state,r=entry?.results?.[0],request=entry?.requestParams?.[0],filter="categoryIDs:"+categoryId;
 if(!object(entry)||!object(state)||!Array.isArray(entry.results)||entry.results.length!==1||!object(r)||!Array.isArray(entry.requestParams)||entry.requestParams.length!==1||!object(request)||state.index!==INDEX||r.index!==INDEX)throw fail("aldi-category-native-index-conflict");
 if(state.filters!==filter||request.filters!==filter||Object.keys(request).some(k=>!["filters","hitsPerPage","highlightPreTag","highlightPostTag","page","query"].includes(k))||r.query!==""||state.query!=null&&state.query!==""||request.query!=null&&request.query!==""||!empty(state.facetsRefinements)||!empty(state.facetsExcludes)||!empty(state.disjunctiveFacetsRefinements)||!empty(state.numericRefinements)||!empty(state.tagRefinements)||!empty(state.hierarchicalFacetsRefinements))throw fail("aldi-category-native-query-conflict");
 if(typeof r.params!=="string"||r.params.length>4000)throw fail("aldi-category-native-query-conflict");const params=new URLSearchParams(r.params);
 if([...params.keys()].some(k=>!["filters","hitsPerPage","highlightPreTag","highlightPostTag","page","query"].includes(k))||[...new Set(params.keys())].some(k=>params.getAll(k).length!==1)||params.get("filters")!==filter||params.has("query")&&params.get("query")!=="")throw fail("aldi-category-native-query-conflict");
 const bounded=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 if(!bounded(r.page,0,0)||state.page!=null&&state.page!==0||request.page!=null&&request.page!==0||params.has("page")&&params.get("page")!=="0")throw fail("aldi-category-native-page-conflict");
 if(!bounded(r.hitsPerPage,1,MAX_ROWS)||state.hitsPerPage!==r.hitsPerPage||request.hitsPerPage!==r.hitsPerPage||params.get("hitsPerPage")!==String(r.hitsPerPage)||!bounded(r.nbHits,0,MAX_NATIVE_HITS)||!bounded(r.nbPages,0,MAX_NATIVE_HITS)||r.nbPages!==Math.ceil(r.nbHits/r.hitsPerPage)||!Array.isArray(r.hits)||r.hits.length!==Math.min(r.hitsPerPage,r.nbHits)||r.exhaustiveNbHits!==true||r.exhaustive?.nbHits!==true)throw fail("aldi-category-native-count-conflict");
 return{categoryId,result:r};
}
function candidateFor(raw,categoryId,categoryProof){
 const reject=reason=>({ok:false,retailerSku:typeof raw?.objectID==="string"?raw.objectID:null,reasons:[reason]});
 if(!object(raw))return reject("aldi-category-native-product-schema-invalid");
 if(raw.country!=null&&raw.country!=="DE"||raw.scopeCountry!=null&&raw.scopeCountry!=="DE")return reject("aldi-category-native-product-country-conflict");
 if(typeof raw.objectID!=="string"||!/^\d{1,15}$/.test(raw.objectID)||!Number.isSafeInteger(Number(raw.objectID))||Number(raw.objectID)<=0||String(Number(raw.objectID))!==raw.objectID)return reject("aldi-category-native-sku-invalid");
 let target;try{if(typeof raw.productSlug!=="string")return reject("aldi-category-native-identity-conflict");target=ProductClient.targetForUrl(ProductClient.ORIGIN+"/produkt/"+raw.productSlug+".html");}catch{return reject("aldi-category-native-identity-conflict");}
 if(target.retailerSku!==raw.objectID||!Array.isArray(raw.categoryIDs)||raw.categoryIDs.some(v=>typeof v!=="string")||!raw.categoryIDs.includes(categoryId))return reject("aldi-category-native-identity-conflict");
 const name=text(raw.name,400),brand=text(raw.brandName,120,true),variant=text(raw.shortDescription,2000,true),pack=text(raw.salesUnit,400),parsed=ProductClient.exactPack(pack);
 const validOptional=(value,max)=>value==null||typeof value==="string"&&(value.trim()===""||!!text(value,max));
 if(!name||!validOptional(raw.brandName,120)||!validOptional(raw.shortDescription,2000))return reject("aldi-category-native-product-label-invalid");
 if(!parsed)return reject("aldi-category-exact-sales-pack-required");
 if(ProductClient.unresolvedVariant(name+" "+(variant||"")))return reject("aldi-category-product-variant-unresolved");
 if(raw.isDrainedWeight===true&&(!Number.isFinite(raw.drainedWeightValue)||raw.drainedWeightValue<=0))return reject("aldi-category-drained-weight-unresolved");
 return{ok:true,candidate:{sourceId:SOURCE,merchant:"ALDI Nord",purpose:"category-identity-candidate",state:"unadmitted",identity:{retailerSku:raw.objectID,productIdentityUrl:target.sourceUrl,name,brand,variant,nativeSalesUnit:pack,normalizedSalesPack:structuredClone(parsed),gtin:null},categoryProof:structuredClone(categoryProof),rawNativeProduct:structuredClone(raw),scopeCountry:"DE",scopeChannel:"category-publication",locationScope:"unknown",availability:"unknown",truthEligible:false,currentPriceVerified:false,physicalStorePriceVerified:false,assortmentComplete:false,admitted:false}};
}
function parsePage(html,meta={},options={}){
 if(!object(options)||Object.keys(options).some(k=>!["now","maxRows"].includes(k)))throw fail("aldi-category-options-invalid");
 const now=options.now==null?Date.now():typeof options.now==="number"?options.now:Date.parse(iso(options.now)),maxRows=options.maxRows??MAX_ROWS;
 if(!Number.isFinite(now)||!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>MAX_ROWS)throw fail("aldi-category-options-invalid");
 const source=original(html),categoryProof=proofFor(source,meta,now),{categoryId,result}=categoryResult(source);
 if(result.hits.length>maxRows)throw fail("aldi-category-row-bound-exceeded");
 const seen=new Set();for(const raw of result.hits)if(object(raw)&&typeof raw.objectID==="string"){if(seen.has(raw.objectID))throw fail("aldi-category-duplicate-native-sku");seen.add(raw.objectID);}
 const candidates=[],rejected=[];for(const raw of result.hits){const parsed=candidateFor(raw,categoryId,categoryProof);if(parsed.ok)candidates.push(parsed.candidate);else rejected.push(parsed);}
 const truncated=result.nbHits>result.hits.length;
 return{sourceId:SOURCE,purpose:"category-identity-candidate",state:"unadmitted",categoryId,categoryProof,freshCaptureVerified:categoryProof.freshCaptureVerified,offlineOnly:categoryProof.offlineOnly,candidates,rejected,receivedCount:result.hits.length,candidateCount:candidates.length,rejectedCount:rejected.length,pagination:{page:result.page,nbHits:result.nbHits,nbPages:result.nbPages,hitsPerPage:result.hitsPerPage,received:result.hits.length,truncated},extractionComplete:!truncated,truthEligible:false,physicalStorePriceVerified:false,assortmentComplete:false};
}

module.exports={SOURCE,INDEX,MAX_BYTES,MAX_ROWS,MAX_NATIVE_HITS,FRESH_MS,categoryUrl,parsePage};
