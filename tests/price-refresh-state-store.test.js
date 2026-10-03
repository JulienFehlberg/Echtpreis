"use strict";
const assert=require("node:assert/strict"),S=require("../price-refresh-state-store"),pgUtils=require("pg/lib/utils");
(async()=>{
 let leased=false,saved=false;const updates=[];
 const pool={query:async(sql,args)=>{
  if(sql.startsWith("CREATE")||sql.includes("CREATE TABLE"))return{rows:[],rowCount:0};
  if(sql.startsWith("INSERT INTO price_source_refresh_state")){if(leased)return{rows:[],rowCount:0};leased=true;return{rows:[{source_name:args[0]}],rowCount:1};}
  if(sql.startsWith("UPDATE price_source_refresh_state SET last_attempt")){updates.push(args);saved=true;leased=false;return{rows:[],rowCount:1};}
  if(sql.startsWith("UPDATE price_source_refresh_state SET lease_owner=NULL")){leased=false;return{rows:[],rowCount:1};}
  if(sql.startsWith("SELECT source_name"))return{rows:[]};return{rows:[],rowCount:0};
 }};
 assert.equal(await S.acquire(pool,"Open Prices","a"),true);assert.equal(await S.acquire(pool,"Open Prices","b"),false);
 assert.equal(await S.save(pool,"Open Prices",{lastAttemptAt:"2026-09-30T12:00:00Z",lastSuccessAt:"2026-09-30T12:00:00Z",lastAccepted:5},"a"),true);assert(saved);assert.equal(await S.acquire(pool,"Open Prices","b"),true);
 const ordinary="2026-10-11T12:00:00.000Z",extreme="+275760-09-13T00:00:00.000Z";
 await S.save(pool,"ALDI Nord published assortment",{nextAttemptAt:ordinary},"a");assert.equal(updates.at(-1)[9],ordinary,"Ordinary source deadlines retain their original parameter");
 await S.save(pool,"ALDI Nord published assortment",{nextAttemptAt:extreme},"a");const parameter=updates.at(-1)[9];assert(parameter instanceof Date);assert.equal(parameter.getTime(),8640000000000000);assert.equal(parameter.toISOString(),extreme);
 assert.match(pgUtils.prepareValue(parameter),/^275760-09-13T/,"The actual pg serializer emits the same instant without an ISO leading-plus timezone ambiguity");
 assert.equal(S.timestampParameter(null),null);assert.equal(S.timestampParameter(ordinary),ordinary);assert.equal(S.timestampParameter(parameter),parameter);
 for(const invalid of["+999999-01-01T00:00:00.000Z","+010000-02-31T00:00:00.000Z"]){const before=updates.length;await assert.rejects(S.save(pool,"ALDI Nord published assortment",{nextAttemptAt:invalid},"a"),e=>e.code==="invalid-source-timestamp");assert.equal(updates.length,before);}
 console.log("price-refresh-state-store: lease ownership, ordinary deadlines and exact extended-year pg parameters OK");
})().catch(e=>{console.error(e);process.exitCode=1;});
