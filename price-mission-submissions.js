"use strict";
const crypto=require("crypto");
const STATES=new Set(["submitted","review","verified","rejected","rewarded"]);
function evidenceKey(x={}){return String(x.proofHash||x.mediaHash||x.contentHash||x.proof||"")}
function fingerprint(x={}){return crypto.createHash("sha256").update([x.storeId,x.productId,evidenceKey(x),x.observedAt&&String(x.observedAt).slice(0,10)].join("|")).digest("hex")}
function rewardFingerprint(x={}){return crypto.createHash("sha256").update([x.storeId,x.productId,evidenceKey(x)].join("|")).digest("hex")}
function submission(x={}){
 if(!x.storeId||!x.productId||!x.proof)return{ok:false,reason:"missing-required-evidence"};
 const observedAt=x.observedAt||new Date().toISOString(),price=Number(x.price);
 return{ok:true,id:crypto.randomUUID(),storeId:x.storeId,productId:x.productId,missionId:x.missionId||null,contributorId:x.contributorId||null,price:price>0?price:null,proof:x.proof,proofHash:x.proofHash||x.mediaHash||x.contentHash||null,observedAt,state:"submitted",fingerprint:fingerprint({...x,observedAt}),rewardFingerprint:rewardFingerprint(x)};
}
function verify(s={},v={}){
 if(s.state!=="submitted"&&s.state!=="review")return{ok:false,reason:"invalid-state"};
 if(v.storeMatch!==true)return{ok:false,state:"review",reason:"store-not-verified"};
 if(v.productMatch!==true)return{ok:false,state:"review",reason:"product-not-verified"};
 if(v.proofValid!==true)return{ok:false,state:"review",reason:"proof-not-verified"};
 if(!(Number(s.price)>0))return{ok:false,state:"review",reason:"price-not-extracted"};
 return{ok:true,state:"verified",confidence:Math.min(1,Number(v.confidence||.8)),verifiedAt:new Date().toISOString()};
}
function rewardable(s={},history=[]){if(s.state!=="verified"||s.rewardedAt||!(Number(s.rewardPoints)>0)||!s.rewardFingerprint)return false;return !(history||[]).some(x=>x&&x.id!==s.id&&x.rewardFingerprint===s.rewardFingerprint&&(x.rewardedAt||x.state==="rewarded"))}
module.exports={STATES,evidenceKey,fingerprint,rewardFingerprint,submission,verify,rewardable};
