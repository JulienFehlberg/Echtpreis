"use strict";
const Identity=require("./product-identity");
const Graph=require("./product-graph");
const Health=require("./source-health");
const Compatibility=require("./product-compatibility");
const UnitPrice=require("./unit-price");
const PUBLIC_TYPES=new Set(["regular","promotion"]);
const norm=s=>Identity.norm(s||"");
function active(r,today){const t=String(today||new Date().toISOString()).slice(0,10),f=r.validFrom&&String(r.validFrom).slice(0,10),to=r.validTo&&String(r.validTo).slice(0,10);return(!f||t>=f)&&(!to||t<=to)}
function freshnessDays(r,today){const d=r.observedAt||r.date;if(!d)return Infinity;return Math.max(0,(new Date(String(today).slice(0,10))-new Date(String(d).slice(0,10)))/864e5)}
function merchantKey(x){return norm(x).replace(/\b(markt|supermarkt|gmbh|co|kg)\b/g,"").replace(/\s+/g," ").trim()}
function sameMerchant(a,b){const x=merchantKey(a),y=merchantKey(b);return x&&y&&(x===y||x.startsWith(y)||y.startsWith(x))}
function queryMode(q){if(q.gtin)return"exact";if(q.brand&&q.pack)return"sku";if(q.brand)return"brand";return"category"}
function identity(query,r){
 const m=Identity.match({gtin:query.gtin,name:query.name||query.product,brand:query.brand,pack:query.pack},{gtin:r.gtin,name:r.product||r.productName,brand:r.brand,pack:r.pack});
 const cls=Identity.identityClass(m),mode=queryMode(query),compat=Compatibility.compatible(query.name||query.product||"",r.product||r.productName||"");let usable=cls==="ground-truth"||cls==="reviewable";if(mode==="category"&&m.score>=.62)usable=true;if(mode==="exact"&&cls!=="ground-truth")usable=false;if(!compat.ok)usable=false;return{...m,class:cls,mode,compatibility:compat,usable};
}
function location(r,ctx={}){
 if(ctx.storeId&&r.storeId&&String(ctx.storeId)===String(r.storeId))return{score:1,level:"store"};
 if(ctx.region&&r.region&&norm(ctx.region)===norm(r.region))return{score:.88,level:"region"};
 if(r.storeId&&ctx.storeId)return{score:0,level:"different-store"};
 return{score:.55,level:"unspecified"};
}
function resolveMerchant(query,merchant,rows=[],ctx={}){
 const today=ctx.today||new Date().toISOString().slice(0,10),maxAge=ctx.maxAgeDays??7,candidates=[];
 for(const r of rows){if(!sameMerchant(merchant,r.merchant||r.store))continue;if(!(Number(r.price)>0)||!active(r,today)||r.sourceHealthState==="quarantine"||r.isOutlier)continue;
  const type=r.priceType||"regular";if(!PUBLIC_TYPES.has(type)&&!(ctx.eligiblePriceTypes||[]).includes(type))continue;
  const id=identity(query,r);if(!id.usable)continue;const loc=location(r,ctx);if(loc.score===0)continue;const age=freshnessDays(r,today);if(age>maxAge&&!r.validTo)continue;
  const health=Number(r.sourceHealthScore??85),proof=!!r.proof,score=id.score*.52+loc.score*.20+Math.max(0,1-age/Math.max(1,maxAge))*.13+Math.min(1,health/100)*.10+(proof?.05:0);
  candidates.push({...r,_score:score,_identity:id,_location:loc,_age:age});
 }
 candidates.sort((a,b)=>b._score-a._score||a.price-b.price);
 if(!candidates.length)return{merchant,state:"unknown",price:null,reason:"no-current-evidence"};
 candidates.forEach(x=>{const cp=UnitPrice.unitPrice(x.price,x.pack||x.packageSize||x.product||x.productName);x._unitPrice=cp?.price??null;x._unit=cp?.per??null;x._packParsed=cp?.pack??null});
 const best=candidates[0],runner=candidates[1],ambiguous=runner&&best._score-runner._score<.035&&Math.abs(best.price-runner.price)/best.price>.08;
 if(ambiguous)return{merchant,state:"unknown",price:null,reason:"conflicting-current-evidence",candidates:candidates.slice(0,3)};
 return{merchant,state:best._identity.class==="ground-truth"&&best._location.level==="store"?"verified":"observed",price:Number(best.price),currency:best.currency||"EUR",priceType:best.priceType||"regular",product:best.product||best.productName,gtin:best.gtin||null,storeId:best.storeId||null,region:best.region||null,observedAt:best.observedAt||best.date,validTo:best.validTo||null,source:best.source||null,proof:best.proof||null,confidence:Math.round(best._score*100),match:best._identity.class,queryMode:best._identity.mode,unitPrice:best._unitPrice,unit:best._unit,packParsed:best._packParsed,locationLevel:best._location.level};
}
function compare(query,merchants,rows,ctx={}){return(merchants||[]).map(m=>resolveMerchant(query,m,rows,ctx))}
function leaders(results=[]){const known=results.filter(x=>x&&x.price>0),cash=known.slice().sort((a,b)=>a.price-b.price)[0]||null,unit=known.filter(x=>x.unitPrice>0).sort((a,b)=>a.unitPrice-b.unitPrice)[0]||null;return{lowestCheckout:cash,lowestUnitPrice:unit}}
module.exports={PUBLIC_TYPES,queryMode,merchantKey,sameMerchant,active,freshnessDays,identity,location,resolveMerchant,compare,leaders};
