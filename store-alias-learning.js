"use strict";
function summarize(rows=[],opts={}){
 const min=Number(opts.minConfirmations||3),minContrib=Number(opts.minContributors||2),by=new Map();
 for(const r of rows){const k=String(r.storeId||"");if(!k)continue;let x=by.get(k)||{storeId:k,confirmations:0,contributors:new Set(),receipts:new Set()};x.confirmations++;if(r.contributorId)x.contributors.add(String(r.contributorId));if(r.receiptId)x.receipts.add(String(r.receiptId));by.set(k,x)}
 const ranked=[...by.values()].map(x=>({...x,contributors:x.contributors.size,receipts:x.receipts.size})).sort((a,b)=>b.confirmations-a.confirmations||b.contributors-a.contributors);
 if(!ranked.length)return{state:"unknown",storeId:null};
 const top=ranked[0],second=ranked[1],eligible=top.confirmations>=min&&top.contributors>=minContrib;
 if(second&&second.confirmations>=min&&second.confirmations/top.confirmations>=.6)return{state:"conflict",storeId:null,candidates:ranked.slice(0,3)};
 if(!eligible)return{state:"learning",storeId:null,leader:top,candidates:ranked.slice(0,3)};
 return{state:"trusted",storeId:top.storeId,confidence:Math.min(.99,.8+top.confirmations*.03+top.contributors*.02),leader:top};
}
module.exports={summarize};
