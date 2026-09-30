"use strict";
const Identity=require("./product-identity");
const Graph=require("./product-graph");
const Health=require("./source-health");
const Compatibility=require("./product-compatibility");
const UnitPrice=require("./unit-price");
const CurrentTruth=require("./current-price-truth");
const PUBLIC_TYPES=new Set(["regular","promotion"]);
const CONDITIONAL_TYPES=new Set(["loyalty","app","coupon","multi_buy","personalized"]);
const norm=s=>Identity.norm(s||"");
function day(x){const s=String(x||"").slice(0,10);return/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+"T00:00:00Z"))?s:null}
function active(r,today){const t=day(today||new Date().toISOString()),f=r.validFrom?day(r.validFrom):null,to=r.validTo?day(r.validTo):null;if(!t||(r.validFrom&&!f)||(r.validTo&&!to)||(f&&to&&f>to))return false;return(!f||t>=f)&&(!to||t<=to)}
function freshnessDays(r,today){const d=day(r.observedAt||r.date),t=day(today);if(!d||!t)return Infinity;const delta=(Date.parse(t+"T00:00:00Z")-Date.parse(d+"T00:00:00Z"))/864e5;return delta<0?Infinity:delta}
function merchantKey(x){return norm(x).replace(/\b(markt|supermarkt|gmbh|co|kg)\b/g,"").replace(/\s+/g," ").trim()}
function sameMerchant(a,b){const x=merchantKey(a),y=merchantKey(b);return x&&y&&(x===y||x.startsWith(y)||y.startsWith(x))}
function queryMode(q){if(q.gtin)return"exact";if(q.brand&&q.pack)return"sku";if(q.brand)return"brand";return"category"}
function identity(query,r){
 const m=Identity.match({gtin:query.gtin,name:query.name||query.product,brand:query.brand,pack:query.pack},{gtin:r.gtin,name:r.product||r.productName,brand:r.brand,pack:r.pack});
 const cls=Identity.identityClass(m),mode=queryMode(query),compat=Compatibility.compatible(query.name||query.product||"",r.product||r.productName||"");let usable=cls==="ground-truth"||cls==="reviewable";if(mode==="category"){const qn=norm(query.name||query.product||""),rn=norm(r.product||r.productName||"");if(Identity.similarity(qn,rn)>=.5||rn.startsWith(qn)||qn.startsWith(rn))usable=true;}if(mode==="exact"&&cls!=="ground-truth")usable=false;if(mode==="sku"){const qp=Identity.parsePack(query.pack||query.name||query.product),rp=Identity.parsePack(r.pack||r.product||r.productName),packExact=!!(qp&&rp&&qp.total.unit===rp.total.unit&&Math.abs(qp.total.amount-rp.total.amount)/Math.max(qp.total.amount,rp.total.amount)<=.01),brandExact=!!(query.brand&&r.brand&&norm(query.brand)===norm(r.brand)),nameOverlap=Identity.similarity(query.name||query.product||"",r.product||r.productName||"")>=.5||norm(r.product||r.productName||"").startsWith(norm(query.name||query.product||""));usable=packExact&&brandExact&&nameOverlap}if(!compat.ok)usable=false;return{...m,class:cls,mode,compatibility:compat,usable};
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
function identityKey(r){if(r.productId)return"pid:"+r.productId;if(r.gtin)return"gtin:"+String(r.gtin).replace(/\D/g,"");const p=Identity.parsePack(r.pack||r.product||r.productName),pack=p&&p.total?p.total.amount+":"+p.total.unit:"";return"raw:"+norm(r.brand||"")+"|"+norm(r.product||r.productName)+"|"+pack}
function resolveMerchant(query,merchant,rows=[],ctx={}){
 const today=ctx.today||new Date().toISOString().slice(0,10),maxAge=ctx.maxAgeDays??7,candidates=[];
 for(const r of rows){if(!sameMerchant(merchant,r.merchant||r.store))continue;if(!(Number(r.price)>0)||!active(r,today)||r.sourceHealthState==="quarantine"||r.isOutlier)continue;
  const type=r.priceType||"regular",elig=eligible(r,ctx);if(!elig.ok)continue;
  const id=identity(query,r);if(!id.usable)continue;const loc=location(r,ctx);if(loc.score===0)continue;const age=freshnessDays(r,today);const sourceAgeLimit=r.sourceType==="open_data"?Math.min(Number(maxAge),7):Number(maxAge);if(age>sourceAgeLimit)continue;
  const health=Number(r.sourceHealthScore??85),proof=!!r.proof,score=id.score*.52+loc.score*.20+Math.max(0,1-age/Math.max(1,maxAge))*.13+Math.min(1,health/100)*.10+(proof?.05:0);
  candidates.push({...r,_score:score,_identity:id,_location:loc,_age:age,_eligibility:elig});
 }
 candidates.sort((a,b)=>{if(identityKey(a)===identityKey(b)&&a._location.level===b._location.level){const ac=CONDITIONAL_TYPES.has(a.priceType||"regular"),bc=CONDITIONAL_TYPES.has(b.priceType||"regular");if(ac!==bc&&Number(a.price)!==Number(b.price))return Number(a.price)-Number(b.price)}if(queryMode(query)==="category"&&(a.priceType||"regular")===(b.priceType||"regular")){const ua=UnitPrice.unitPrice(a.price,a.pack||a.packageSize||a.product||a.productName),ub=UnitPrice.unitPrice(b.price,b.pack||b.packageSize||b.product||b.productName);if(ua&&ub&&ua.per===ub.per&&Math.abs(a._score-b._score)<.08)return ua.price-ub.price}return b._score-a._score||a.price-b.price});
 if(!candidates.length)return{merchant,state:"unknown",price:null,reason:"no-current-evidence"};
 candidates.forEach(x=>{const cp=UnitPrice.unitPrice(x.price,x.pack||x.packageSize||x.product||x.productName);x._unitPrice=cp?.price??null;x._unit=cp?.per??null;x._packParsed=cp?.pack??null});
 const best=candidates[0],runner=candidates.find((x,i)=>i>0&&identityKey(x)===identityKey(best)&&(x.priceType||"regular")===(best.priceType||"regular")&&x._location.level===best._location.level&&x._identity.class===best._identity.class);
 const peers=candidates.filter(x=>(x.priceType||"regular")===(best.priceType||"regular")&&x._identity.class===best._identity.class&&x._location.level===best._location.level&&x._age<=Math.max(1,best._age+1)&&identityKey(x)===identityKey(best));
 const truthPeers=peers.length?peers:[best];
 const truth=CurrentTruth.fuse(truthPeers);if(truth.state==="conflict")return{merchant,state:"unknown",price:null,reason:"conflicting-current-evidence",truth};
 const peerPrices=truthPeers.map(x=>Number(x.price)).filter(x=>x>0),lo=peerPrices.length?Math.min(...peerPrices):best.price,hi=peerPrices.length?Math.max(...peerPrices):best.price;
 const spread=lo>0?(hi-lo)/lo:0,independent=CurrentTruth.independent(truthPeers);
 const ambiguous=(runner&&best._score-runner._score<.035&&Math.abs(best.price-runner.price)/best.price>.08)||(independent>=2&&spread>.12);
 if(ambiguous)return{merchant,state:"unknown",price:null,reason:"conflicting-current-evidence",conflict:{independentEvidence:independent,spread},candidates:candidates.slice(0,3)};
 const winning=truth.evidence&&truth.evidence.length?truth.evidence.slice().sort((a,b)=>b._score-a._score)[0]:best;
 const publicCandidates=candidates.filter(x=>PUBLIC_TYPES.has(x.priceType||"regular")&&identityKey(x)===identityKey(winning)&&x._location.level===winning._location.level),publicReference=publicCandidates.sort((a,b)=>a.price-b.price)[0]||null;
 return{merchant,state:truth.state==="supported"&&winning._identity.class==="ground-truth"&&winning._location.level==="store"?"verified":"observed",comparisonOnly:winning._identity.mode==="category",price:Number(truth.price??winning.price),payablePrice:Number(truth.price??winning.price),publicReferencePrice:publicReference?Number(publicReference.price):(Number(winning.regularPrice)>0?Number(winning.regularPrice):null),conditional:CONDITIONAL_TYPES.has(winning.priceType||"regular"),currency:winning.currency||"EUR",priceType:winning.priceType||"regular",product:winning.product||winning.productName,gtin:winning.gtin||null,storeId:winning.storeId||null,region:winning.region||null,observedAt:winning.observedAt||winning.date,validFrom:winning.validFrom||null,validTo:winning.validTo||null,eligibility:winning._eligibility,source:winning.source||null,proof:winning.proof||null,confidence:Math.round(winning._score*100),match:winning._identity.class,queryMode:winning._identity.mode,unitPrice:winning._unitPrice,unit:winning._unit,packParsed:winning._packParsed,locationLevel:winning._location.level,truth:{state:truth.state,independentEvidence:truth.independentEvidence,sourceTypes:truth.sourceTypes,strength:truth.strength},scopeWarning:winning._location.level==="regional-fallback"?"not-store-specific":winning._location.level==="region"?"regional-price":null};
}
function compare(query,merchants,rows,ctx={}){return(merchants||[]).map(m=>resolveMerchant(query,m,rows,ctx))}
function leaders(results=[]){const known=results.filter(x=>x&&x.price>0),cash=known.slice().sort((a,b)=>a.price-b.price)[0]||null,unitCandidates=known.filter(x=>x.unitPrice>0&&x.unit),families=new Set(unitCandidates.map(x=>x.unit)),unit=families.size===1?unitCandidates.sort((a,b)=>a.unitPrice-b.unitPrice)[0]||null:null;return{lowestCheckout:cash,lowestUnitPrice:unit,unitComparisonAvailable:families.size===1,unitFamilies:[...families]}}
module.exports={PUBLIC_TYPES,CONDITIONAL_TYPES,day,eligible,queryMode,merchantKey,sameMerchant,active,freshnessDays,identity,identityKey,location,resolveMerchant,compare,leaders};
