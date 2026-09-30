(function(){
"use strict";
const VERSION="3.5.0";
const DAY=86400000;
const SOURCE_BASE={official:96,receipt:92,shelf:90,openprices:78,community:64,reference:20};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const PRICE_TYPES=new Set(["regular","promotion","loyalty","app","coupon","multi_buy","personalized"]);
function dateOnly(x){return x?String(x).slice(0,10):null}
function temporalState(row,today){const t=dateOnly(today||new Date().toISOString()),from=dateOnly(row.validFrom),to=dateOnly(row.validTo);if(from&&t<from)return"future";if(to&&t>to)return"expired";return"active"}
function priceEligibility(row,ctx={}){const type=row.priceType||"regular",time=temporalState(row,ctx.today);if(time!=="active")return{eligible:false,reason:time};if(type==="regular"||type==="promotion")return{eligible:true,reason:"public"};const e=ctx.eligibility||{};if(type==="loyalty"&&!e.loyalty)return{eligible:false,reason:"loyalty-required"};if(type==="app"&&!e.app)return{eligible:false,reason:"app-required"};if(type==="coupon"&&!e.coupon)return{eligible:false,reason:"coupon-required"};if(type==="personalized"&&!e.personalized)return{eligible:false,reason:"personalized"};if(type==="multi_buy"){const need=Number(row.minQuantity||row.quantityRequired||2),qty=Number(ctx.quantity||1);if(qty<need)return{eligible:false,reason:"quantity-required"};}return{eligible:true,reason:"eligible"};}

const daysOld=(date,today)=>{
  if(!date)return 999;
  const a=new Date(date+"T12:00:00"),b=new Date((today||new Date().toISOString().slice(0,10))+"T12:00:00");
  return Math.max(0,(b-a)/DAY);
};
function freshnessScore(row,today){
  const d=daysOld(row.date,today);
  if(row.validTo&&row.validTo>=(today||new Date().toISOString().slice(0,10))&&d<=7)return 1;
  if(d<=1)return 1;if(d<=3)return .96;if(d<=7)return .88;if(d<=14)return .72;if(d<=30)return .48;if(d<=60)return .25;return .08;
}
function locationScore(row,ctx){
  if(!ctx)return .75;
  if(ctx.locationId&&row.locationId&&String(ctx.locationId)===String(row.locationId))return 1;
  if(ctx.region&&row.region&&String(ctx.region).toLowerCase()===String(row.region).toLowerCase())return .9;
  if(Number.isFinite(row.lat)&&Number.isFinite(row.lon)&&Number.isFinite(ctx.lat)&&Number.isFinite(ctx.lon)&&typeof ctx.distanceKm==="function"){
    const km=ctx.distanceKm(ctx.lat,ctx.lon,row.lat,row.lon);
    if(km<=2)return .98;if(km<=10)return .9;if(km<=25)return .78;if(km<=50)return .62;return .35;
  }
  return .68;
}
function sourceScore(row){
  const base=SOURCE_BASE[row.kind]??50,governed=Number(row.registryTrust),health=Number(row.sourceHealthScore);
  let score=Number.isFinite(governed)&&governed>0?(base*.55+governed*.45):base;
  if(Number.isFinite(health)){if(health<40)score-=35;else if(health<65)score-=15;else if(health<85)score-=5;else score+=Math.min(3,(health-85)/5)}
  return clamp(score,0,100);
}
function independentProofs(rows){
  return new Set(rows.map(r=>r.proof||((r.kind||"unknown")+":"+(r.source||""))).filter(Boolean)).size;
}
function median(xs){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function priceCluster(rows){
  if(!rows.length)return {center:null,agreement:0};
  const center=median(rows.map(r=>Number(r.price)));
  if(!(center>0))return {center:null,agreement:0};
  const deviations=rows.map(r=>Math.abs(Number(r.price)-center)/center);
  const mad=median(deviations)||0;
  return {center,agreement:clamp(1-mad*5,0,1)};
}
function scoreObservation(row,rows,ctx={}){
  const same=rows.filter(r=>r!==row&&r.per===row.per);
  const near=same.filter(r=>Math.abs(Number(r.price)-Number(row.price))/Number(row.price)<=.035);
  const contradictions=same.filter(r=>Math.abs(Number(r.price)-Number(row.price))/Number(row.price)>.15);
  const proofBonus=Math.min(10,independentProofs(near)*2.5);
  const agreementPenalty=Math.min(18,independentProofs(contradictions)*4);
  const proofPenalty=(["receipt","shelf","openprices","community"].includes(row.kind)&&!row.proof)?14:0;
  const score=sourceScore(row)*.56+freshnessScore(row,ctx.today)*24+locationScore(row,ctx)*14+proofBonus-agreementPenalty-proofPenalty;
  return clamp(Math.round(score),0,100);
}
function rankObservations(rows,ctx={}){
 const all=(rows||[]).filter(r=>r&&Number(r.price)>0&&r.date&&r.sourceHealthState!=="quarantine"&&!r.isOutlier).map(r=>({...r,priceType:r.priceType||"regular"}));
 const eligible=all.filter(r=>priceEligibility(r,ctx).eligible);if(!eligible.length)return null;
 const scored=eligible.map(row=>({...row,confidenceScore:scoreObservation(row,eligible.filter(x=>x.priceType===row.priceType),ctx)}));
 scored.sort((a,b)=>Number(a.price)-Number(b.price)||b.confidenceScore-a.confidenceScore||String(b.date).localeCompare(String(a.date)));
 const top=scored[0],support=scored.filter(r=>r.priceType===top.priceType&&r.per===top.per&&Math.abs(r.price-top.price)/top.price<=.035),cluster=priceCluster(support),proofs=independentProofs(support),boosted=clamp(top.confidenceScore+Math.min(6,Math.max(0,proofs-1)*2),0,100);
 return {...top,confidenceScore:boosted,confidence:boosted>=90?"sehr hoch":boosted>=78?"hoch":boosted>=62?"mittel":"niedrig",supportCount:support.length,independentProofs:proofs,agreement:cluster.agreement,status:boosted>=78?"verified":top.status||"observed",eligibility:priceEligibility(top,ctx).reason};
}
function classifyPrice(x){if(!x||!(Number(x.price)>0))return "unknown";const s=Number(x.confidenceScore||0);if((x.kind==="official"||x.kind==="receipt"||x.kind==="shelf")&&s>=78)return "verified";if(s>=62)return "observed";return "estimated"}
function basketQuality(items){
 const xs=Array.isArray(items)?items:[],states=xs.map(x=>classifyPrice(x)),known=xs.filter((x,i)=>states[i]!=="unknown"),verified=xs.filter((x,i)=>states[i]==="verified"),estimated=xs.filter((x,i)=>states[i]==="estimated");
 const coverage=xs.length?known.length/xs.length:0,verifiedCoverage=xs.length?verified.length/xs.length:0,estimatedShare=xs.length?estimated.length/xs.length:0;
 const avg=known.length?known.reduce((s,x)=>s+Number(x.confidenceScore||0),0)/known.length:0;
 const label=coverage>=.95&&verifiedCoverage>=.8&&avg>=80?"sehr hoch":coverage>=.85&&verifiedCoverage>=.6?"hoch":coverage>=.65?"mittel":"niedrig";
 return {coverage,verifiedCoverage,estimatedShare,confidenceScore:Math.round(avg),confidence:label,known:known.length,verified:verified.length,estimated:estimated.length,unknown:xs.length-known.length,total:xs.length};
}
function basketRange(items){
 let min=0,max=0,exact=0;for(const x of (items||[])){if(!x)continue;const p=Number(x.price||0),state=classifyPrice(x);if(!(p>0))continue;exact+=p;if(state==="verified"){min+=p;max+=p}else if(state==="observed"){min+=p*.97;max+=p*1.03}else{min+=p*.88;max+=p*1.12}}
 return {center:Math.round(exact*100)/100,min:Math.round(min*100)/100,max:Math.round(max*100)/100};
}

/* Canonical observation contract: every source adapter must emit this shape. */
function normalizeObservation(raw={}){
 const price=Number(raw.price),regularPrice=raw.regularPrice==null?null:Number(raw.regularPrice);
 const observedAt=raw.observedAt||raw.date||new Date().toISOString().slice(0,10);
 return {
  observationId:raw.observationId||null, productId:raw.productId||null, gtin:raw.gtin||raw.ean||null,
  product:String(raw.product||raw.productName||"").trim(), key:raw.key||null,
  store:raw.store||null, locationId:raw.locationId||null, region:raw.region||null,
  lat:Number.isFinite(Number(raw.lat))?Number(raw.lat):null, lon:Number.isFinite(Number(raw.lon))?Number(raw.lon):null,
  price:Number.isFinite(price)?price:null, regularPrice:Number.isFinite(regularPrice)?regularPrice:null,
  currency:raw.currency||"EUR", per:raw.per||"piece", quantity:raw.quantity??null, unit:raw.unit||null,
  priceType:raw.priceType||"regular", validFrom:raw.validFrom||null, validTo:raw.validTo||null,
  date:String(observedAt).slice(0,10), observedAt,
  kind:raw.kind||"reference", source:raw.source||"unknown", sourceUrl:raw.sourceUrl||null,
  proof:raw.proof||raw.proofId||null, proofType:raw.proofType||null, trust:Number(raw.trust||0),
  importedAt:raw.importedAt||new Date().toISOString(), rawRef:raw.rawRef||null
 };
}
function validateObservation(raw){
 const x=normalizeObservation(raw),errors=[];
 if(!(x.price>0))errors.push("price"); if(!x.store)errors.push("store"); if(!x.date)errors.push("date");
 if(!x.product&&!x.key&&!x.gtin)errors.push("product_identity");
 if(x.priceType!=="regular"&&x.validTo&&x.validFrom&&x.validTo<x.validFrom)errors.push("validity");
 return {ok:errors.length===0,errors,observation:x};
}
function dedupeObservations(rows=[]){
 const map=new Map();
 for(const raw of rows){const v=validateObservation(raw);if(!v.ok)continue;const x=v.observation;
  const k=[x.gtin||x.key||x.product,x.store,x.locationId||x.region||"",x.price,x.currency,x.per,x.priceType,x.date,x.proof||x.source].join("|");
  const old=map.get(k);if(!old||sourceScore(x)>sourceScore(old))map.set(k,x);
 }
 return [...map.values()];
}
function sourceAudit(rows=[]){
 const clean=dedupeObservations(rows),bySource={};
 for(const x of clean){const k=x.source||x.kind||"unknown";const s=bySource[k]??={observations:0,withProof:0,withGtin:0,withLocation:0,latest:null};s.observations++;if(x.proof)s.withProof++;if(x.gtin)s.withGtin++;if(x.locationId||(x.lat!=null&&x.lon!=null))s.withLocation++;if(!s.latest||x.date>s.latest)s.latest=x.date;}
 return {observations:clean.length,sources:Object.entries(bySource).map(([source,s])=>({source,...s,proofRate:s.observations?s.withProof/s.observations:0,gtinRate:s.observations?s.withGtin/s.observations:0,locationRate:s.observations?s.withLocation/s.observations:0}))};
}

window.EchtpreisPriceEngine={VERSION,PRICE_TYPES,temporalState,priceEligibility,rankObservations,scoreObservation,basketQuality,freshnessScore,locationScore,sourceScore,normalizeObservation,validateObservation,dedupeObservations,sourceAudit,classifyPrice,basketRange};
})();