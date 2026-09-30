const assert=require("assert"),fs=require("fs"),Import=require("../external-price-import");
const source=fs.readFileSync("server.js","utf8"),start=source.indexOf("async function initDb()"),open=source.indexOf("`",start),close=source.indexOf("`",open+1),ddl=source.slice(open+1,close);
const tables=new Map();
for(const statement of ddl.split(";")){
 const create=statement.match(/^\s*CREATE TABLE IF NOT EXISTS (\w+)\((.*)\)$/s);
 if(create){
  for(const reference of statement.matchAll(/REFERENCES (\w+)\(/g))
   assert(tables.has(reference[1]),"fresh schema references missing table: "+reference[1]);
  tables.set(create[1],new Set([...create[2].matchAll(/(?:^|,)\s*(\w+)\s+(?:text|uuid|numeric|int|integer|date|boolean|jsonb|timestamptz)\b/gi)].map(m=>m[1])));
 }
 const alter=statement.match(/^\s*ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/);
 if(alter){assert(tables.has(alter[1]),"ALTER before CREATE: "+alter[1]);tables.get(alter[1]).add(alter[2]);}
}
const spec=Import.insertSpec(Import.observation({price:1},"batch")),columns=spec.sql.match(/price_observations\(([^)]+)\)/)[1].split(",");
for(const column of columns)assert(tables.get("price_observations").has(column),"import requires missing database column: "+column);
for(const column of ['brand','pack','proof_hash','proof_actor','external_product_id'])assert(tables.get("price_observations").has(column));
console.log("current-price-schema: fresh DDL order and import columns ok");
