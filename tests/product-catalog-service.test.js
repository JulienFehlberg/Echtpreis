"use strict";
const assert=require("assert/strict"),Service=require("../product-catalog-service");
async function main(){
 assert.equal(Service.target(),6000);assert.equal(Service.target(98),5000);assert.equal(Service.target(15000),10000);assert.equal(Service.target(Infinity),6000);
 const query=Service.searchSpec({search:"Milch%' OR 1=1 --_\\",family:"milk'; DROP TABLE products; --",limit:10000});
 assert.equal(query.params.at(-1),100);assert.equal(query.params[1],"milk'; DROP TABLE products; --");assert(!query.sql.includes("DROP TABLE"));assert(!query.sql.includes("OR 1=1"));assert(query.params[0].includes("\\%"));assert(query.params[0].includes("\\_"));assert(query.params[0].includes("\\\\"));
 assert(query.sql.includes("cm.basket_family=$2"));assert(query.sql.includes("LIMIT $3"));assert(!/price_observations/.test(query.sql));
 assert.deepEqual(Service.searchSpec({family:"eggs",limit:-1}).params,["eggs",1]);assert.deepEqual(Service.searchSpec().params,[30]);
 for(const method of [Service.status,Service.search,Service.refresh])await assert.rejects(()=>method(null),/catalog-database-required/);
 let sql="";assert.equal(await Service.stapleCount({query:async statement=>{sql=statement;return{rows:[{total:6000}]}}}),6000);assert(sql.includes("product_catalog_metadata"));assert(sql.includes("en:germany"));assert(sql.includes("basket_family IS NOT NULL"));
 // Shutdown during catalogue warmup or acquire cannot start a new scan. Only
 // a successfully acquired catalogue lease is released by its own owner.
 for(const phase of["before-warmup","before-acquire","during-acquire","denied-acquire"]){
  let allowed=phase!=="before-warmup",reads=0,scans=0,acquires=0,releases=0,acquireArgs;
  const db={query:async(statement,args=[])=>{
   reads++;
   if(statement.startsWith("CREATE"))return{rows:[],rowCount:0};
   if(statement.startsWith("SELECT id,source,status"))return{rows:[]};
   if(statement.startsWith("SELECT count(*)")){if(statement.includes("product_catalog_metadata")&&phase==="before-acquire")allowed=false;return{rows:[{total:0}]};}
   if(statement.startsWith("INSERT INTO price_source_refresh_state")){acquires++;acquireArgs=args;allowed=false;return{rows:[],rowCount:phase==="denied-acquire"?0:1};}
   if(statement.startsWith("UPDATE price_source_refresh_state SET lease_owner=NULL")){releases++;assert.equal(args[0],Service.LEASE);assert.equal(args[1],acquireArgs[1]);assert(/^catalog-/.test(args[1]));return{rows:[],rowCount:1};}
   throw Error("Unexpected catalogue shutdown query "+statement);
  }};
  const result=await Service.refresh(db,{}, {shouldContinue:()=>allowed,collect:async()=>{scans++;throw Error("A stopping catalogue must not fetch");}});
  assert.equal(result.skipped,phase==="denied-acquire"?"lease-held":"server-stopping");assert.equal(scans,0);
  assert.equal(acquires,["during-acquire","denied-acquire"].includes(phase)?1:0);assert.equal(releases,phase==="during-acquire"?1:0);
  if(phase==="before-warmup")assert.equal(reads,0);
 }
 console.log("product-catalog-service: staple-only target, bounded parameterized search, identity-only results and database requirement OK");
}
main().catch(error=>{console.error(error);process.exitCode=1});
