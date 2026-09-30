"use strict";
const Provenance=require("./rewe-source-provenance");
function split(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'&&line[i+1]==='"'){cur+='"';i++;continue}if(ch==='"'){q=!q;continue}if(ch===","&&!q){out.push(cur);cur="";continue}cur+=ch}out.push(cur);return out}
function parse(text=""){const lines=String(text).replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);if(!lines.length)return[];const h=split(lines[0]).map(x=>x.trim().toLowerCase());return lines.slice(1).map(line=>{const v=split(line),o={};h.forEach((k,i)=>o[k]=v[i]??"");return o})}
function rewe(rows=[],meta={}){
 const valid=rows.filter(x=>x.name&&Number.isFinite(Number(String(x.price).replace(",",".")))&&Number(String(x.price).replace(",","."))>0);
 if(!valid.length){Provenance.resolve({},meta);return[]}
 return valid.map(x=>({name:x.name,brand:x.brand&&x.brand!=="None"?x.brand:null,ean:x.ean,price:Number(String(x.price).replace(",",".")),pack:x.grammage||null,category:x.category||null,priceType:String(x.sale).toLowerCase()==="true"?"promotion":"regular",region:meta.region||null,storeId:meta.storeId||null,externalLocationId:meta.externalLocationId||null,...Provenance.resolve(x,meta),sourceUrl:meta.sourceUrl||null}))
}
module.exports={split,parse,rewe};
