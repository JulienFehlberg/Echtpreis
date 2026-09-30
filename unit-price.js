"use strict";
function parse(x){
 if(x==null)return null;const s=String(x).toLowerCase().replace(",",".").replace(/\s+/g," ").trim();
 let m=s.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl|stk|stuck|stück)/);if(m)return normalize(Number(m[1])*Number(m[2]),m[3]);
 m=s.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl|stk|stuck|stück)/);return m?normalize(Number(m[1]),m[2]):null;
}
function normalize(amount,unit){unit=String(unit).toLowerCase();if(unit==="kg")return{amount:amount*1000,unit:"g",base:"kg",factor:1000};if(unit==="g")return{amount,unit:"g",base:"kg",factor:1000};if(unit==="l")return{amount:amount*1000,unit:"ml",base:"l",factor:1000};if(unit==="cl")return{amount:amount*10,unit:"ml",base:"l",factor:1000};if(unit==="ml")return{amount,unit:"ml",base:"l",factor:1000};return{amount,unit:"piece",base:"piece",factor:1}}
function unitPrice(price,pack){const p=typeof pack==="object"?pack:parse(pack);if(!(Number(price)>0)||!p||!(p.amount>0))return null;return{price:Number(price)*p.factor/p.amount,per:p.base,pack:p}}
function compare(a,b){if(!a||!b||a.per!==b.per)return null;return a.price-b.price}
function enrich(row){const u=unitPrice(row.price,row.pack||row.packageSize||row.product);return{...row,unitPrice:u?.price??null,unit:u?.per??null,packParsed:u?.pack??null}}
module.exports={parse,normalize,unitPrice,compare,enrich};
