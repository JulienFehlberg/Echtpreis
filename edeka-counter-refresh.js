"use strict";
const Quotes=require("./edeka-counter-quotes"),Schema=require("./retailer-schema-lifecycle");
const SOURCE=Quotes.SOURCE,TABLE="edeka_counter_refresh_state",REFRESH_MS=21600000,MAX_BYTES=1500000,MIN_RETRY_MS=3600000;
const allowed=new Set([Quotes.PAGE_URL,Quotes.STORES_URL,Quotes.PRODUCTS_URL,...Quotes.MODULES.map(module=>module.url)]);
const fail=code=>Object.assign(new Error(code),{code});let running=false;
function clock(now){const value=now();if(!Number.isFinite(value)||!Number.isFinite(new Date(value).getTime()))throw fail("edeka-counter-invalid-time");return value;}
function safeRetry(value,now){const delay=Math.max(MIN_RETRY_MS,Number(value)||0);return Number.isFinite(delay)&&Number.isFinite(new Date(now+delay).getTime())?delay:MIN_RETRY_MS;}
function retryAfter(response,now){const raw=response.headers.get("retry-after");return safeRetry(raw===null?null:/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-now,now);}
function continuing(shouldContinue){if(typeof shouldContinue==="function"&&!shouldContinue())throw fail("edeka-counter-refresh-stopped");}
async function ensure(pool){if(!pool)throw fail("database-required");return Schema.ensure(pool,TABLE,()=>pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(source_id text PRIMARY KEY CHECK(source_id='${SOURCE}'),last_completed_at timestamptz,last_error text,next_attempt_at timestamptz,proof_hash text,completed_captures int NOT NULL DEFAULT 0 CHECK(completed_captures>=0),received int NOT NULL DEFAULT 0,accepted int NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now());`));}
async function load(pool){await ensure(pool);return(await pool.query(`SELECT last_completed_at AS "lastCompletedAt",last_error AS "lastError",next_attempt_at AS "nextAttemptAt",proof_hash AS "proofHash",completed_captures AS "completedCaptures",received,accepted FROM ${TABLE} WHERE source_id=$1`,[SOURCE])).rows[0]||{};}
async function get(url,{fetchImpl=fetch,now=Date.now,shouldContinue}={}){
 if(!allowed.has(url))throw fail("edeka-counter-unreviewed-source-url");continuing(shouldContinue);clock(now);
 const response=await fetchImpl(url,{method:"GET",credentials:"omit",redirect:"manual",signal:AbortSignal.timeout(20000),headers:{Accept:"application/json,text/html,application/javascript","User-Agent":"CaddyPriceResearch/1.0 (public counter preorder quote observation)"}}),capturedAt=new Date(clock(now)).toISOString();
 if(response.status!==200)throw Object.assign(fail("edeka-counter-source-http-"+response.status),{retryAfterMs:retryAfter(response,Date.parse(capturedAt))});
 if(response.url&&response.url!==url)throw fail("edeka-counter-source-redirect-unapproved");
 const declared=Number(response.headers.get("content-length"));if(Number.isFinite(declared)&&declared>MAX_BYTES)throw fail("edeka-counter-source-body-too-large");let bytes;
 if(response.body&&typeof response.body.getReader==="function"){
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw fail("edeka-counter-source-body-too-large");}chunks.push(Buffer.from(part.value));}}finally{reader.releaseLock();}bytes=Buffer.concat(chunks);
 }else{bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>MAX_BYTES)throw fail("edeka-counter-source-body-too-large");}
 const body=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
 return{status:200,sourceResponseUrl:url,sourceResponseHash:Quotes.hash(body),body,capturedAt,headers:{date:response.headers.get("date"),age:response.headers.get("age"),"content-type":response.headers.get("content-type")},bytes:bytes.length};
}
function guestModules(guest){
 const urls=[...guest.body.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi)].map(match=>{try{return new URL(match[2],Quotes.PAGE_URL).href;}catch(_){return null;}});
 if(Quotes.MODULES.some(module=>!urls.includes(module.url)))throw fail("edeka-counter-native-guest-modules-required");
}
function berlinStore(stores){
 let rows;try{rows=JSON.parse(stores.body);}catch(_){throw fail("edeka-counter-native-stores-invalid");}
 if(!Array.isArray(rows))throw fail("edeka-counter-native-stores-invalid");
 const matched=rows.filter(row=>row?.id===Quotes.SHOP.nativeStoreId||row?.tenantId===Quotes.SHOP.nativeTenantId),row=matched[0],order=row?.orderSettings;
 if(rows.length>1000||matched.length!==1||row.id!==Quotes.SHOP.nativeStoreId||row.tenantId!==Quotes.SHOP.nativeTenantId||row.name!==Quotes.SHOP.name||row.address!==Quotes.SHOP.address||row.settings?.currency!=="EUR"||row.settings?.locale!=="de"||row.latitude!==52.458088||row.longitude!==13.510366||!Number.isSafeInteger(order?.minOffsetDays)||order.minOffsetDays<3||!Number.isSafeInteger(order?.maxOffsetDays)||order.maxOffsetDays<order.minOffsetDays||order.maxOffsetDays>366)throw fail("edeka-counter-native-Berlin-store-required");
}
async function capture(options={}){
 const raw={},now=options.now||Date.now,getOne=async url=>{continuing(options.shouldContinue);return get(url,options);};
 raw.guest=await getOne(Quotes.PAGE_URL);guestModules(raw.guest);
 for(const module of Quotes.MODULES){if(!["shared","page"].includes(module.key))throw fail("edeka-counter-unreviewed-module-key");raw[module.key]=await getOne(module.url);if(raw[module.key].sourceResponseHash!==module.hash)throw fail("edeka-counter-native-module-hash-required");}
 Quotes.binding(raw,clock(now));
 raw.stores=await getOne(Quotes.STORES_URL);berlinStore(raw.stores);
 raw.products=await getOne(Quotes.PRODUCTS_URL);continuing(options.shouldContinue);Quotes.parseCapture(raw,{now:clock(now)});return raw;
}
async function refresh({pool,now=Date.now}={},deps={}){
 if(!pool)throw fail("database-required");if(running)return{received:0,accepted:0,skipped:"already-running"};running=true;
 try{
  const state=await load(pool),started=clock(now);
  if(state.nextAttemptAt&&Date.parse(state.nextAttemptAt)>started){const nextAttemptAt=new Date(state.nextAttemptAt).toISOString();return{received:0,accepted:0,skipped:"source-cooldown",nextAttemptAt,retryAfter:nextAttemptAt};}
  try{
   continuing(deps.shouldContinue);const raw=await(deps.capture||capture)({fetchImpl:deps.fetchImpl,now,shouldContinue:deps.shouldContinue});continuing(deps.shouldContinue);
   const saved=await(deps.persist||Quotes.persist)(pool,raw,{now:clock(now)}),finished=clock(now),nextAttemptAt=new Date(finished+REFRESH_MS).toISOString();
   await pool.query(`INSERT INTO ${TABLE}(source_id,last_completed_at,last_error,next_attempt_at,proof_hash,completed_captures,received,accepted) VALUES($1,$2,NULL,$3,$4,1,$5,$6) ON CONFLICT(source_id) DO UPDATE SET last_completed_at=EXCLUDED.last_completed_at,last_error=NULL,next_attempt_at=EXCLUDED.next_attempt_at,proof_hash=EXCLUDED.proof_hash,completed_captures=${TABLE}.completed_captures+1,received=EXCLUDED.received,accepted=EXCLUDED.accepted,updated_at=now()`,[SOURCE,new Date(finished).toISOString(),nextAttemptAt,saved.proofHash,saved.received,saved.accepted]);
   return{...saved,sourceId:SOURCE,requests:5,nextAttemptAt,fullAssortment:false,physicalStorePriceVerified:false,normalPriceClassificationVerified:false};
  }catch(error){
   if(error?.code==="edeka-counter-refresh-stopped")return{received:0,accepted:0,skipped:"server-stopping"};
   const code=String(error?.code||error?.message||error).slice(0,300),failed=clock(now),nextAttemptAt=new Date(failed+safeRetry(error?.retryAfterMs,failed)).toISOString();
   await pool.query(`INSERT INTO ${TABLE}(source_id,last_error,next_attempt_at) VALUES($1,$2,$3) ON CONFLICT(source_id) DO UPDATE SET last_error=EXCLUDED.last_error,next_attempt_at=EXCLUDED.next_attempt_at,updated_at=now()`,[SOURCE,code,nextAttemptAt]);throw Object.assign(error,{nextAttemptAt});
  }
 }finally{running=false;}
}
async function status(pool){return{sourceId:SOURCE,...await load(pool),refreshIntervalMinutes:REFRESH_MS/60000,fullAssortment:false,physicalStorePriceVerified:false,normalPriceClassificationVerified:false,scopeChannel:"pickup",serviceType:"counter-preorder"};}
async function resumeAt(pool){const state=await load(pool);return state.nextAttemptAt?new Date(state.nextAttemptAt).toISOString():null;}
module.exports={SOURCE,TABLE,REFRESH_MS,MAX_BYTES,get,capture,refresh,status,resumeAt};
