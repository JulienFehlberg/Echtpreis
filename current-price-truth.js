"use strict";
const TYPE={official_retailer:.96,retailer_feed:.94,receipt:.90,shelf:.90,open_data:.78,catalog:.76,third_party:.62,unknown:.50};
const ALIAS={first_party_receipt:"receipt",first_party_shelf:"shelf",retailer:"official_retailer",official:"official_retailer"};
function sourceType(r={}){const t=String(r.sourceType||r.kind||"unknown").toLowerCase();return ALIAS[t]||t}
function actor(r={}){return String(r.proofActor||r.contributorId||r.sourceId||r.source||"unknown")}
function base(r={}){const t=sourceType(r),n=Number(r.registryTrust);return Number.isFinite(n)&&n>0?n/100:TYPE[t]||TYPE.unknown}
function fingerprint(r={}){const proof=String(r.proof||"");if(proof.startsWith("receipt:"))return"receipt|"+proof;if(proof.startsWith("photo:")||String(r.proofType||"").includes("shelf"))return"shelf|"+proof;return[sourceType(r),actor(r),r.storeId||r.region||"",r.validFrom||"",r.validTo||""].join("|")}
function dedupe(rows=[]){const m=new Map();for(const r of rows){const k=fingerprint(r),old=m.get(k);if(!old||base(r)>base(old))m.set(k,r)}return[...m.values()]}
function independent(rows=[]){return dedupe(rows).length}
function median(a){const x=a.slice().sort((p,q)=>p-q),n=x.length;if(!n)return null;return n%2?x[(n-1)/2]:(x[n/2-1]+x[n/2])/2}
function fuse(rows=[],opts={}){
 const clean=dedupe(rows.filter(r=>Number(r.price)>0));if(!clean.length)return{state:"unknown",reason:"no-evidence",price:null,evidence:[]};
 const tolerance=Number(opts.tolerance??.015),groups=[];
 for(const r of clean){let g=groups.find(g=>Math.abs(Number(r.price)-g.center)/g.center<=tolerance);if(!g){g={rows:[],center:Number(r.price)};groups.push(g)}g.rows.push(r);g.center=median(g.rows.map(x=>Number(x.price)))}
 const scored=groups.map(g=>{const indep=g.rows.length,strength=g.rows.reduce((s,r)=>s+base(r),0),types=new Set(g.rows.map(sourceType)).size;return{...g,independent:indep,sourceTypes:types,strength:strength+Math.min(.35,(indep-1)*.12)+Math.min(.18,(types-1)*.06)}}).sort((a,b)=>b.strength-a.strength);
 const best=scored[0],runner=scored[1];if(runner&&runner.strength>=best.strength*.82&&Math.abs(best.center-runner.center)/best.center>.04)return{state:"conflict",reason:"competing-evidence-clusters",price:null,clusters:scored.slice(0,3)};
 return{state:best.independent>=2||best.strength>=.94?"supported":"observed",reason:best.independent>=2?"independent-consensus":"strongest-evidence",price:best.center,evidence:best.rows,independentEvidence:best.independent,sourceTypes:best.sourceTypes,strength:best.strength};
}
module.exports={TYPE,ALIAS,sourceType,actor,base,fingerprint,dedupe,independent,median,fuse};
