"use strict";
const assert=require("assert/strict"),Coverage=require("../canonical-store-coverage"),Gaps=require("../canonical-store-gap-targets");
async function main(){
 const productId="11111111-1111-4111-8111-111111111111",storeId="22222222-2222-4222-8222-222222222222",missingId="33333333-3333-4333-8333-333333333333";
 const queried=[],rows=[{storeId,merchant:"REWE",address:"Covered 1",covered:true,lastObservedAt:new Date("2026-09-30T10:00:00Z")},{storeId:missingId,merchant:"REWE",address:"Missing 2",covered:false,lastObservedAt:null}];
 const pool={query:async(sql,params)=>{queried.push({sql,params});return sql.startsWith("SELECT")?{rows}:{rows:[]}}};
 const result=await Coverage.product(pool,{productId,merchant:"REWE",freshHours:24});
 assert.equal(result.totalStores,2);assert.equal(result.coveredStores,1);assert.equal(result.missingStores,1);assert.equal(result.coverage,.5);assert.equal(result.freshHours,24);
 const targets=Gaps.rank(result);assert.equal(targets.length,1);assert.equal(targets[0].storeId,missingId);assert.equal(targets[0].productId,productId);
 const query=queried.find(value=>value.sql.startsWith("SELECT"));assert.deepEqual(query.params,[24,productId,["rewe","rewe","rewe","rewe"]]);
 assert(query.sql.includes("JOIN merchants m ON m.id=s.merchant_id"));assert(query.sql.includes("MAX(m.name) AS merchant"));assert(!/s\.(merchant|name)\b/.test(query.sql));
 assert(query.sql.includes("s.active=true"));assert(query.sql.includes("m.active=true"));assert(query.sql.includes("upper(s.country)='DE'"));assert(query.sql.includes("po.currency='EUR'"));
 assert(query.sql.includes("po.date<="));assert(query.sql.includes("Europe/Berlin"));assert(query.sql.includes("po.valid_from IS NULL"));assert(query.sql.includes("po.valid_to IS NULL"));
 assert(query.sql.includes("'NaN'::numeric"));assert(!query.sql.includes("po.fetched_at"),"Re-fetching must not make an old observation fresh");
 const attacked=Coverage.querySpec({gtin:"3017 620422003",merchant:"REWE' OR true --",freshHours:999});assert.equal(attacked.freshHours,168);assert.equal(attacked.params[1],"3017620422003");assert(!attacked.sql.includes("OR true --"));
 for(const value of[Infinity,NaN,-1,0,"bad"])assert.equal(Coverage.querySpec({productId,freshHours:value}).freshHours,24);
 const alias=Coverage.querySpec({productId,merchant:"ALDI SÜD"});assert(alias.params[2].includes("aldi-sued"));assert(alias.sql.includes("m.normalized_name=ANY"));
 assert.throws(()=>Coverage.querySpec({}),/product-identity-required/);await assert.rejects(Coverage.product(null,{productId}),/database-required/);
 const empty=await Coverage.product({query:async()=>({rows:[]})},{productId});assert.equal(empty.totalStores,0);assert.equal(empty.coverage,0);assert.equal(empty.missingStores,0);
 console.log("canonical-store-coverage: canonical merchant scope, current DE/EUR query bounds, safe parameters and actionable coverage gaps OK");
}
main().catch(error=>{console.error(error);process.exitCode=1});
