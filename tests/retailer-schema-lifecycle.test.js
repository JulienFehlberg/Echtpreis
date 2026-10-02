"use strict";
const assert=require("node:assert/strict"),Schema=require("../retailer-schema-lifecycle"),Dm=require("../published-price-service"),Wolt=require("../wolt-retailer-price-service"),Rewe=require("../rewe-retailer-price-service"),Aldi=require("../aldi-assortment-price-service"),SalesPack=require("../wolt-sales-pack-validation");
const sources=[[Dm,"retailer_published_prices"],[Wolt,Wolt.TABLE],[Rewe,Rewe.TABLE],[Aldi,Aldi.TABLE]],now=Date.parse("2026-10-02T10:00:00Z");
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function database(ddl){const calls=[];return{calls,query(sql,params=[]){calls.push({sql,params});return sql.startsWith("CREATE TABLE")?ddl(sql):Promise.resolve({rows:[],rowCount:0});}};}
const ddlCalls=db=>db.calls.filter(call=>call.sql.startsWith("CREATE TABLE"));
async function main(){
 // No caller may proceed while any part of the initialization is still pending.
 for(const[service,table]of sources){
  const gate=deferred(),db=database(()=>gate.promise),first=service.ensure(db),second=service.ensure(db);let completed=false;
  first.then(()=>{completed=true;});await Promise.resolve();assert.equal(ddlCalls(db).length,1,table);await Promise.resolve();assert.equal(completed,false,table);
  assert.throws(()=>Schema.reset(db,table),error=>error.code==="retailer-schema-initialization-in-progress");
  gate.resolve({rows:[],rowCount:0});await Promise.all([first,second]);
  await service.ensure(db);await service.persist(db,[],{now});await service.search(db,{now});await service.status(db,{now});
  assert.equal(ddlCalls(db).length,1,table+" repeated read/import operations reuse successful initialization");
  assert.equal(Schema.reset(db,table),true);await service.ensure(db);assert.equal(ddlCalls(db).length,2,table+" explicit schema fixture reset reruns DDL");
 }
 // Pool identity and physical table identity are independent cache dimensions.
 const one=database(async()=>({rows:[],rowCount:0})),two=database(async()=>({rows:[],rowCount:0})),nahkauf=Wolt.createService("nahkaufWrangelBerlin");
 await Promise.all([...sources.map(([service])=>service.ensure(one)),nahkauf.ensure(one)]);assert.equal(ddlCalls(one).length,4);
 await Promise.all([...sources.map(([service])=>service.ensure(one)),nahkauf.ensure(one)]);assert.equal(ddlCalls(one).length,4);
 await Promise.all([...sources.map(([service])=>service.ensure(two)),nahkauf.ensure(two)]);assert.equal(ddlCalls(two).length,4,"A new pool must initialize its own schemas");
 const woltDDL=ddlCalls(one).find(call=>call.sql.startsWith("CREATE TABLE IF NOT EXISTS "+Wolt.TABLE)).sql;
 for(const fragment of["wolt_published_approved_venue",Wolt.SOURCE,nahkauf.SOURCE,"DROP CONSTRAINT IF EXISTS",SalesPack.SQL_CONFLICT,"ADD COLUMN IF NOT EXISTS validation_issue","UPDATE "+Wolt.TABLE,"CREATE INDEX IF NOT EXISTS wolt_retailer_published_capture_idx"])assert(woltDDL.includes(fragment),fragment);
 // Failure late in the shared Wolt migration/quarantine cannot publish cached success.
 const migrationGate=deferred(),migration=database(()=>migrationGate.promise),e=Wolt.ensure(migration),n=nahkauf.ensure(migration),failure=Error("LOCAL TEST final quarantine/index failure");
 const failed=Promise.allSettled([e,n]);await Promise.resolve();assert.equal(ddlCalls(migration).length,1);migrationGate.reject(failure);
 for(const result of await failed){assert.equal(result.status,"rejected");assert.equal(result.reason,failure);}
 migration.query=async sql=>{migration.calls.push({sql});return{rows:[],rowCount:0};};await nahkauf.ensure(migration);await Wolt.ensure(migration);assert.equal(ddlCalls(migration).length,2,"Either venue can retry the failed shared physical-table initialization");
 // Synchronous query throws and rejected query promises both remain retryable.
 for(const[service,table]of sources)for(const synchronous of[true,false]){
  let attempts=0;const failure=Error("LOCAL TEST initialization failure"),db=database(()=>{if(++attempts===1){if(synchronous)throw failure;return Promise.reject(failure);}return Promise.resolve({rows:[],rowCount:0});});
  const results=await Promise.allSettled([service.ensure(db),service.ensure(db)]);assert.equal(attempts,1,table);
  for(const result of results){assert.equal(result.status,"rejected");assert.equal(result.reason,failure);}
  await service.ensure(db);await service.ensure(db);assert.equal(attempts,2,table+" failed initialization is retried exactly once");
 }
 const directGate=deferred(),directPool={},direct=Schema.ensure(directPool,"native_table",()=>directGate.promise);
 assert.equal(Schema.ensure(directPool,"native_table",()=>{throw Error("duplicate initializer");}),direct,"Concurrent callers share the actual initialization Promise");
 directGate.resolve();await direct;assert.equal(Schema.ensure(directPool,"native_table",()=>{throw Error("cached initializer");}),direct);
 // A query failure after schema success must not discard and rerun working DDL.
 const readDb=database(async()=>({rows:[],rowCount:0}));await Dm.ensure(readDb);let readFailure=true;
 readDb.query=async sql=>{readDb.calls.push({sql});if(sql.startsWith("SELECT merchant")&&readFailure){readFailure=false;throw Error("LOCAL TEST transient SELECT failure");}return{rows:[],rowCount:0};};
 await assert.rejects(()=>Dm.search(readDb,{now}),/transient SELECT/);await Dm.search(readDb,{now});assert.equal(ddlCalls(readDb).length,1);
 // A later unflagged unsafe title/native pack cannot become a quote after cached DDL.
 const venue=Wolt.VENUE,raw={sourceId:Wolt.SOURCE,merchant:Wolt.MERCHANT,nativeVenueId:venue.nativeVenueId,retailerSku:"1dc18e85145be6774701f54d",gtin:"5449000017888",name:"LOCAL TEST single water",pack:"1 l",packAmount:1,packUnit:"l",packCount:1,price:1.89,deposit:0,displayedPrice:1.89,currency:"EUR",capturedAt:new Date(now-1000).toISOString(),sourceUrl:"https://wolt.com/de/deu/berlin/venue/"+venue.slug,sourceResponseUrl:"https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/"+venue.slug+"/assortment/categories/slug/local-test",proofHash:"a".repeat(64),sourceResponseHash:"a".repeat(64),shop:{...venue,address:"Ritterstr.38-40"},scopeCountry:"DE",scopeChannel:"online"};
 const checked=Wolt.validateOffer(raw,{now});assert.equal(checked.ok,true,JSON.stringify(checked));const valid=checked.offer,unsafe={...valid,name:"Milka Tender Milch, 5 x 37 g",pack:"37 g",packAmount:37,packUnit:"g"},consistent={...unsafe,pack:"185 g",packAmount:185},multi={...unsafe,pack:"5 x 37 g",packCount:5};
 const quoteDb=database(async()=>({rows:[],rowCount:0}));await Wolt.ensure(quoteDb);
 quoteDb.query=async sql=>{quoteDb.calls.push({sql});return{rows:sql.startsWith("SELECT source_id AS")?[unsafe,valid,consistent,multi]:[],rowCount:0};};
 const found=await Wolt.search(quoteDb,{now});assert.equal(found.items.length,2);assert(found.items.every(item=>!(item.name===unsafe.name&&item.packCount===1)),"Both wrong totals and unresolved equal-total structures stay held after cached DDL");assert.equal(ddlCalls(quoteDb).length,1);
 const rejected=await Wolt.persist(quoteDb,[unsafe],{now});assert.equal(rejected.accepted,0);assert.equal(rejected.reasons["wolt-native-sales-pack-conflict"],1);await Wolt.status(quoteDb,{now});
 const reads=quoteDb.calls.filter(call=>call.sql.startsWith("SELECT"));assert.equal(reads.length,3);for(const call of reads){assert(call.sql.includes("NOT ("+SalesPack.SQL_CONFLICT+")"));assert(call.sql.includes("NOT ("+SalesPack.SQL_STRUCTURE_UNRESOLVED+")"));assert(call.sql.includes("validation_issue IS NULL"));assert(call.sql.includes("interval '24 hours'"));assert(call.sql.includes("expires_at>$1"));}
 assert.equal(ddlCalls(quoteDb).length,1);assert(!quoteDb.calls.slice(1).some(call=>call.sql.startsWith("UPDATE")),"Read exclusion does not depend on another modifying quarantine scan");
 console.log("retailer-schema-lifecycle: one successful initialization per pool/table, complete migration coalescing, failed DDL retries, explicit fixture reset and independent post-initialization Wolt pack safety OK");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
