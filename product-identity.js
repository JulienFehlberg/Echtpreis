"use strict";
const crypto=require("crypto");
const STOP=new Set(["der","die","das","und","mit","von","im","in","fur","fuer","neu","aktion","angebot"]);
function norm(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ß/g,"ss").replace(/[^a-z0-9%]+/g," ").replace(/\s+/g," ").trim()}
function tokens(s){return norm(s).split(" ").filter(x=>x.length>1&&!STOP.has(x))}
function gtinValid(x){const s=String(x||"").replace(/\D/g,"");if(![8,12,13,14].includes(s.length))return false;let sum=0,odd=true;for(let i=s.length-2;i>=0;i--){sum+=Number(s[i])*(odd?3:1);odd=!odd}return(10-sum%10)%10===Number(s.at(-1))}
function parsePack(s){
 const t=norm(s).replace(/,/g,".");let m=t.match(/\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl)\b/);if(m)return{count:+m[1],amount:+m[2],unit:m[3],total:base(+m[1]*+m[2],m[3])};
 m=t.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl)\b/);if(m)return{count:1,amount:+m[1],unit:m[2],total:base(+m[1],m[2])};
 m=t.match(/\b(\d+)\s*(stk|stuck|piece|eier|rollen|kapseln)\b/);if(m)return{count:+m[1],amount:+m[1],unit:"piece",total:{amount:+m[1],unit:"piece"}};return null;
}
function base(amount,unit){if(unit==="kg")return{amount:amount*1000,unit:"g"};if(unit==="l")return{amount:amount*1000,unit:"ml"};if(unit==="cl")return{amount:amount*10,unit:"ml"};return{amount,unit}}
function similarity(a,b){const A=new Set(tokens(a)),B=new Set(tokens(b));if(!A.size||!B.size)return 0;let h=0;for(const x of A)if(B.has(x))h++;return h/Math.max(A.size,B.size)}
function packScore(a,b){const A=a?.total||a,B=b?.total||b;if(!A||!B)return .5;if(A.unit!==B.unit)return 0;const d=Math.abs(A.amount-B.amount)/Math.max(A.amount,B.amount);return d<=.01?1:d<=.05?.85:d<=.15?.45:0}
function canonicalId(p){if(p.gtin&&gtinValid(p.gtin))return"gtin:"+String(p.gtin).replace(/\D/g,"");return"ep:"+crypto.createHash("sha1").update([norm(p.brand),norm(p.name),JSON.stringify(parsePack(p.pack||p.name)||{})].join("|")).digest("hex").slice(0,20)}
function match(query,candidate){
 if(query.gtin&&candidate.gtin&&gtinValid(query.gtin)&&String(query.gtin).replace(/\D/g,"")===String(candidate.gtin).replace(/\D/g,""))return{score:1,level:"exact",reason:"gtin"};
 const name=similarity(query.name||query.rawName,candidate.name),brand=query.brand&&candidate.brand?similarity(query.brand,candidate.brand):.5,pack=packScore(parsePack(query.pack||query.name||query.rawName),parsePack(candidate.pack||candidate.name));
 const score=name*.58+brand*.17+pack*.25;return{score:Math.round(score*1000)/1000,level:score>=.92?"exact":score>=.78?"probable":score>=.62?"family":"reject",reason:"attributes"};
}
function identityClass(m){return m.level==="exact"?"ground-truth":m.level==="probable"?"reviewable":m.level==="family"?"comparison-only":"reject"}
module.exports={norm,tokens,gtinValid,parsePack,base,similarity,packScore,canonicalId,match,identityClass};
