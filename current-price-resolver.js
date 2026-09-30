"use strict";
const Identity=require("./product-identity");
const Graph=require("./product-graph");
const Health=require("./source-health");
const Compatibility=require("./product-compatibility");
const UnitPrice=require("./unit-price");
const CurrentTruth=require("./current-price-truth");
const PUBLIC_TYPES=new Set(["regular","promotion"]);\nconst CONDITIONAL_TYPES=new Set(["loyalty","app","coupon","multi_buy","personalized"]);
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
function eligible(r,ctx={}){
 const type=r.priceType||"regular";if(PUBLIC_TYPES.has(type))return{ok:true,reason:"public"};
 const e=ctx.eligibility||{};if(type==="loyalty")return{ok:!!e.loyalty,reason:"loyalty-required"};if(type==="app")return{ok:!!e.app,reason:"app-required"};if(type==="coupon")return{ok:!!e.coupon,reason:"coupon-required"};if(type==="personalized")return{ok:!!e.personalized,reason:"personalized"};
 if(type==="multi_buy"){const min=Number(r.minQuantity||r.quantityRequired||2),qty=Number(ctx.quantity||1);return{ok:qty>=min,reason:"min-quantity-"+min}}
 return{ok:false,reason:"unsupported-price-type"};
}
function location(r,ctx={}){
 if(ctx.storeId){
  if(r.storeId&&String(ctx.storeId)===String(r.storeId))return{score:1,level:"store"};
  if(r.storeId)return{score:0,level:"different-store"};
  if(r.externalLocationId)return{score:0,level:"external-store-unmapped"};
  if(ctx.region&&r.region&&norm(ctx.region)===norm(r.region))return{score:.72,level:"regional-fallback"};
  return{score:0,level:"location-unknown"};
 }
 if(ctx.region){
  if(r.region&&norm(ctx.region)===norm(r.region))return{score:.88,level:"region"};
  if(r.region)return{score:0,level:"different-region"};
  return{score:.45,level:"region-unspecified"};
 }
 return{score:.55,level:"unspecified"};
}
function resolveMerchant(query,merchant,rows=[],ctx={}){
 const today=ctx.today||new Date().toISOString().slice(0,10),maxAge=ctx.maxAgeDays??7,candidates=[];
 for(const r of rows){if(!sameMerchant(merchant,r.merchant||r.store))continue;if(!(Number(r.price)>0)||!active(r,today)||r.sourceHealthState==="quarantine"||r.isOutlier)continue;
  const type=r.priceType||"regular",elig=eligible(r,ctx);if(!elig.ok)continue;
  const id=identity(query,r);if(!id.usable)continue;const loc=location(r,ctx);if(loc.score===0)continue;const age=freshnessDays(r,today);if(age>maxAge&&!r.validTo)continue;
  const health=Number(r.sourceHealthScore??85),proof=!!r.proof,score=id.score*.52+loc.score*.20+Math.max(0,1-age/Math.max(1,maxAge))*.13+Math.min(1,health/100)*.10+(proof?.05:0);
  candidates.push({...r,_score:score,_identity:id,_location:loc,_age:age,_eligibility:elig});
 }
 candidates.sort((a,b)=>b._score-a._score||a.price-b.price);
 if(!candidates.length)return{merchant,state:"unknown",price:null,reason:"no-current-evidence"};
 candidates.forEach(x=>{const cp=UnitPrice.unitPrice(x.price,x.pack||x.packageSize||x.product||x.productName);x._unitPrice=cp?.price??null;x._unit=cp?.per??null;x._packParsed=cp?.pack??null});
 const best=candidates[0],runner=candidates[1];
 const peers=candidates.filter(x=>(x.priceType||"regular")===(best.priceType||"regular")&&x._identity.class===best._identity.class&&x._location.level===best._location.level&&x._age<=Math.max(1,best._age+1)&&(best.productId&&x.productId?String(x.productId)===String(best.productId):(best.gtin&&x.gtin?String(x.gtin)===String(best.gtin):norm(x.product||x.productName)===norm(best.product||best.productName))));
 const truth=CurrentTruth.fuse(peers);if(truth.state==="conflict")return{merchant,state:"unknown",price:null,reason:"conflicting-current-evidence",truth};\n const peerPrices=peers.map(x=>Number(x.price)).filter(x=>x>0),lo=peerPrices.length?Math.min(...peerPrices):best.price,hi=peerPrices.length?Math.max(...peerPrices):best.price;
 const spread=lo>0?(hi-lo)/lo:0,independent=new Set(peers.map(x=>x.proof||[x.source,x.observedAt,x.price].join("|"))).size;
 const ambiguous=(runner&&best._score-runner._score<.035&&Math.abs(best.price-runner.price)/best.price>.08)||(independent>=2&&spread>.12);
 if(ambiguous)return{merchant,state:"unknown",price:null,reason:"conflicting-current-evidence",conflict:{independentEvidence:independent,spread},candidates:candidates.slice(0,3)};
 const winning=truth.evidence&&truth.evidence.length?truth.evidence.slice().sort((a,b)=>b._score-a._score)[0]:best;
 return{merchant,state:truth.state==="supported"&&winning._identity.class==="ground-truth"&&winning._location.level==="store"?"verified":"observed",price:Number(truth.price??winning.price),currency:winning.currency||"EUR",priceType:winning.priceType||"regular",product:winning.product||winning.productName,gtin:winning.gtin||null,storeId:winning.storeId||null,region:winning.region||null,observedAt:winning.observedAt||winning.date,validTo:winning.validTo||null,eligibility:winning._eligibility,source:winning.source||null,proof:winning.proof||null,confidence:Math.round(winning._score*100),match:winning._identity.class,queryMode:winning._identity.mode,unitPrice:winning._unitPrice,unit:winning._unit,packParsed:winning._packParsed,locationLevel:winning._location.level,truth:{state:truth.state,independentEvidence:truth.independentEvidence,sourceTypes:truth.sourceTypes,strength:truth.strength},scopeWarning:winning._location.level==="regional-fallback"?"not-store-specific":winning._location.level==="region"?"regional-price":null};
}
function compare(query,merchants,rows,ctx={}){return(merchants||[]).map(m=>resolveMerchant(query,m,rows,ctx))}
function leaders(results=[]){const known=results.filter(x=>x&&x.price>0),cash=known.slice().sort((a,b)=>a.price-b.price)[0]||null,unitCandidates=known.filter(x=>x.unitPrice>0&&x.unit),families=new Set(unitCandidates.map(x=>x.unit)),unit=families.size===1?unitCandidates.sort((a,b)=>a.unitPrice-b.unitPrice)[0]||null:null;return{lowestCheckout:cash,lowestUnitPrice:unit,unitComparisonAvailable:families.size===1,unitFamilies:[...families]}}
module.exports={PUBLIC_TYPES,CONDITIONAL_TYPES,eligible,queryMode,merchantKey,sameMerchant,active,freshnessDays,identity,location,resolveMerchant,compare,leaders};
