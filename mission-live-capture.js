"use strict";
const crypto=require("crypto");
const ALLOWED_CAPTURE=new Set(["live_camera"]);
function challenge({missionId,productId,storeId,ttlSeconds=180}={}){
 if(!productId||!storeId)return{ok:false,reason:"missing-target"};
 const now=Date.now(),expiresAt=new Date(now+Math.max(30,Math.min(300,Number(ttlSeconds)||180))*1000).toISOString();
 return{ok:true,id:crypto.randomUUID(),nonce:crypto.randomBytes(24).toString("hex"),missionId:missionId||null,productId,storeId,issuedAt:new Date(now).toISOString(),expiresAt};
}
function eligible(c={},now=Date.now()){
 if(!ALLOWED_CAPTURE.has(c.captureMode))return{ok:false,reason:"live-camera-required"};
 if(!c.challengeId||!c.challengeNonce)return{ok:false,reason:"capture-challenge-required"};
 if(c.expectedChallengeId&&String(c.challengeId)!==String(c.expectedChallengeId))return{ok:false,reason:"capture-challenge-mismatch"};
 if(c.expectedChallengeNonce&&String(c.challengeNonce)!==String(c.expectedChallengeNonce))return{ok:false,reason:"capture-nonce-mismatch"};
 if(c.expectedProductId&&String(c.productId||"")!==String(c.expectedProductId))return{ok:false,reason:"capture-product-mismatch"};
 if(c.expectedStoreId&&String(c.storeId||"")!==String(c.expectedStoreId))return{ok:false,reason:"capture-store-mismatch"};
 if(!c.challengeExpiresAt||new Date(c.challengeExpiresAt).getTime()<now)return{ok:false,reason:"capture-challenge-expired"};
 if(c.challengeUsed===true)return{ok:false,reason:"capture-challenge-used"};
 return{ok:true};
}
module.exports={ALLOWED_CAPTURE,challenge,eligible};
