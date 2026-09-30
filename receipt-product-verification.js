"use strict";
const Identity=require("./product-identity");
function verify(item={},product={}){
 if(!product.id)return false;
 const supplied=String(item.gtin||"").trim(),canonical=String(product.gtin||"").trim();
 if(supplied)return /^\d{8,14}$/.test(supplied)&&Identity.gtinValid(supplied)&&supplied===canonical;
 // A claimed catalog UUID alone is never evidence of the purchased SKU.
 const raw=Identity.norm(item.rawName||item.name||item.product),name=Identity.norm(product.name),brand=Identity.norm(product.brand);
 const candidatePack=Identity.parsePack(product.pack||`${product.packCount>1?product.packCount+"x":""}${product.packAmount||""} ${product.packUnit||""}`),observedPack=Identity.parsePack(raw);
 if(!raw||!name||!candidatePack||!observedPack||Identity.packScore(candidatePack,observedPack)!==1||candidatePack.count!==observedPack.count)return false;
 const withoutPack=s=>s.replace(/\b(?:\d+\s*x\s*)?\d+(?:\.\d+)?\s*(?:kg|g|l|ml|cl|stk|stuck|piece|eier|rollen|kapseln)\b/g,"").replace(/\s+/g," ").trim();
 const names=new Set([name,brand?brand+" "+name:name,brand?name+" "+brand:name].map(withoutPack));
 if(!names.has(withoutPack(raw)))return false;
 return !brand||raw.split(" ").some((_,i,a)=>a.slice(i,i+brand.split(" ").length).join(" ")===brand)||name.includes(brand);
}
module.exports={verify};
