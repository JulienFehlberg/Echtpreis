"use strict";
const crypto=require("node:crypto"),Client=require("./hit-assortment-client");
const SOURCE=Client.SOURCE,COOLDOWN_UNTIL="2026-10-01T19:51:16.522Z";
const fail=code=>Object.assign(new Error(code),{code});
const hash=body=>crypto.createHash("sha256").update(body).digest("hex");
function allowedUrl(input,store){
 let url;try{url=new URL(input)}catch{throw fail("hit-request-url-not-allowed");}
 if(url.protocol!=="https:"||url.hostname!=="www.hit.de"||url.port||url.username||url.password||url.hash)throw fail("hit-request-url-not-allowed");
 const market=url.pathname===new URL(store.officialUrl).pathname;
 if(market){if([...url.searchParams].some(([key,value])=>key!=="mein-markt"||value!=="1")||url.searchParams.getAll("mein-markt").length>1)throw fail("hit-request-url-not-allowed");}
 else if(url.pathname!=="/sortiment/uebersicht"||[...url.searchParams].some(([key,value])=>key!=="page"||!/^\d+$/.test(value))||url.searchParams.getAll("page").length>1)throw fail("hit-request-url-not-allowed");
 return url.href;
}
function cursorFor(raw,store){
 if(raw==null)return{version:1,nativeStoreId:store.storeId,nativeStoreNumber:store.storeNumber,nextPage:0,total:null,limit:null,pagesFetched:0,received:0,seenSkus:[],seenQuotes:{}};
 if(!raw||raw.version!==1||raw.nativeStoreId!==store.storeId||raw.nativeStoreNumber!==store.storeNumber||![raw.nextPage,raw.pagesFetched,raw.received].every(n=>Number.isSafeInteger(n)&&n>=0)||raw.nextPage!==raw.pagesFetched||raw.total!==null&&(!Number.isSafeInteger(raw.total)||raw.total<0||raw.total>100000)||raw.limit!==null&&(!Number.isSafeInteger(raw.limit)||raw.limit<1||raw.limit>200)||!Array.isArray(raw.seenSkus)||raw.seenSkus.length!==raw.received||raw.seenSkus.some(s=>typeof s!=="string"||!/^\d{1,24}[A-Z]{1,3}$/.test(s))||new Set(raw.seenSkus).size!==raw.received||raw.pagesFetched===0&&(raw.total!==null||raw.limit!==null||raw.received!==0)||raw.pagesFetched>0&&(raw.limit===null||raw.total===null||raw.received!==Math.min(raw.nextPage*raw.limit,raw.total)))throw fail("hit-continuation-cursor-conflict");
 if(raw.pagesFetched>0&&raw.seenQuotes==null||raw.seenQuotes!=null&&(typeof raw.seenQuotes!=="object"||Array.isArray(raw.seenQuotes)||Object.keys(raw.seenQuotes).length>100000||Object.values(raw.seenQuotes).some(q=>!q||!/^[a-f0-9]{64}$/.test(q.signature)||!/^\d{8,14}$/.test(q.gtin))))throw fail("hit-continuation-cursor-conflict");
 return{...raw,seenSkus:[...raw.seenSkus],seenQuotes:{...(raw.seenQuotes||{})}};
}
async function collect(options={}){
 const store=options.storeProfile,now=typeof options.now==="function"?options.now:Date.now,fetchImpl=options.fetchImpl||fetch,delay=options.delay||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
 if(!store||!Number.isSafeInteger(store.storeId)||typeof store.storeNumber!=="string"||store.city!=="Berlin"||store.country!=="DE"||!/^https:\/\/www\.hit\.de\/maerkte\/berlin-[a-z-]+$/.test(store.officialUrl||""))throw fail("hit-collector-berlin-profile-required");
 if(now()<Date.parse(COOLDOWN_UNTIL))throw Object.assign(fail("hit-source-initial-cooldown"),{nextAttemptAt:COOLDOWN_UNTIL});
 const maxRequests=options.maxRequests===undefined?8:Number(options.maxRequests);if(!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>16)throw fail("hit-request-budget-invalid");
 const pauseMs=Math.max(1000,Number(options.pauseMs)||1000),state=cursorFor(options.cursor,store),jar=new Map(),seen=new Set(state.seenSkus);
 const accepted=[],rejected=[],pages=[];let requests=0,lastRequest=0,error=null;
 async function read(input){
  let url=allowedUrl(input,store);
  for(let redirect=0;redirect<4;redirect++){
   if(requests>=maxRequests)throw fail("hit-request-budget-exhausted");
   const wait=pauseMs-(now()-lastRequest);if(requests&&wait>0)await delay(wait);
   const headers={Accept:"text/html"},target=new URL(url),cookies=[];
   for(const [key,cookie]of jar){if(cookie.expires<=now()){jar.delete(key);continue;}if(target.pathname===cookie.path||target.pathname.startsWith(cookie.path.endsWith("/")?cookie.path:cookie.path+"/"))cookies.push(cookie);}
   if(cookies.length)headers.Cookie=cookies.sort((a,b)=>b.path.length-a.path.length).map(c=>c.name+"="+c.value).join("; ");
   requests++;lastRequest=now();
   const response=await fetchImpl(url,{method:"GET",headers,redirect:"manual",signal:AbortSignal.timeout(15000)});
   // Only cookies actually issued by the same public host are used in this isolated guest session.
   for(const issued of response.headers.getSetCookie?.()||[]){
    const parts=issued.split(";"),pair=parts.shift(),match=pair.match(/^([A-Za-z0-9_-]+)=([^\r\n;]*)$/);if(!match)continue;
    const domain=parts.find(x=>/^\s*domain=/i.test(x))?.split("=").slice(1).join("=").trim().replace(/^\./,"").toLowerCase();
    if(domain&&!["hit.de","www.hit.de"].includes(domain))continue;
    const issuedPath=parts.find(x=>/^\s*path=/i.test(x))?.split("=").slice(1).join("=").trim(),defaultPath=target.pathname.slice(0,target.pathname.lastIndexOf("/"))||"/",path=issuedPath?.startsWith("/")?issuedPath:defaultPath;
    const maxAge=parts.find(x=>/^\s*max-age=/i.test(x))?.split("=")[1]?.trim(),expiresRaw=parts.find(x=>/^\s*expires=/i.test(x))?.split("=").slice(1).join("=").trim();
    const expires=maxAge!==undefined&&/^-?\d+$/.test(maxAge)?now()+Number(maxAge)*1000:expiresRaw&&Number.isFinite(Date.parse(expiresRaw))?Date.parse(expiresRaw):Infinity,key=match[1]+"@"+path;
    if(expires<=now()||!match[2])jar.delete(key);else if(jar.size<20||jar.has(key))jar.set(key,{name:match[1],value:match[2],path,expires});
   }
   if([301,302,303,307,308].includes(response.status)){const target=response.headers.get("location");if(!target)throw fail("hit-invalid-redirect");url=allowedUrl(new URL(target,url).href,store);continue;}
   if(response.status===403||response.status===429){const e=fail("hit-source-http-"+response.status),retry=response.headers.get("retry-after"),wait=/^\d+$/.test(retry||"")?Number(retry)*1000:Date.parse(retry)-now();e.retryAfterMs=Math.max(3600000,Number.isFinite(wait)?wait:0);throw e;}
   if(response.status!==200)throw fail("hit-source-http-"+response.status);
   if(!/text\/html/i.test(response.headers.get("content-type")||""))throw fail("hit-response-html-required");
   const body=await response.text();if(Buffer.byteLength(body)>6*1024*1024)throw fail("hit-response-too-large");
   const capturedAt=new Date(now()).toISOString();
   return{body,meta:{storeProfile:store,capturedAt,responseDate:response.headers.get("date"),responseAgeSeconds:response.headers.get("age")===null?null:Number(response.headers.get("age")),sourceResponseHash:hash(body),sourceResponseUrl:url}};
  }
  throw fail("hit-redirect-limit");
 }
 const market=await read(store.officialUrl),selection=new URL(store.officialUrl);selection.searchParams.set("mein-markt","1");
 // The choice must be offered in the actual official market page; no location cookie is invented.
 const linked=[...market.body.matchAll(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s<>"']+))/gi)].map(x=>(x[1]??x[2]??x[3]).replace(/&amp;/g,"&")).some(x=>{try{return new URL(x,store.officialUrl).href===selection.href}catch{return false;}});
 if(!linked)throw fail("hit-public-market-selection-link-required");
 await read(selection.href);
 while(requests<maxRequests){
  const url=new URL("https://www.hit.de/sortiment/uebersicht");if(state.nextPage)url.searchParams.set("page",String(state.nextPage));
  try{
   const page=await read(url.href),parsed=Client.parsePage(page.body,page.meta),pagination=parsed.nativePagination;
   if(parsed.extractionKind!=="assortment-list"||!pagination||pagination.page!==state.nextPage||!Number.isSafeInteger(pagination.total)||pagination.total>100000||!Number.isSafeInteger(pagination.limit)||pagination.limit<1||pagination.limit>200||parsed.rowCount>pagination.limit)throw fail("hit-native-pagination-unconfirmed");
   if(state.total!==null&&(state.total!==pagination.total||state.limit!==pagination.limit))throw fail("hit-native-pagination-count-drift");
   if(state.nextPage*pagination.limit>=pagination.total&&pagination.total!==0||parsed.rowCount===0&&pagination.total>0)throw fail("hit-native-pagination-stalled");
   if(parsed.rejected.some(row=>row.reasons?.some(reason=>/store.*conflict|store.*required/.test(reason))))throw fail("hit-native-store-conflict");
   const expected=Math.min(pagination.limit,Math.max(0,pagination.total-state.nextPage*pagination.limit));
   if(parsed.rowCount!==expected)throw fail("hit-native-pagination-row-count-conflict");
   const skus=Client.extractRows(page.body).rows.map(row=>row?.external_id);
   if(skus.some(sku=>typeof sku!=="string"||!/^\d{1,24}[A-Z]{1,3}$/.test(sku)||seen.has(sku))||new Set(skus).size!==skus.length)throw fail("hit-native-pagination-repeated-sku");
   const incoming=parsed.accepted.map(c=>({key:[c.gtin,c.normalizedPack.unit,c.normalizedPack.amount/c.packCount,c.packCount].join("|"),quote:{gtin:c.gtin,signature:hash(JSON.stringify([c.name,c.priceCents,c.depositCents,c.nativePriceType]))}})),conflicts=incoming.filter(q=>state.seenQuotes[q.key]&&state.seenQuotes[q.key].signature!==q.quote.signature);
   if(conflicts.length)throw Object.assign(fail("hit-native-cross-page-identity-conflict"),{conflictGtins:[...new Set(conflicts.map(q=>q.quote.gtin))]});
   for(const q of incoming)state.seenQuotes[q.key]=q.quote;
   for(const sku of skus)seen.add(sku);state.seenSkus.push(...skus);
   accepted.push(...parsed.accepted);rejected.push(...parsed.rejected);pages.push({...page.meta,rowCount:parsed.rowCount,accepted:parsed.accepted.length,rejected:parsed.rejected.length,pagination});
   state.total=pagination.total;state.limit=pagination.limit;state.nextPage++;state.pagesFetched++;state.received+=parsed.rowCount;
   if(state.received>=state.total)break;
  }catch(e){error={code:e.code||e.message,retryAfterMs:Math.max(3600000,Number(e.retryAfterMs)||0),...(e.conflictGtins?{conflictGtins:e.conflictGtins}:{})};break;}
 }
 const complete=!error&&state.total!==null&&state.received===state.total;
 return{sourceId:SOURCE,accepted,rejected,pages,requests,complete,physicalStoreAssortmentComplete:false,cursor:complete?null:state,total:state.total,pagesFetched:state.pagesFetched,received:state.received,error};
}
module.exports={SOURCE,COOLDOWN_UNTIL,allowedUrl,cursorFor,collect};
