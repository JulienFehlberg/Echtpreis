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
 console.log("product-catalog-service: staple-only target, bounded parameterized search, identity-only results and database requirement OK");
}
main().catch(error=>{console.error(error);process.exitCode=1});
