"use strict";
const Semantics=require("./source-semantics");
const TYPE={pos_feed:.995,official_retailer:.96,retailer_feed:.94,receipt:.90,shelf:.90,open_data:.78,catalog:.76,third_party:.62,unknown:.50};
const ALIAS={first_party_receipt:"receipt",first_party_shelf:"shelf",retailer:"official_retailer",official:"official_retailer",pos:"pos_feed",official_pos:"pos_feed"};
function sourceType(r={}){const t=String(r.sourceType||r.kind||"unknown").toLowerCase();return ALIAS[t]||t}
function actor(r={}){return String(r.proofActor||r.contributorId||r.sourceId||r.source||"unknown")}
function scope(r={}){return String(r.storeId||r.externalLocationId||r.region||"unknown-location")}
function productScope(r={}){return String(r.productId||r.gtin||r.externalProductId||r.key||r.product||"unknown-product").toLowerCase()}
function truthTier(r={}){const t=sourceType(r);if(t==="pos_feed")return 1;if(t==="official_retailer"||t==="retailer_feed")return 2;if(t==="open_data"||t==="receipt"||t==="shelf")return 3;return 4}
function base(r={}){const t=sourceType(r),n=Number(r.registryTrust);return Number.isFinite(n)&&n>0?n/100:TYPE[t]||TYPE.unknown}
function proofKey(r={}){return String(r.proofHash||r.mediaHash||r.contentHash||r.proof||"")}
function fingerprint(r={}){const hash=r.proofHash||r.mediaHash||r.contentHash;if(hash)return["proof-hash",hash,scope(r),productScope(r)].join("|");const proof=proofKey(r);if(proof)return[sourceType(r),proof,scope(r),productScope(r)].join("|");return[sourceType(r),actor(r),scope(r),productScope(r),r.validFrom||"",r.validTo||"",r.observedAt||r.date||"",r.price||""].join("|")}
function dedupe(rows=[]){const m=new Map();for(const r of rows){const k=fingerprint(r),old=m.get(k);if(!old||base(r)>base(old))m.set(k,r)}return[...m.values()]}
function independent(rows=[]){return dedupe(rows).length}
function median(a){const x=a.slice().sort((p,q)=>p-q),n=x.length;if(!n)return null;return n%2?x[(n-1)/2]:(x[n/2-1]+x[n/2])/2}
function representative(rows=[]){
 const observedTime=r=>{const t=Date.parse(r.observedAt||r.date||"");return Number.isFinite(t)?t:-Infinity},prices=new Map(),preferred=(a,b)=>base(b)-base(a)||observedTime(b)-observedTime(a)||Number(a.price)-Number(b.price)||fingerprint(a).localeCompare(fingerprint(b));
 for(const r of rows){const price=Number(r.price),quote=prices.get(price)||{strength:0,rows:[]};quote.strength+=base(r);quote.rows.push(r);prices.set(price,quote)}
 const quotes=[...prices.values()].map(q=>({...q,row:q.rows.slice().sort(preferred)[0]})).sort((a,b)=>b.strength-a.strength||preferred(a.row,b.row));return quotes[0]?.row||null;
}
function fuse(rows=[],opts={}){
 const priced=rows.filter(r=>Number.isFinite(Number(r.price))&&Number(r.price)>0),eligible=priced.filter(Semantics.truthEligible),clean=dedupe(eligible);if(!clean.length)return{state:"unknown",reason:priced.length?"no-truth-eligible-evidence":"no-evidence",price:null,evidence:[],blockedEvidence:priced.length-eligible.length};
 const tolerance=Number(opts.tolerance??.015),groups=[];
 for(const r of clean){let g=groups.find(g=>Math.abs(Number(r.price)-g.center)/g.center<=tolerance);if(!g){g={rows:[],center:Number(r.price)};groups.push(g)}g.rows.push(r);g.center=median(g.rows.map(x=>Number(x.price)))}
 const scored=groups.map(g=>{const indep=g.rows.length,strength=g.rows.reduce((s,r)=>s+base(r),0),types=new Set(g.rows.map(sourceType)).size;return{...g,independent:indep,sourceTypes:types,strength:strength+Math.min(.35,(indep-1)*.12)+Math.min(.18,(types-1)*.06)}}).sort((a,b)=>b.strength-a.strength);
 const best=scored[0],runner=scored[1];if(runner&&runner.strength>=best.strength*.82&&Math.abs(best.center-runner.center)/best.center>.04)return{state:"conflict",reason:"competing-evidence-clusters",price:null,clusters:scored.slice(0,3)};
 const authoritativeSingle=best.independent===1&&best.rows.some(r=>["pos_feed","official_retailer","retailer_feed"].includes(sourceType(r)))&&base(best.rows[0])>=.94;
 const quote=representative(best.rows);
 return{state:best.independent>=2||authoritativeSingle?"supported":"observed",reason:best.independent>=2?"independent-consensus":authoritativeSingle?"authoritative-source":"strongest-evidence",price:Number(quote.price),representative:quote,evidence:best.rows,independentEvidence:best.independent,sourceTypes:best.sourceTypes,strength:best.strength};
}
module.exports={TYPE,ALIAS,sourceType,truthTier,actor,scope,productScope,proofKey,base,fingerprint,dedupe,independent,median,fuse,truthEligible:Semantics.truthEligible};
