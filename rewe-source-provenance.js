"use strict";
// HTTP Date, Last-Modified, fetch time and Git commit publication are transport
// metadata. Only an explicit source observation/collection date dates a price.
function error(code){const result=new Error(code);result.code=code;return result}
function date(value,today=new Date().toISOString().slice(0,10)){
 const input=String(value??"").trim();
 if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(input))throw error("rewe-source-date-invalid");
 const instant=new Date(input.length===10?input+"T00:00:00Z":input);
 if(!Number.isFinite(instant.getTime())||instant.toISOString().slice(0,10)!==input.slice(0,10))throw error("rewe-source-date-invalid");
 const result=input.slice(0,10);if(result>today)throw error("rewe-source-date-future");return result;
}
function resolve(row={},meta={}){
 const supplied=[];
 for(const key of["source_date","observation_date","observed_date","observed_at","date"]){if(row[key]!=null&&String(row[key]).trim())supplied.push({value:row[key],basis:"csv-"+key})}
 if(meta.sourceDate!=null&&String(meta.sourceDate).trim()){
  const basis=meta.sourceDateBasis||"explicit-source-collection-date";
  if(/fetch|http|last.?modified|commit|publish/i.test(basis))throw error("rewe-source-date-transport-only");
  supplied.push({value:meta.sourceDate,basis});
 }
 if(!supplied.length)throw error("rewe-source-date-required");
 const resolved=supplied.map(entry=>({...entry,date:date(entry.value,meta.today)}));
 if(new Set(resolved.map(entry=>entry.date)).size>1)throw error("rewe-source-date-conflict");
 return{date:resolved[0].date,sourceDateBasis:resolved[0].basis};
}
module.exports={date,resolve};
