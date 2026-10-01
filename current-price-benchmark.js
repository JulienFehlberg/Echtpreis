"use strict";
const Coverage=require("./current-price-coverage");
const CurrentPrice=require("./current-price-resolver");
const Truth=require("./current-price-truth");
const Semantics=require("./source-semantics");
const Discovery=require("./price-query-discovery");
const Query=require("./current-price-query-service");
const Identity=require("./product-identity");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PRODUCTS=["Hackfleisch","Milch","Eier","Butter","Bananen","Nutella","Coca-Cola","Kaffee","Toilettenpapier","Olivenöl","Hähnchenbrust","Gurke","Tomaten","Kartoffeln","Reis"];
const DEFAULT_MERCHANTS=["EDEKA","REWE","ALDI Nord","Lidl","Kaufland","PENNY","Netto"];
const text=value=>typeof value==="string"?value.trim():"";
function requestedItem(value,index){
 const descriptor=typeof value==="string"?{product:value}:value||{};
 return{key:String(descriptor.key??index),product:text(descriptor.product||descriptor.name)||text(descriptor.gtin)||text(descriptor.productId),gtin:text(descriptor.gtin)||null,productId:text(descriptor.productId)||null,brand:text(descriptor.brand)||null,pack:text(descriptor.pack)||null,quantity:descriptor.quantity??1,legacy:typeof value==="string"};
}
function itemMetadata(item){const {key,product,gtin,productId,brand,pack,quantity}=item;return{key,product,gtin,productId,brand,pack,quantity};}
// Native imports use both city names and "city, DE". The request is not location evidence.
function regionKey(value){return Identity.norm(text(value).replace(/,\s*DE\s*$/i,""));}
function sameId(a,b){return text(a).toLowerCase()===text(b).toLowerCase();}
function sameMerchant(a,b){const aliases=Discovery.merchantAliases(a);return Discovery.merchantAliases(b).some(value=>aliases.includes(value));}
function reason(row,item,opts){
 if(!row)return"no-current-evidence";
 if(!["observed","verified"].includes(row.state)||!Number.isFinite(row.price)||row.price<=0)return row.reason||"no-current-evidence";
 if(row.comparisonOnly!==false||!["exact","sku"].includes(row.queryMode))return"exact-product-selection-required";
 if(!(item.gtin||item.productId||(item.brand&&item.pack)))return"exact-product-selection-required";
 const policy=Semantics.policy(row);
 if(row.truthEligible!==true||!policy.registered||!policy.approved||!policy.currentPrice)return"source-not-physical-current-price";
 if(row.scopeChannel&&row.scopeChannel!=="physical-store")return"source-not-physical-current-price";
 if(row.locationLevel!=="store"||!UUID.test(text(row.storeId))||row.scopeWarning)return"canonical-store-evidence-required";
 const store=row.canonicalStore;
 if(!store||!UUID.test(text(store.id))||!sameId(row.storeId,store.id)||store.active!==true||store.merchantActive!==true||!sameMerchant(row.merchant,store.merchant))return"canonical-store-evidence-required";
 if(text(store.country).toUpperCase()!=="DE")return"different-or-unknown-country";
 const region=regionKey(opts.region);
 const locations=region==="berlin"?[store.city]:[store.region,store.city];
 if(region&&!locations.some(value=>regionKey(value)===region))return"different-or-unknown-region";
 if(row.currency!=="EUR")return"unsupported-currency";
 if(!CurrentPrice.active(row,opts.today))return"price-outside-validity";
 if(CurrentPrice.freshnessDays(row,opts.today)>opts.maxAgeDays)return"stale-or-undated-evidence";
 if(row.sourceHealthState==="quarantine"||row.isOutlier)return"ineligible-evidence";
 if(!text(row.proof)&&!text(row.proofHash))return"price-proof-required";
 const entitlement=Object.fromEntries(["loyalty","app","coupon","personalized"].map(key=>[key,opts.eligibility?.[key]===true]));
 if(row.eligibility?.ok!==true||!CurrentPrice.eligible(row,{quantity:item.quantity,eligibility:entitlement}).ok)return"price-conditions-unproven";
 const query=row.query||{};
 if(query.mode&&query.mode!==row.queryMode)return"product-identity-conflict";
 if(row.queryMode==="exact"&&(!Discovery.validGtin(row.gtin)||!Discovery.validGtin(item.gtin||query.gtin)||row.gtin!==(item.gtin||query.gtin)))return"product-identity-conflict";
 for(const expected of [item.gtin,query.gtin].filter(Boolean))if(!Discovery.validGtin(expected)||row.gtin!==expected)return"product-identity-conflict";
 for(const expected of [item.productId,query.productId].filter(Boolean))if(!UUID.test(expected)||!UUID.test(text(row.productId))||!sameId(row.productId,expected))return"product-identity-conflict";
 for(const expected of [item.brand,query.brand].filter(Boolean))if(Identity.norm(row.brand)!==Identity.norm(expected))return"product-brand-conflict";
 if(row.match!=="ground-truth")return"exact-product-evidence-required";
 const nativePack=Discovery.pack(row.pack),expectedPacks=[item.pack,query.pack].filter(Boolean);
 if(!nativePack||!expectedPacks.length)return"exact-pack-evidence-required";
 if(expectedPacks.some(expected=>!Discovery.samePack(nativePack,Discovery.pack(expected))))return"product-pack-conflict";
 if(row.packAmount!=null||row.packUnit!=null||row.packCount!=null){if(!Discovery.samePack(nativePack,Discovery.productPack(row)))return"product-pack-conflict";}
 if(row.packParsed){const parsed=row.packParsed,total=nativePack.amount*nativePack.count;if(parsed.unit!==nativePack.unit||!Number.isFinite(parsed.amount)||Math.abs(parsed.amount-total)>Math.max(total,parsed.amount)*1e-9)return"product-pack-conflict";}
 if(row.per!=="piece"&&row.per!=="item")return"pack-price-required";
 return null;
}
function matrix(entries=[],products=DEFAULT_PRODUCTS,merchants=DEFAULT_MERCHANTS,options={}){
 const items=products.map(requestedItem),opts={...options,today:options.today||Query.today(),maxAgeDays:Math.min(7,Number.isInteger(options.maxAgeDays)&&options.maxAgeDays>=1?options.maxAgeDays:7)};
 const cells=[],missing=[];
 for(const item of items)for(const merchant of merchants){
  const matches=entries.filter(entry=>entry&&entry.merchant===merchant&&(item.legacy?entry.product===item.product:String(entry.benchmarkKey)===item.key));
  const row=matches[0]||null,issue=matches.length>1?"ambiguous-benchmark-cell":reason(row,item,opts),metadata=itemMetadata(item);
  const verified=!issue&&row.state==="verified"&&row.truth?.state==="supported"&&Truth.verificationEligible(row)&&row.identityVerified===true&&row.proofVerified===true&&row.priceBasis!=="derived-pack";
  const cell={...(row||{}),product:item.product,merchant,benchmarkKey:item.key,requestedIdentity:metadata,benchmarkEligible:!issue,benchmarkReason:issue,engineState:row?.state||"unknown",state:issue?"unknown":verified?"verified":"observed",price:issue?null:row.price,payablePrice:issue?null:row.payablePrice??row.price};
  cells.push(cell);
  if(issue)missing.push({...metadata,merchant,reason:issue});
 }
 const known=cells.filter(cell=>cell.benchmarkEligible),verified=known.filter(cell=>cell.state==="verified"),supported=known.filter(cell=>cell.truth?.state==="supported");
 return{products:items.length,merchants:merchants.length,totalCells:cells.length,knownCells:known.length,supportedCells:supported.length,verifiedCells:verified.length,currentCoverage:cells.length?known.length/cells.length:0,supportedCoverage:cells.length?supported.length/cells.length:0,verifiedCoverage:cells.length?verified.length/cells.length:0,coverageBasis:"exact-product-pack-store-evidence",scopeChannel:"physical-store",payableBasketVerified:false,today:opts.today,items:items.map(itemMetadata),missing,cells};
}
function productSummary(m){
 return m.items.map(item=>{const rows=m.cells.filter(cell=>cell.benchmarkKey===item.key),supported=rows.filter(cell=>cell.benchmarkEligible&&cell.truth?.state==="supported");return{...item,...Coverage.summarize(rows,{today:m.today}),supported:supported.length,supportedCoverage:rows.length?supported.length/rows.length:0};});
}
function merchantSummary(m){
 return[...new Set(m.cells.map(cell=>cell.merchant))].map(merchant=>{const rows=m.cells.filter(cell=>cell.merchant===merchant),known=rows.filter(cell=>cell.benchmarkEligible),verified=known.filter(cell=>cell.state==="verified"),supported=known.filter(cell=>cell.truth?.state==="supported");return{merchant,total:rows.length,known:known.length,supported:supported.length,verified:verified.length,missing:rows.length-known.length,coverage:rows.length?known.length/rows.length:0};});
}
module.exports={DEFAULT_PRODUCTS,DEFAULT_MERCHANTS,matrix,productSummary,merchantSummary};
