"use strict";
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ß/g,"ss").replace(/[^a-z0-9]+/g," ").trim();
const digits=s=>String(s||"").replace(/\D/g,"");
function merchantScore(a,b){const x=norm(a),y=norm(b);if(!x||!y)return 0;if(x===y)return 1;if(x.includes(y)||y.includes(x))return .9;return 0}
function addressScore(q,s){let n=0,w=0;if(q.postalCode){w+=4;if(digits(q.postalCode)===digits(s.postalCode))n+=4}if(q.city){w+=2;if(norm(q.city)===norm(s.city))n+=2}if(q.address){w+=4;const a=norm(q.address),b=norm(s.address);if(a===b)n+=4;else if(a&&b&&(a.includes(b)||b.includes(a)))n+=3}return w?n/w:0}
function externalScore(q,s){if(!q.externalId)return 0;return String(q.externalId)===String(s.externalId)?1:0}
function resolve(q={},stores=[]){
 const ranked=stores.map(s=>{const m=merchantScore(q.merchant,s.merchant),e=externalScore(q,s),a=addressScore(q,s);let score=e?1:m*.45+a*.55;if(q.merchant&&!m)score=0;return{store:s,score,signals:{merchant:m,externalId:e,address:a}}}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
 if(!ranked.length)return{state:"unresolved",storeId:null,confidence:0,reason:"no-store-match",candidates:[]};
 const best=ranked[0],runner=ranked[1],strongIdentity=best.signals.externalId===1||best.signals.address>=.8;if(best.score<.72)return{state:"review",storeId:null,confidence:best.score,reason:"weak-store-match",candidates:ranked.slice(0,3)};
 if(runner&&best.score-runner.score<.08)return{state:"review",storeId:null,confidence:best.score,reason:"ambiguous-store-match",candidates:ranked.slice(0,3)};
 return{state:best.score>=.9&&strongIdentity?"verified":"resolved",storeId:best.store.id,confidence:best.score,reason:best.signals.externalId?"external-id":best.signals.address>=.8?"address":"merchant-address",store:best.store,candidates:ranked.slice(0,3)};
}
module.exports={norm,merchantScore,addressScore,externalScore,resolve};
