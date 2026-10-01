"use strict";

// A pool owns its schema lifetime. Different services for one physical table share
// the entire initialization, including migrations and historical quarantine.
const pools=new WeakMap();
function ensure(pool,table,initialize){
 let tables=pools.get(pool);
 if(!tables){tables=new Map();pools.set(pool,tables);}
 const existing=tables.get(table);if(existing)return existing.promise;
 const entry={ready:false,promise:null};
 entry.promise=Promise.resolve().then(initialize).then(value=>{entry.ready=true;return value;},error=>{
  if(tables.get(table)===entry)tables.delete(table);
  throw error;
 });
 tables.set(table,entry);return entry.promise;
}
// Explicitly invalidate after intentional schema changes/transaction rollback.
// Never interrupt an initialization and start concurrent DDL for the same table.
function reset(pool,table){
 const tables=pools.get(pool),entry=tables&&tables.get(table);if(!entry)return false;
 if(!entry.ready)throw Object.assign(new Error("retailer-schema-initialization-in-progress"),{code:"retailer-schema-initialization-in-progress"});
 return tables.delete(table);
}
module.exports={ensure,reset};
