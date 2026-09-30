const assert=require("assert"),C=require("../mission-live-capture");
let c=C.challenge({missionId:"m",productId:"p",storeId:"s",ttlSeconds:180});assert(c.ok);assert(c.nonce.length>=32);assert(new Date(c.expiresAt)>new Date(c.issuedAt));
assert.strictEqual(C.eligible({captureMode:"gallery",challengeId:c.id,challengeNonce:c.nonce,challengeExpiresAt:c.expiresAt}).ok,false);
assert.strictEqual(C.eligible({captureMode:"live_camera",challengeId:c.id,challengeNonce:c.nonce,challengeExpiresAt:c.expiresAt}).ok,true);
assert.strictEqual(C.eligible({captureMode:"live_camera",challengeId:c.id,challengeNonce:c.nonce,challengeExpiresAt:c.expiresAt,challengeUsed:true}).ok,false);
assert.strictEqual(C.eligible({captureMode:"live_camera",challengeId:c.id,challengeNonce:c.nonce,challengeExpiresAt:"2020-01-01T00:00:00Z"},Date.now()).ok,false);
console.log("mission-live-capture: ok");