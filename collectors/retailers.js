"use strict";
/*
 Retailer collector contract.
 IMPORTANT: collectors only parse data supplied to them by an approved fetch layer.
 They do not bypass login, robots, bot protection, or retailer access controls.
*/
function text(x){return String(x??"").replace(/\s+/g," ").trim()}
function euro(x){if(typeof x==="number")return x;const m=text(x).replace(/\./g,"").replace(",",".").match(/(\d+(?:\.\d{1,2})?)/);return m?Number(m[1]):null}
function amount(s){const m=text(s).match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|stk|stück|wl)\b/i);if(!m)return{};return{quantity:Number(m[1].replace(",",".")),unit:m[2].toLowerCase().replace("stück","piece").replace("stk","piece")}}
function aldiSued(items=[],meta={}){
 return items.map((x,i)=>{const q=amount(x.pack||x.description||x.name);return{source:"ALDI SÜD",kind:"official",store:meta.store||"ALDI SÜD",region:meta.region||"DE-SOUTH",product:text(x.name||x.title),gtin:x.gtin||x.ean||null,price:euro(x.price),regularPrice:euro(x.regularPrice||x.wasPrice),per:x.per||"piece",quantity:x.quantity??q.quantity,unit:x.unit||q.unit,date:x.date||x.availableFrom||meta.date,validFrom:x.validFrom||x.availableFrom||null,validTo:x.validTo||null,priceType:x.priceType||(x.regularPrice||x.wasPrice?"promotion":"regular"),proof:x.id||x.url||("aldi-sued:"+i),proofType:"retailer_page",sourceUrl:x.url||meta.sourceUrl,trust:96}});
}
function reweOffers(items=[],meta={}){
 return items.map((x,i)=>{const q=amount(x.pack||x.description||x.name);return{source:"REWE",kind:"official",store:meta.store||"REWE",locationId:meta.marketId||null,region:meta.region||null,product:text(x.name||x.title),gtin:x.gtin||null,price:euro(x.price),regularPrice:euro(x.regularPrice),per:x.per||"piece",quantity:x.quantity??q.quantity,unit:x.unit||q.unit,date:x.date||meta.date,validFrom:x.validFrom||meta.validFrom||null,validTo:x.validTo||meta.validTo||null,priceType:x.priceType||"promotion",proof:x.id||x.url||("rewe:"+i),proofType:"retailer_offer",sourceUrl:x.url||meta.sourceUrl,trust:97}});
}
function genericOffers(retailer,items=[],meta={}){
 return items.map((x,i)=>{const q=amount(x.pack||x.description||x.name);return{source:retailer,kind:"official",store:meta.store||retailer,locationId:meta.marketId||null,region:meta.region||null,product:text(x.name||x.title),gtin:x.gtin||x.ean||null,price:euro(x.price),regularPrice:euro(x.regularPrice),per:x.per||"piece",quantity:x.quantity??q.quantity,unit:x.unit||q.unit,date:x.date||meta.date,validFrom:x.validFrom||meta.validFrom||null,validTo:x.validTo||meta.validTo||null,priceType:x.priceType||"promotion",proof:x.id||x.url||(retailer.toLowerCase()+":"+i),proofType:"retailer_offer",sourceUrl:x.url||meta.sourceUrl,trust:meta.trust||94}});
}
module.exports={aldiSued,reweOffers,genericOffers,euro,amount};
