"use strict";
const Original=require('../fixtures/retailers/edeka-counter-original-capture.json');
const Q=require('../../edeka-counter-quotes');
function original(){return structuredClone(Original.raw);}
// Retiming belongs exclusively to synthetic tests. The archived fixture stays unchanged.
function synthetic(at,mutate){
  const raw=original();
  for(const record of Object.values(raw)){record.capturedAt=new Date(at).toISOString();record.headers.date=new Date(at).toUTCString();record.headers.age=null;}
  if(mutate){const rows=JSON.parse(raw.products.body);mutate(rows,raw);raw.products.body=JSON.stringify(rows);raw.products.sourceResponseHash=Q.hash(raw.products.body);raw.products.bytes=Buffer.byteLength(raw.products.body);}
  return raw;
}
module.exports={original,synthetic};
