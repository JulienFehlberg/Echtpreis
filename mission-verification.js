"use strict";
function validate(input={}){
 const store=input.storeMatch===true,product=input.productMatch===true,proof=input.proofValid===true,price=Number.isFinite(Number(input.price))&&Number(input.price)>0,replay=input.replayDetected===true;
 const errors=[];if(!store)errors.push("store");if(!product)errors.push("product");if(!proof)errors.push("proof");if(!price)errors.push("price");if(replay)errors.push("replay");
 return{ok:errors.length===0,errors,verification:{store,product,proof,replayFree:!replay},confidence:errors.length?0:Math.min(1,Math.max(.5,Number.isFinite(Number(input.confidence))?Number(input.confidence):.85))};
}
function points(missionValue){const v=Number(missionValue||0);if(v>=90)return 100;if(v>=80)return 70;if(v>=65)return 45;if(v>=50)return 25;if(v>=35)return 10;return 0}
module.exports={validate,points};
