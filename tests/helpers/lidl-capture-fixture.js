"use strict";
const original=require('../fixtures/retailers/lidl-dated-publication-capture.json');
const Pub=require('../../lidl-price-publications');
function rehash(raw){raw.sourceResponseHash=Pub.hash(raw.body);return raw;}
function fixture(at=original.capturedAt){const raw=structuredClone(original);raw.capturedAt=new Date(at).toISOString();raw.headers.date=new Date(at).toUTCString();return raw;}
// Change both native payload and independently rendered list for synthetic cases.
function changeArticle(raw,change){
 raw.body=raw.body.replace(/(<div\b[^>]*\bdata-props=")([^"]+)("[^>]*>)/gi,(all,before,encoded,after)=>{
  let data;try{data=JSON.parse(decodeURIComponent(encoded));}catch{return all;}
  if(data.componentName!=='LiCoContentArticleModule')return all;
  data.componentData.introRichText=change(data.componentData.introRichText);
  return before+encodeURIComponent(JSON.stringify(data))+after;
 });
 const parts=raw.body.split(/(<div\b[^>]*\bdata-props="[^"]+"[^>]*>)/gi);raw.body=parts.map(part=>part.includes('data-props="')?part:change(part)).join('');
 return rehash(raw);
}
module.exports={fixture,rehash,changeArticle};
