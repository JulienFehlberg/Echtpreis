"use strict";
const Identity=require("./product-identity");
const Graph=require("./product-graph");
const Health=require("./source-health");
const Compatibility=require("./product-compatibility");
const UnitPrice=require("./unit-price");
const CurrentTruth=require("./current-price-truth");
const Semantics=require("./source-semantics");
const PUBLIC_TYPES=new Set(["regular","promotion"]);
const CONDITIONAL_TYPES=new Set(["loyalty","app","coupon","multi_buy","personalized"]);
const norm=s=>Identity.norm(s||"");
function day(x){const s=x instanceof Date?(Number.isFinite(x.getTime())?x.toISOString().slice(0,10):""):String(x||"").slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const t=Date.parse(s+"T00:00:00Z");return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?s:null}
function active(r,today){const t=day(today||new Date().toISOString()),f=r.validFrom?day(r.validFrom):null,to=r.validTo?day(r.validTo):null;if(!t||(r.validFrom&&!f)||(r.validTo&&!to)||(f&&to&&f>to))return false;return(!f||t>=f)&&(!to||t<=to)}
function freshnessDays(r,today){const d=day(r.observedAt||r.date),t=day(today);if(!d||!t)return Infinity;const delta=(Date.parse(t+"T00:00:00Z")-Date.parse(d+"T00:00:00Z"))/864e5;return delta<0?Infinity:delta}
function merchantKey(x){return norm(x).replace(/\b(markt|supermarkt|gmbh|co|kg)\b/g,"").replace(/\s+/g," ").trim()}
function sameMerchant(a,b){const x=merchantKey(a),y=merchantKey(b);return x&&y&&(x===y||x.startsWith(y)||y.startsWith(x))}
function queryMode(q){if(q.gtin)return"exact";if(q.brand&&q.pack)return"sku";if(q.brand)return"brand";return"category"}
function identity(query,r){
 const m=Identity.match({gtin:query.gtin,name:query.name||query.product,brand:query.brand,pack:query.pack},{gtin:r.gtin,name:r.product||r.productName,brand:r.brand,pack:r.pack});
 const cls=Identity.identityClass(m),mode=queryMode(query),compat=Compatibility.compatible(query.name||query.product||"",r.product||r.productName||"");
 let usable=cls==="ground-truth"||cls==="reviewable";
 if(mode==="category"){const qn=norm(query.name||query.product||""),rn=norm(r.product||r.productName||"");if(Identity.similarity(qn,rn)>=.5||rn.startsWith(qn)||qn.startsWith(rn))usable=true;}
 if(mode==="exact"){
  usable=Identity.gtinValid(query.gtin)&&Identity.gtinValid(r.gtin)&&String(query.gtin).replace(/\D/g,"")===String(r.gtin).replace(/\D/g,"");
  // Retailers can attach a consumer GTIN to a larger sales bundle. Identity alone does not prove its pack price.
  if(usable&&query.pack){const expected=Identity.parsePack(query.pack),actual=Identity.parsePack(r.pack||r.packageSize);usable=!!(expected&&actual&&expected.count===actual.count&&expected.total.unit===actual.total.unit&&Math.abs(expected.total.amount-actual.total.amount)/Math.max(expected.total.amount,actual.total.amount)<=.001);}
 }
 if(mode==="sku"){const qp=Identity.parsePack(query.pack||query.name||query.product),rp=Identity.parsePack(r.pack||r.product||r.productName),packExact=!!(qp&&rp&&qp.count===rp.count&&qp.total.unit===rp.total.unit&&Math.abs(qp.total.amount-rp.total.amount)/Math.max(qp.total.amount,rp.total.amount)<=.01),brandExact=!!(query.brand&&r.brand&&norm(query.brand)===norm(r.brand)),nameOverlap=Identity.similarity(query.name||query.product||"",r.product||r.productName||"")>=.5||norm(r.product||r.productName||"").startsWith(norm(query.name||query.product||""));usable=packExact&&brandExact&&nameOverlap}
 if(!compat.ok)usable=false;return{...m,class:cls,mode,compatibility:compat,usable};
}
function eligible(r,ctx={}){
 const type=r.priceType||"regular";if(PUBLIC_TYPES.has(type))return{ok:true,reason:"public"};
 const e=ctx.eligibility||{};if(type==="loyalty")return{ok:!!e.loyalty,reason:"loyalty-required"};if(type==="app")return{ok:!!e.app,reason:"app-required"};if(type==="coupon")return{ok:!!e.coupon,reason:"coupon-required"};if(type==="personalized")return{ok:!!e.personalized,reason:"personalized"};
 if(type==="multi_buy"){const min=Number(r.minQuantity??r.quantityRequired),qty=Number(ctx.quantity??1),validMin=Number.isSafeInteger(min)&&min>=2,validQty=Number.isFinite(qty)&&qty>=1;return{ok:validMin&&validQty&&qty>=min,reason:!validMin?"invalid-min-quantity":!validQty?"invalid-quantity":"min-quantity-"+min}}
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
function identityKey(r){return CurrentTruth.productScope(r)}
function samePriceScope(a,b){return identityKey(a)===identityKey(b)&&a._location.level===b._location.level&&CurrentTruth.scope(a)===CurrentTruth.scope(b)}
function hitCaptureCurrent(row,ctx){
 if(row.sourceId!=="HIT Berlin store assortment"&&row.source!=="HIT Berlin store assortment")return true;
 const captured=row.observedAt instanceof Date?row.observedAt.getTime():Date.parse(row.observedAt),expires=Date.parse(row.eligibility?.sourceExpiresAt),now=ctx.now===undefined?Date.now():new Date(ctx.now).getTime();
 return Number.isFinite(now)&&Number.isFinite(captured)&&Number.isFinite(expires)&&captured<=now&&expires===captured+86400000&&expires>now;
}
function resolveMerchant(query,merchant,rows=[],ctx={}){
 const today=ctx.today||new Date().toISOString().slice(0,10),requestedAge=Number(ctx.maxAgeDays??7),maxAge=Number.isFinite(requestedAge)&&requestedAge>=0?requestedAge:7,candidates=[];
 for(const r of rows){if(!sameMerchant(merchant,r.merchant||r.store))continue;if(!hitCaptureCurrent(r,ctx))continue;if((r.sourceId==="HIT Berlin store assortment"||r.source==="HIT Berlin store assortment")&&typeof r.externalProductId==="string"&&/KG$/.test(r.externalProductId))continue;if(!Semantics.truthEligible(r)||(r.currency||"EUR")!==(ctx.currency||"EUR"))continue;if(!Number.isFinite(Number(r.price))||!(Number(r.price)>0)||!active(r,today)||r.sourceHealthState==="quarantine"||r.isOutlier)continue;
  const type=r.priceType||"regular",elig=eligible(r,ctx);if(!elig.ok)continue;
  const id=identity(query,r);if(!id.usable)continue;const loc=location(r,ctx);if(loc.score===0)continue;const age=freshnessDays(r,today);const sourceAgeLimit=CurrentTruth.sourceType(r)==="open_data"?Math.min(maxAge,7):maxAge;if(!Number.isFinite(age)||age>sourceAgeLimit)continue;
  const rawHealth=Number(r.sourceHealthScore??85),health=Number.isFinite(rawHealth)?Math.max(0,Math.min(100,rawHealth)):85,proof=!!r.proof,tier=CurrentTruth.truthTier(r),authority=tier===1?1:tier===2?.92:tier===3?.72:.45,score=id.score*.46+loc.score*.19+Math.max(0,1-age/Math.max(1,maxAge))*.12+health/100*.08+(proof?.04:0)+authority*.11;
  candidates.push({...r,_score:score,_identity:id,_location:loc,_age:age,_eligibility:elig,_truthTier:tier});
 }
 candidates.sort((a,b)=>{if(samePriceScope(a,b)){if(a._truthTier!==b._truthTier)return a._truthTier-b._truthTier;if((a.priceType||"regular")!==(b.priceType||"regular")&&Number(a.price)!==Number(b.price))return Number(a.price)-Number(b.price)}if(queryMode(query)==="category"&&(a.priceType||"regular")===(b.priceType||"regular")){const ua=UnitPrice.unitPrice(a.price,a.pack||a.packageSize||a.product||a.productName),ub=UnitPrice.unitPrice(b.price,b.pack||b.packageSize||b.product||b.productName);if(ua&&ub&&ua.per===ub.per&&Math.abs(a._score-b._score)<.08)return ua.price-ub.price}return b._score-a._score||a.price-b.price});
 if(!candidates.length)return{merchant,state:"unknown",price:null,reason:"no-current-evidence"};
 candidates.forEach(x=>{const cp=UnitPrice.unitPrice(x.price,x.pack||x.packageSize||x.product||x.productName);x._unitPrice=cp?.price??null;x._unit=cp?.per??null;x._packParsed=cp?.pack??null});
 const best=candidates[0],runner=candidates.find((x,i)=>i>0&&samePriceScope(x,best)&&(x.priceType||"regular")===(best.priceType||"regular")&&x._identity.class===best._identity.class&&x._truthTier===best._truthTier);
 const proofConflict=CurrentTruth.proofConflict(candidates.filter(x=>samePriceScope(x,best)&&(x.priceType||"regular")===(best.priceType||"regular")));if(proofConflict)return{merchant,state:"unknown",price:null,reason:"conflicting-current-evidence",truth:proofConflict};
 const peers=candidates.filter(x=>(x.priceType||"regular")===(best.priceType||"regular")&&x._identity.class===best._identity.class&&samePriceScope(x,best)&&x._age<=Math.max(1,best._age+1)&&x._truthTier===best._truthTier);
 const truthPeers=peers.length?peers:[best];
 const truth=CurrentTruth.fuse(truthPeers,{currency:ctx.currency||"EUR"});if(truth.state==="conflict"||truth.state==="unknown")return{merchant,state:"unknown",price:null,reason:"conflicting-current-evidence",truth};
 const peerPrices=truthPeers.map(x=>Number(x.price)).filter(x=>x>0),lo=peerPrices.length?Math.min(...peerPrices):best.price,hi=peerPrices.length?Math.max(...peerPrices):best.price;
 const spread=lo>0?(hi-lo)/lo:0,independent=CurrentTruth.independent(truthPeers);
 const ambiguous=(runner&&best._score-runner._score<.035&&Math.abs(best.price-runner.price)/best.price>.08)||(independent>=2&&spread>.12);
 if(ambiguous)return{merchant,state:"unknown",price:null,reason:"conflicting-current-evidence",conflict:{independentEvidence:independent,spread},candidates:candidates.slice(0,3)};
 const winning=truth.representative||best,payablePrice=Number(truth.price??winning.price),payableUnit=UnitPrice.unitPrice(payablePrice,winning.pack||winning.packageSize||winning.product||winning.productName);
 const publicCandidates=candidates.filter(x=>(x.priceType||"regular")==="regular"&&samePriceScope(x,winning)),publicReference=publicCandidates.sort((a,b)=>a._truthTier-b._truthTier||b._score-a._score||a.price-b.price)[0]||null;
 const evidenceContext={kind:winning.kind||CurrentTruth.sourceType(winning),status:winning.status||"observed",identityVerified:winning.identityVerified===true,proofVerified:winning.proofVerified===true,per:winning.per||"piece",pack:winning.pack||winning.packageSize||null,brand:winning.brand||null,sourceId:winning.sourceId||null,sourceUrl:winning.sourceUrl||null,proofType:winning.proofType||null,sourceEligibility:winning.eligibility&&typeof winning.eligibility==="object"?winning.eligibility:null,originalPer:winning.originalPer??winning.per??null,originalPrice:winning.originalPrice??Number(winning.price),priceBasis:winning.priceBasis||"pack"};
 return{...evidenceContext,...checkoutContext(winning,payablePrice),merchant,state:winning.priceBasis!=="derived-pack"&&truth.state==="supported"&&CurrentTruth.verificationEligible(winning)&&winning._identity.class==="ground-truth"&&winning._location.level==="store"?"verified":"observed",priceBasis:winning.priceBasis||"pack",comparisonOnly:winning._identity.mode==="category",price:payablePrice,payablePrice,publicReferencePrice:publicReference?Number(publicReference.price):(Number.isFinite(Number(winning.regularPrice))&&Number(winning.regularPrice)>0?Number(winning.regularPrice):null),conditional:CONDITIONAL_TYPES.has(winning.priceType||"regular"),currency:winning.currency||"EUR",priceType:winning.priceType||"regular",minQuantity:winning.priceType==="multi_buy"?Number(winning.minQuantity??winning.quantityRequired):null,product:winning.product||winning.productName,productId:winning.productId||null,externalProductId:winning.externalProductId||null,gtin:winning.gtin||null,storeId:winning.storeId||null,region:winning.region||null,observedAt:winning.observedAt||winning.date,validFrom:winning.validFrom||null,validTo:winning.validTo||null,eligibility:winning._eligibility,source:winning.source||null,sourceType:CurrentTruth.sourceType(winning),truthTier:winning._truthTier,priceAuthority:winning._truthTier===1?"pos-live":winning._truthTier===2?"official-published":winning._truthTier===3?"observed-evidence":"secondary",proof:winning.proof||null,proofHash:winning.proofHash||winning.mediaHash||winning.contentHash||null,proofActor:winning.proofActor||winning.contributorId||null,truthEligible:true,confidence:Math.round(winning._score*100),match:winning._identity.class,queryMode:winning._identity.mode,unitPrice:payableUnit?.price??null,unit:payableUnit?.per??null,packParsed:payableUnit?.pack??null,locationLevel:winning._location.level,truth:{state:truth.state,independentEvidence:truth.independentEvidence,verifiedEvidence:truth.verifiedEvidence,sourceTypes:truth.sourceTypes,strength:truth.strength},scopeWarning:winning._location.level==="regional-fallback"?"not-store-specific":winning._location.level==="region"?"regional-price":null};
}
function checkoutContext(row,price){
 if(row.sourceId!=="HIT Berlin store assortment"&&row.source!=="HIT Berlin store assortment")return{};
 const meta=row.eligibility,goods=Math.round(price*100),deposit=meta?.depositCents;
 const pack=Identity.parsePack(row.pack),single=pack?.count===1&&(pack.total.unit!=="piece"||pack.total.amount===1);
 const verified=meta?.scopeChannel==="physical-store"&&meta?.nativeStoreId===1775&&meta?.nativeStoreNumber==="258"&&meta?.goodsPriceCents===goods&&meta?.priceIncludesDeposit===false&&meta?.checkoutPriceVerified===true&&Number.isSafeInteger(deposit)&&deposit>=0&&(deposit===0||single);
 return{goodsPrice:price,nativeDeposit:Number.isSafeInteger(deposit)&&deposit>=0?deposit/100:null,deposit:verified?deposit/100:null,priceIncludesDeposit:false,checkoutPriceVerified:verified,payablePackPrice:verified?(goods+deposit)/100:null};
}
function compare(query,merchants,rows,ctx={}){return(merchants||[]).map(m=>resolveMerchant(query,m,rows,ctx))}
function leaders(results=[]){const known=results.filter(x=>x&&x.price>0),cash=known.filter(x=>x.checkoutPriceVerified!==false).sort((a,b)=>(a.payablePackPrice??a.price)-(b.payablePackPrice??b.price))[0]||null,unitCandidates=known.filter(x=>x.unitPrice>0&&x.unit),families=new Set(unitCandidates.map(x=>x.unit)),unit=families.size===1?unitCandidates.sort((a,b)=>a.unitPrice-b.unitPrice)[0]||null:null;return{lowestCheckout:cash,lowestUnitPrice:unit,unitComparisonAvailable:families.size===1,unitFamilies:[...families]}}
module.exports={PUBLIC_TYPES,CONDITIONAL_TYPES,day,eligible,queryMode,merchantKey,sameMerchant,active,freshnessDays,identity,identityKey,location,resolveMerchant,compare,leaders};
