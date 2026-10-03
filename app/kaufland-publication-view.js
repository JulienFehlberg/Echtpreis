(function(root){
"use strict";
// A closed read-only view of dated offer groups. This helper never creates a
// product selection, a pack price, a fresh shelf quote or a basket winner.
const SOURCE="Kaufland Berlin DE1980 public promotional publications",MERCHANT="Kaufland",CHANNEL="store-promotional-publication";
const PAGE_URL="https://filiale.kaufland.de/service/filiale.storeName=DE1980.html",INDEX_URL="https://filiale.kaufland.de/.kloffers.storeName=DE1980.json";
const SHOP=Object.freeze({name:"Kaufland Berlin-Reinickendorf",address:"Ollenhauerstraße 122",postalCode:"13403",city:"Berlin",country:"DE",nativeMarketId:"DE1980"});
const HASH=/^[a-f0-9]{64}$/,ID=/^\d{8}$/,DAY_MS=86400000;
const PUBLICATION_KEYS=["kind","identityKind","sourceId","merchant","nativePublicationId","gtin","retailerSku","name","nativeQuantity","pack","packCount","packAmount","packUnit","packVerified","nativeBasePrice","announcedAmounts","previousPublishedAmount","priceFootnote","currency","deposit","payablePackPrice","priceType","promotionStatus","nativePublicationWindow","nativeValidity","publicationOriginalValidityVerified","numericComparisonEligible","numericComparisonHoldReasons","current","expiresAt","priceObservedAt","capturedAt","indexCapturedAt","scopeCountry","scopeCity","scopeChannel","nativeMarketId","shop","sourceUrl","sourceResponseUrl","sourceResponseHash","indexResponseUrl","indexResponseHash","proofHash","state","truthEligible","physicalStorePriceVerified","normalPriceClassificationVerified","availability","currentAvailabilityVerified","fullAssortment"];
const REFERENCE_KEYS=["kind","identityKind","city","country","merchant","key","observedAt","sourceMarket","observedMarkets"];
const COVERAGE_KEYS=["sourceId","merchant","receivedGroups","acceptedGroups","heldGroups","matchedGroups","documentCapturedAt","ambiguousLatestCapture","current","physicalStorePriceVerified","normalPriceClassificationVerified","nativeProductIdentities","fullAssortment"];
const HOLD_REASONS=new Set(["article-sale-validity-unverified","exact-sale-pack-unresolved","exact-variant-unresolved","multibuy-terms-unresolved","native-pack-base-price-conflict","individual-piece-weight-unverified"]);
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
function closed(v,keys){return object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)&&Object.getOwnPropertyDescriptor(v,k)?.get===undefined);}
function text(v,max=250,empty=false){return typeof v==="string"&&v.length<=max&&(empty||v.length>0)&&v===v.trim()&&!/[<>\u0000-\u001f\u007f]/.test(v);}
function iso(v){return typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v?Date.parse(v):null;}
function date(v){return typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+"T00:00:00Z"))&&new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v;}
function localDay(at){const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(at)).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));return parts.year+"-"+parts.month+"-"+parts.day;}
function clock(options){if(!object(options)||Object.keys(options).some(k=>!["now","request"].includes(k)))return null;const n=options.now===undefined?Date.now():options.now;return typeof n==="number"&&Number.isSafeInteger(n)&&n>=0&&Number.isFinite(new Date(n).getTime())?n:null;}
function money(v){return typeof v==="number"&&Number.isFinite(v)&&v>0&&v<=10000&&Math.abs(v*100-Math.round(v*100))<1e-6;}
function sameShop(v){return closed(v,Object.keys(SHOP))&&Object.keys(SHOP).every(k=>v[k]===SHOP[k]);}
function sourceUrl(value,id){if(typeof value!=="string"||value.length>2048)return false;try{const u=new URL(value);return u.href===value&&u.origin==="https://filiale.kaufland.de"&&u.pathname==="/angebote/uebersicht.html"&&!u.username&&!u.password&&!u.hash&&u.searchParams.size===2&&u.searchParams.getAll("kloffer-category").length===1&&u.searchParams.getAll("kloffer-articleID").length===1&&u.searchParams.get("kloffer-category")==="135_Foodknueller"&&u.searchParams.get("kloffer-articleID")===id;}catch{return false;}}
function nativePack(value){if(typeof value!=="string")return null;const m=/^je\s+(?:Ka\.\s+)?(?:(\d{1,3})\s*x\s*)?(\d+(?:[.,]\d+)?)\s*-\s*(g|kg|ml|l)-(?:Packg\.?|Packung|Stück|Becher|Dose|Glas|Beutel|Fl\.|Flasche|Tube)$/i.exec(value);if(!m)return null;const count=Number(m[1]||1),amount=Number(m[2].replace(",",".")),unit=m[3].toLowerCase(),base=amount*(unit==="kg"||unit==="l"?1000:1);return count>=1&&count<=999&&Number.isFinite(base)&&base>0&&base*count<=100000000?{pack:(count>1?count+" x ":"")+amount+" "+unit,packCount:count,packAmount:base,packUnit:unit==="kg"||unit==="g"?"g":"ml"}:null;}
function amounts(v){
  if(!closed(v,["default","card","multibuy"]))return false;
  if(v.default!==null&&(!closed(v.default,["amount","condition"])||!money(v.default.amount)||v.default.condition!=="no-card-or-multibuy-on-card"))return false;
  if(v.card!==null&&(!closed(v.card,["amount","condition","nativeLabel"])||!money(v.card.amount)||v.card.condition!=="kaufland-card-xtra"||v.card.nativeLabel!=="Mit Kaufland Card XTRA **"))return false;
  if(v.multibuy!==null){const b=v.multibuy;if(!closed(b,["amount","condition","minimumPurchaseCount","nativePerPackCalculation"])||!money(b.amount)||!text(b.condition,100)||!text(b.nativePerPackCalculation,200,true))return false;
    const count=/^(\d{1,3}) Stück$/.exec(b.condition),gratis=/^(\d{1,2})\s*\+\s*(\d{1,2})\s*gratis$/i.exec(b.condition),expected=count?Number(count[1]):gratis?Number(gratis[1])+Number(gratis[2]):null;
    if(expected!==null&&(!Number.isSafeInteger(expected)||expected<1||b.minimumPurchaseCount!==expected)||expected===null&&b.minimumPurchaseCount!==null)return false;
  }
  return v.multibuy!==null?v.default===null:v.default!==null;
}
function expectedHolds(p,pack){
  const holds=["article-sale-validity-unverified"],v=p.announcedAmounts;
  if(!pack)holds.push("exact-sale-pack-unresolved");if(/\boder\b|\bversch\.?\b|verschiedene/i.test(p.name))holds.push("exact-variant-unresolved");
  if(v.multibuy&&!/^(?:\d{1,3} Stück|\d{1,2}\s*\+\s*\d{1,2}\s*gratis)$/i.test(v.multibuy.condition))holds.push("multibuy-terms-unresolved");
  if(pack&&p.nativeBasePrice&&!v.multibuy){const m=[...p.nativeBasePrice.matchAll(/\(1 (kg|l) = (\d+\.\d{2})\)/g)];if(m.length!==1+(v.card?1:0)||m.some((r,i)=>(r[1]==="kg"?pack.packUnit!=="g":pack.packUnit!=="ml")||Math.abs(Number(r[2])-(i?v.card.amount:v.default.amount)*1000/(pack.packAmount*pack.packCount))>.010001))holds.push("native-pack-base-price-conflict");}
  if(/\d+\s*(?:St\.|Stück)\s*=/.test(p.nativeQuantity)){holds.push("individual-piece-weight-unverified");const total=/=\s*(\d+(?:[.,]\d+)?)\s*-\s*(g|ml)-Packg\.$/.exec(p.nativeQuantity),base=/^\(1 (kg|l) = (\d+\.\d{2})\)$/.exec(p.nativeBasePrice||"");if(total&&base&&!v.multibuy){const weight=Number(total[1].replace(",","."));if(weight<=0||(total[2]==="g"?base[1]!=="kg":base[1]!=="l")||Math.abs(Number(base[2])-v.default.amount*1000/weight)>.010001)holds.push("native-pack-base-price-conflict");}}
  return holds;
}
function requestValid(v){return v===undefined||object(v)&&Object.keys(v).every(k=>["search","limit"].includes(k))&&(v.search===undefined||text(v.search,120))&&(v.limit===undefined||Number.isSafeInteger(v.limit)&&v.limit>=1&&v.limit<=200);}
const copy=v=>JSON.parse(JSON.stringify(v));
function candidate(input,options={}){
  try{
    const now=clock(options),p=input?.publication,r=input?.reference;
    if(now===null||!requestValid(options.request)||!object(input)||Object.keys(input).some(k=>!["publication","reference"].includes(k))||!closed(p,PUBLICATION_KEYS)||!closed(r,REFERENCE_KEYS))return null;
    if(p.kind!=="branch-weekly-offer-publication"||p.identityKind!=="native-offer-group-not-sku"||p.sourceId!==SOURCE||p.merchant!==MERCHANT||typeof p.nativePublicationId!=="string"||!ID.test(p.nativePublicationId)||p.state!=="published"||p.currency!=="EUR")return null;
    if(p.scopeCountry!=="DE"||p.scopeCity!=="Berlin"||p.scopeChannel!==CHANNEL||p.nativeMarketId!=="DE1980"||!sameShop(p.shop)||!sourceUrl(p.sourceUrl,p.nativePublicationId)||p.sourceResponseUrl!==PAGE_URL||p.indexResponseUrl!==INDEX_URL||!["sourceResponseHash","indexResponseHash","proofHash"].every(k=>typeof p[k]==="string"&&HASH.test(p[k])))return null;
    if(["gtin","retailerSku","deposit","payablePackPrice","nativeValidity","expiresAt","priceObservedAt"].some(k=>p[k]!==null)||["publicationOriginalValidityVerified","numericComparisonEligible","current","truthEligible","physicalStorePriceVerified","normalPriceClassificationVerified","currentAvailabilityVerified","fullAssortment"].some(k=>p[k]!==false)||p.priceType!=="unknown"||p.promotionStatus!=="weekly-promotional-publication"||p.availability!=="unknown")return null;
    const at=iso(p.capturedAt),indexAt=iso(p.indexCapturedAt),w=p.nativePublicationWindow;
    if(at===null||indexAt===null||at>now||indexAt>now||indexAt<at||indexAt-at>300000||!closed(w,["dateFrom","dateTo"])||!date(w.dateFrom)||!date(w.dateTo)||w.dateFrom>w.dateTo||Date.parse(w.dateTo)-Date.parse(w.dateFrom)>6*DAY_MS||localDay(at)<w.dateFrom||localDay(at)>w.dateTo)return null;
    if(!text(p.name)||!text(p.nativeQuantity,100)||p.nativeBasePrice!==null&&!text(p.nativeBasePrice,400,true)||!amounts(p.announcedAmounts)||p.previousPublishedAmount!==null&&!money(p.previousPublishedAmount)||![null,"limited-promotional-stock"].includes(p.priceFootnote))return null;
    const pack=nativePack(p.nativeQuantity);
    if(typeof p.packVerified!=="boolean"||p.packVerified!==!!pack||pack&&Object.keys(pack).some(k=>p[k]!==pack[k])||!pack&&["pack","packCount","packAmount","packUnit"].some(k=>p[k]!==null))return null;
    if(!Array.isArray(p.numericComparisonHoldReasons)||p.numericComparisonHoldReasons.length>HOLD_REASONS.size||new Set(p.numericComparisonHoldReasons).size!==p.numericComparisonHoldReasons.length||p.numericComparisonHoldReasons.some(v=>!HOLD_REASONS.has(v))||expectedHolds(p,pack).some(v=>!p.numericComparisonHoldReasons.includes(v)))return null;
    const key=JSON.stringify([p.identityKind,SOURCE,"DE1980",p.nativePublicationId,w.dateFrom,w.dateTo]);
    if(r.kind!=="branch-weekly-publication"||r.identityKind!==p.identityKind||r.city!=="Berlin"||r.country!=="DE"||r.merchant!==MERCHANT||r.key!==key||r.observedAt!==p.capturedAt||!sameShop(r.sourceMarket)||r.observedMarkets!==1)return null;
    if(options.request?.search&&!p.name.toLocaleLowerCase("de").includes(options.request.search.toLocaleLowerCase("de")))return null;
    return{publication:copy(p),reference:copy(r),datedInfo:{kind:"dated-publication",capturedAt:p.capturedAt,capturedAgeMs:now-at}};
  }catch{return null;}
}
function invalid(reason="invalid-kaufland-publication-response"){return{ok:false,promotionalPublications:[],reason};}
function normalizeResponse(raw,options={}){
  try{
    const now=clock(options);if(now===null||!requestValid(options.request)||!closed(raw,["ok","promotionalPublications","promotionalPublicationCoverage","truncated"])||raw.ok!==true||typeof raw.truncated!=="boolean"||!Array.isArray(raw.promotionalPublications)||raw.promotionalPublications.length>50)return invalid();
    const c=raw.promotionalPublicationCoverage,rows=raw.promotionalPublications;
    if(!closed(c,COVERAGE_KEYS)||c.sourceId!==SOURCE||c.merchant!==MERCHANT||["current","physicalStorePriceVerified","normalPriceClassificationVerified","fullAssortment"].some(k=>c[k]!==false)||c.nativeProductIdentities!==0||typeof c.ambiguousLatestCapture!=="boolean"||["receivedGroups","acceptedGroups","heldGroups","matchedGroups"].some(k=>!Number.isSafeInteger(c[k])||c[k]<0||c[k]>50)||c.acceptedGroups+c.heldGroups!==c.receivedGroups||c.matchedGroups>c.acceptedGroups||rows.length>c.matchedGroups||!raw.truncated&&rows.length!==c.matchedGroups)return invalid();
    const documentAt=c.documentCapturedAt===null?null:iso(c.documentCapturedAt);if(c.documentCapturedAt!==null&&(documentAt===null||documentAt>now)||c.receivedGroups>0&&documentAt===null)return invalid();
    if(c.ambiguousLatestCapture){if(rows.length||c.acceptedGroups||c.matchedGroups)return invalid("ambiguous-kaufland-latest-capture");return{ok:true,promotionalPublications:[],promotionalPublicationCoverage:{...copy(c),displayedGroups:0,excludedResponseGroups:0,coverageComplete:false},truncated:raw.truncated};}
    const ids=new Map();let snapshot=null;
    for(const row of rows){const p=row?.publication;if(object(p)&&typeof p.nativePublicationId==="string"&&ID.test(p.nativePublicationId))ids.set(p.nativePublicationId,(ids.get(p.nativePublicationId)||0)+1);
      // The API reads one latest original pair. Never pick a cheaper/older row
      // from a mixed snapshot, even when the newer conflicting row is invalid.
      if(object(p)&&typeof p.capturedAt==="string"&&p.capturedAt!==c.documentCapturedAt)return invalid("mixed-kaufland-publication-snapshots");
      if(object(p)&&["sourceResponseHash","indexResponseHash","proofHash"].every(k=>typeof p[k]==="string"&&HASH.test(p[k]))&&closed(p.nativePublicationWindow,["dateFrom","dateTo"])){
        const binding=JSON.stringify([p.sourceResponseHash,p.indexResponseHash,p.proofHash,p.indexCapturedAt,p.nativePublicationWindow.dateFrom,p.nativePublicationWindow.dateTo]);if(snapshot!==null&&snapshot!==binding)return invalid("mixed-kaufland-publication-snapshots");snapshot=binding;
      }
    }
    const valid=[];for(const row of rows){const id=row?.publication?.nativePublicationId;if(ids.get(id)!==1)continue;const v=candidate(row,options);if(v)valid.push(v);}
    const limit=options.request?.limit??50,promotionalPublications=valid.slice(0,limit);
    return{ok:true,promotionalPublications,promotionalPublicationCoverage:{...copy(c),displayedGroups:promotionalPublications.length,excludedResponseGroups:rows.length-valid.length,coverageComplete:false},truncated:raw.truncated||valid.length>limit};
  }catch{return invalid();}
}
const api=Object.freeze({SOURCE,CHANNEL,SHOP,candidate,normalizeResponse});if(root)root.CaddyKauflandPublicationView=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
