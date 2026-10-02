"use strict";
const crypto=require("node:crypto"),Client=require("./hit-assortment-client"),Identity=require("./product-identity"),Clock=require("./current-price-query-service");
const SOURCE=Client.SOURCE,COOLDOWN_UNTIL="2026-10-01T19:51:16.522Z";
const fail=code=>Object.assign(new Error(code),{code});
const hash=body=>crypto.createHash("sha256").update(body).digest("hex");
function allowedUrl(input,store){
 let url;try{url=new URL(input)}catch{throw fail("hit-request-url-not-allowed");}
 if(url.protocol!=="https:"||url.hostname!=="www.hit.de"||url.port||url.username||url.password||url.hash)throw fail("hit-request-url-not-allowed");
 const market=url.pathname===new URL(store.officialUrl).pathname;
 if(market){if([...url.searchParams].some(([key,value])=>key!=="mein-markt"||value!=="1")||url.searchParams.getAll("mein-markt").length>1)throw fail("hit-request-url-not-allowed");}
 else {
  const category=url.pathname.match(/^\/sortiment\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+-(\d+)$/i);
  if(!["/sortiment","/sortiment/uebersicht"].includes(url.pathname)&&!category)throw fail("hit-request-url-not-allowed");
  if([...url.searchParams].some(([key,value])=>key!=="markt"||value!==store.storeNumber)||url.searchParams.getAll("markt").length>1)throw fail("hit-request-url-not-allowed");
 }
 return url.href;
}
const integer=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000;
const object=value=>value&&typeof value==="object"&&!Array.isArray(value);
const validGtin=value=>typeof value==="string"&&/^(?:\d{8}|\d{12,14})$/.test(value)&&Identity.gtinValid(value);
const validConflictGtins=value=>Array.isArray(value)&&value.length<=100000&&value.every(validGtin)&&new Set(value).size===value.length;
function validDay(value){return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;}
function nativeNode(raw,store){
 if(!object(raw)||typeof raw.id!=="string"||!/^\d+$/.test(raw.id)||![1,2,3].includes(raw.level)||raw.count!==null&&!integer(raw.count)||typeof raw.url!=="string")throw fail("hit-native-category-invalid");
 const url=allowedUrl(raw.url,store),id=new URL(url).pathname.match(/-(\d+)$/)?.[1];if(id!==raw.id)throw fail("hit-native-category-url-id-conflict");
 return{id:raw.id,name:typeof raw.name==="string"?raw.name.slice(0,300):"",url,level:raw.level,count:raw.count,order:Number.isSafeInteger(raw.order)?raw.order:null,parentId:typeof raw.parentId==="string"?raw.parentId:null,observedChildIds:Array.isArray(raw.observedChildIds)?raw.observedChildIds.filter(id=>typeof id==="string"&&/^\d+$/.test(id)):[],evidence:raw.evidence};
}
function coverageFor(state){
 return{visited:state.visited.length,pending:state.pending.length,truncatedLeaves:state.visited.filter(n=>n.truncated).map(n=>({id:n.id,url:n.url,total:n.total,received:n.rowCount})),unresolvedNodes:state.visited.filter(n=>n.unresolved).map(n=>({id:n.id,url:n.url,total:n.total,received:n.rowCount,reason:n.unresolvedReason||"native-category-children-unconfirmed"})),conflictingIdentities:[...(state.conflictGtins||[])]};
}
function cursorFor(raw,store,cursorDay=Clock.today()){
 if(!validDay(cursorDay))throw fail("hit-continuation-cursor-conflict");
 const initial={version:2,cursorDay,nativeStoreId:store.storeId,nativeStoreNumber:store.storeNumber,total:null,pagesFetched:0,received:0,initialIndexLoaded:false,overviewLoaded:false,pending:[],visited:[],seenSkus:[],seenQuotes:{},conflictGtins:[],categoryCoverage:{visited:0,pending:0,truncatedLeaves:[],unresolvedNodes:[],conflictingIdentities:[]}};
 if(raw==null)return initial;
 if(!object(raw)||raw.version!==2||!validDay(raw.cursorDay)||raw.nativeStoreId!==store.storeId||raw.nativeStoreNumber!==store.storeNumber||!integer(raw.pagesFetched)||!integer(raw.received)||raw.total!==null&&!integer(raw.total)||typeof raw.initialIndexLoaded!=="boolean"||typeof raw.overviewLoaded!=="boolean"||!Array.isArray(raw.pending)||!Array.isArray(raw.visited)||raw.pending.length>10000||raw.visited.length>10000||raw.visited.length!==raw.pagesFetched||!Array.isArray(raw.seenSkus)||raw.seenSkus.length!==raw.received||raw.seenSkus.some(s=>typeof s!=="string"||!/^\d{1,24}[A-Z]{1,3}$/.test(s))||new Set(raw.seenSkus).size!==raw.received||!object(raw.seenQuotes)||Object.keys(raw.seenQuotes).length>100000||Object.values(raw.seenQuotes).some(q=>!object(q)||!/^[a-f0-9]{64}$/.test(q.signature)||!validGtin(q.gtin))||!validConflictGtins(raw.conflictGtins===undefined?[]:raw.conflictGtins))throw fail("hit-continuation-cursor-conflict");
 let pending;try{pending=raw.pending.map(n=>nativeNode(n,store))}catch{throw fail("hit-continuation-cursor-conflict")}
 if(new Set(pending.map(n=>n.id)).size!==pending.length)throw fail("hit-continuation-cursor-conflict");
 for(const v of raw.visited){
  if(!object(v)||v.id!==null&&(typeof v.id!=="string"||!/^\d+$/.test(v.id))||!integer(v.total)||!integer(v.rowCount)||!integer(v.uniqueRowCount)||v.uniqueRowCount>v.rowCount||!Array.isArray(v.children)||v.children.some(id=>typeof id!=="string"||!/^\d+$/.test(id))||typeof v.truncated!=="boolean"||typeof v.unresolved!=="boolean"||!validConflictGtins(v.conflictGtins===undefined?[]:v.conflictGtins)||(v.conflictGtins?.length||0)>Math.min(v.rowCount,200))throw fail("hit-continuation-cursor-conflict");
  try{allowedUrl(v.url,store)}catch{throw fail("hit-continuation-cursor-conflict")}
  if(v.id!==null&&new URL(v.url).pathname.match(/-(\d+)$/)?.[1]!==v.id)throw fail("hit-continuation-cursor-conflict");
 }
 const conflictGtins=raw.conflictGtins===undefined?[]:raw.conflictGtins,observedConflicts=new Set(raw.visited.flatMap(v=>v.conflictGtins||[]));
 if(observedConflicts.size!==conflictGtins.length||conflictGtins.some(gtin=>!observedConflicts.has(gtin)))throw fail("hit-continuation-cursor-conflict");
 if(raw.visited.reduce((n,v)=>n+v.uniqueRowCount,0)!==raw.received||new Set(raw.visited.map(v=>v.id)).size!==raw.visited.length||pending.some(n=>raw.visited.some(v=>v.id===n.id))||!raw.initialIndexLoaded&&(raw.overviewLoaded||raw.pagesFetched||pending.length)||raw.overviewLoaded&&raw.total===null)throw fail("hit-continuation-cursor-conflict");
 const state={...raw,pending,visited:structuredClone(raw.visited),seenSkus:[...raw.seenSkus],seenQuotes:structuredClone(raw.seenQuotes),conflictGtins:[...conflictGtins]};state.categoryCoverage=coverageFor(state);return state;
}
async function collect(options={}){
 const store=options.storeProfile,now=typeof options.now==="function"?options.now:Date.now,fetchImpl=options.fetchImpl||fetch,delay=options.delay||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
 if(!store||!Number.isSafeInteger(store.storeId)||store.storeId<=0||typeof store.storeNumber!=="string"||!/^\d{1,6}$/.test(store.storeNumber)||typeof store.name!=="string"||!store.name.trim()||store.city!=="Berlin"||store.country!=="DE"||!/^https:\/\/www\.hit\.de\/maerkte\/berlin-[a-z-]+$/.test(store.officialUrl||""))throw fail("hit-collector-berlin-profile-required");
 if(now()<Date.parse(COOLDOWN_UNTIL))throw Object.assign(fail("hit-source-initial-cooldown"),{nextAttemptAt:COOLDOWN_UNTIL});
 const maxRequests=options.maxRequests===undefined?8:Number(options.maxRequests);if(!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>16)throw fail("hit-request-budget-invalid");
 const pauseMs=Math.max(1000,Number(options.pauseMs)||1000);if(!Number.isFinite(pauseMs))throw fail("hit-request-pause-invalid");
 // A wrapper supplies one actual-clock day snapshot so a batch crossing midnight has a consistent checkpoint.
 const cursorDay=options.cursorDay??Clock.today(new Date(now())),state=cursorFor(options.cursor,store,cursorDay),jar=new Map(),seen=new Set(state.seenSkus),quarantined=new Set(state.conflictGtins);
 if(state.cursorDay!==cursorDay)throw fail("hit-continuation-day-conflict");
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
 function extractTree(page){
  if(typeof Client.extractCategories!=="function")throw fail("hit-native-category-extractor-required");
  const tree=Client.extractCategories(page.body,page.meta.sourceResponseUrl);
  if(tree.nativeStoreId!=null&&tree.nativeStoreId!==store.storeId)throw fail("hit-native-store-conflict");
  return{...tree,categories:tree.categories.map(node=>nativeNode(node,store))};
 }
 const priority=node=>/kaese-eier-molkerei/.test(node.url)?0:/kochen-backen/.test(node.url)?1:/brot-cerealien/.test(node.url)?2:3;
 function enqueue(nodes){
  const known=new Set([...state.pending.map(n=>n.id),...state.visited.filter(n=>n.id!==null).map(n=>n.id)]);
  for(const node of [...nodes].sort((a,b)=>priority(a)-priority(b)||(a.order??999999)-(b.order??999999)))if(!known.has(node.id)){known.add(node.id);state.pending.push(node);}
  if(state.pending.length+state.visited.length>10000)throw fail("hit-category-queue-bound-exceeded");
 }
 function processPage(page,node){
  const parsed=Client.parsePage(page.body,page.meta),pagination=parsed.nativePagination;
  if(parsed.extractionKind!=="assortment-list"||!pagination||pagination.page!==0||!integer(pagination.total)||!Number.isSafeInteger(pagination.limit)||pagination.limit<1||pagination.limit>200||parsed.rowCount!==Math.min(pagination.limit,pagination.total))throw fail("hit-native-pagination-unconfirmed");
  if(parsed.rejected.some(row=>row.reasons?.some(reason=>/store.*conflict|store.*required/.test(reason))))throw fail("hit-native-store-conflict");
  const tree=extractTree(page);
  if(node?tree.currentCategoryId!==node.id:tree.currentCategoryId!==null)throw fail("hit-native-category-context-conflict");
  const nativeRows=Client.extractRows(page.body).rows,conflictingSkus=new Set(parsed.rejected.filter(row=>row.reasons?.some(reason=>/^hit-conflicting-native-(gtin-pack|sku)-quotes$/.test(reason))).map(row=>row.retailerSku));
  // The parser can reject a duplicate identity before validating that row's store.
  if(nativeRows.some(row=>object(row)&&(row.storeId!==store.storeId||row.storeNumber!==store.storeNumber)))throw fail("hit-native-store-conflict");
  const pageConflicts=new Set(nativeRows.filter(row=>conflictingSkus.has(row?.external_id)&&validGtin(row?.ean)).map(row=>row.ean));
  const skus=nativeRows.map(row=>row?.external_id),pageSkus=new Set();
  for(const sku of skus){if(typeof sku!=="string"||!/^\d{1,24}[A-Z]{1,3}$/.test(sku)||pageSkus.has(sku)&&!conflictingSkus.has(sku))throw fail("hit-native-list-duplicate-or-invalid-sku");pageSkus.add(sku);}
  const quoteKey=c=>[c.gtin,c.normalizedPack.unit,c.normalizedPack.amount/c.packCount,c.packCount].join("|"),incoming=parsed.accepted.map(c=>({key:quoteKey(c),quote:{gtin:c.gtin,signature:hash(JSON.stringify([c.name,c.priceCents,c.depositCents,c.nativePriceType]))}})),conflicts=incoming.filter(q=>state.seenQuotes[q.key]&&state.seenQuotes[q.key].signature!==q.quote.signature);
  for(const q of conflicts)pageConflicts.add(q.quote.gtin);
  // An identity contradicted by any native page stays excluded until this cycle ends.
  for(const row of nativeRows)if(validGtin(row?.ean)&&quarantined.has(row.ean))pageConflicts.add(row.ean);
  const nextConflicts=new Set([...quarantined,...pageConflicts]);if(nextConflicts.size>100000)throw fail("hit-native-identity-bound-exceeded");
  const children=node?tree.categories.filter(c=>c.parentId===node.id&&c.level>node.level):tree.categories.filter(c=>c.level===1),childIds=children.map(c=>c.id),unique=[...pageSkus].filter(sku=>!seen.has(sku));
  const newQuotes=new Set(),pageAccepted=parsed.accepted.filter(c=>{const key=quoteKey(c);if(nextConflicts.has(c.gtin)||state.seenQuotes[key]||newQuotes.has(key))return false;newQuotes.add(key);return true}),truncated=!!node&&node.level===3&&pagination.total>pagination.limit;
  const incompleteChildren=!!node&&node.level<3&&(children.some(c=>c.count===null)||children.length>0&&children.reduce((sum,c)=>sum+c.count,0)<pagination.total||!children.length&&pagination.total>pagination.limit);
  const unresolved=!!tree.rejected?.length||incompleteChildren;
  if(state.received+unique.length>100000)throw fail("hit-native-row-bound-exceeded");
  if(new Set([...Object.keys(state.seenQuotes),...incoming.map(q=>q.key)]).size>100000)throw fail("hit-native-identity-bound-exceeded");
  enqueue(children);
  for(const gtin of pageConflicts)if(!quarantined.has(gtin)){quarantined.add(gtin);state.conflictGtins.push(gtin);}
  // Keep the first real native signature rather than replacing it with a contradiction.
  for(const q of incoming)if(!state.seenQuotes[q.key])state.seenQuotes[q.key]=q.quote;
  for(const sku of unique)seen.add(sku);state.seenSkus.push(...unique);
  const pageRejected=[...parsed.rejected,...parsed.accepted.filter(c=>nextConflicts.has(c.gtin)).map(c=>({retailerSku:c.retailerSku,gtin:c.gtin,reasons:["hit-conflicting-native-gtin-cycle-quarantine"]}))];
  accepted.push(...pageAccepted);rejected.push(...pageRejected);
  pages.push({...page.meta,rowCount:parsed.rowCount,uniqueRowCount:unique.length,accepted:pageAccepted.length,rejected:pageRejected.length,pagination,categoryId:node?.id??null,children:childIds,truncated,conflictGtins:[...pageConflicts]});
  state.visited.push({id:node?.id??null,url:page.meta.sourceResponseUrl,level:node?.level??null,total:pagination.total,rowCount:parsed.rowCount,uniqueRowCount:unique.length,children:childIds,truncated,unresolved,conflictGtins:[...pageConflicts],...(unresolved?{unresolvedReason:tree.rejected?.length?"native-category-discovery-rejected":"native-category-children-unconfirmed"}:{})});
  state.pagesFetched++;state.received+=unique.length;
  return pagination;
 }
 while(requests<maxRequests){
  try{
   if(!state.initialIndexLoaded){
    const index=await read("https://www.hit.de/sortiment"),tree=extractTree(index),roots=tree.categories.filter(n=>n.level===1);
    if(!roots.length||tree.rejected?.length)throw fail("hit-public-category-navigation-required");
    enqueue(roots);state.initialIndexLoaded=true;
   }else if(!state.overviewLoaded){const page=await read("https://www.hit.de/sortiment/uebersicht"),pagination=processPage(page,null);state.total=pagination.total;state.overviewLoaded=true;}
   else if(state.pending.length){
    let selectedIndex=0;for(let index=1;index<state.pending.length;index++)if(priority(state.pending[index])<priority(state.pending[selectedIndex]))selectedIndex=index;
    const node=state.pending[selectedIndex],page=await read(node.url);
    // Children append during processing; remove this exact node only after success.
    processPage(page,node);state.pending.splice(selectedIndex,1);
   }
   else break;
  }catch(e){error={code:e.code||e.message,retryAfterMs:Math.max(3600000,Number(e.retryAfterMs)||0),...(e.conflictGtins?{conflictGtins:e.conflictGtins}:{})};break;}
 }
 // A later category may contradict a quote accepted earlier in this same batch.
 for(let index=accepted.length-1;index>=0;index--)if(quarantined.has(accepted[index].gtin)){
  const removed=accepted.splice(index,1)[0],page=pages.find(p=>p.sourceResponseUrl===removed.sourceResponseUrl&&p.sourceResponseHash===removed.sourceResponseHash&&p.capturedAt===removed.capturedAt);
  if(page){page.accepted--;page.rejected++;}
  rejected.push({retailerSku:removed.retailerSku,gtin:removed.gtin,reasons:["hit-conflicting-native-gtin-cycle-quarantine"]});
 }
 state.categoryCoverage=coverageFor(state);
 const complete=!error&&state.initialIndexLoaded&&state.overviewLoaded&&state.pending.length===0,nativePaginationComplete=complete&&state.total!==null&&state.received===state.total&&!state.categoryCoverage.truncatedLeaves.length&&!state.categoryCoverage.unresolvedNodes.length&&!state.conflictGtins.length;
 return{sourceId:SOURCE,cursorDay:state.cursorDay,accepted,rejected,pages,requests,complete,categoryTraversalCycleComplete:complete,nativePaginationComplete,publishedTraversalComplete:nativePaginationComplete,categoryCoverage:state.categoryCoverage,conflictGtins:[...state.conflictGtins],physicalStoreAssortmentComplete:false,cursor:complete?null:state,total:state.total,pagesFetched:state.pagesFetched,received:state.received,error};
}
module.exports={SOURCE,COOLDOWN_UNTIL,allowedUrl,validDay,validConflictGtins,cursorFor,coverageFor,collect};
