"use strict";
const assert=require("assert/strict"),Benchmark=require("../current-price-benchmark"),Core=require("../current-price-resolver"),Query=require("../current-price-query-service");
const today="2026-09-30",gtin="4008452027718",otherGtin="4001499964541",store="20000000-0000-4000-8000-000000000001",productId="30000000-0000-4000-8000-000000000001";
const item={key:"0",product:"H-Milch",gtin,productId,brand:"Milchmarke",pack:"1 l",quantity:1};
const query={name:item.product,gtin,productId,brand:item.brand,pack:item.pack,mode:"exact"};
const canonicalStore={id:store,country:"DE",city:"Berlin",region:"Berlin, DE",merchant:"REWE",active:true,merchantActive:true};
const native={merchant:"REWE",product:item.product,gtin,productId,brand:item.brand,pack:item.pack,price:1.19,per:"item",currency:"EUR",observedAt:today+"T12:00:00Z",priceType:"regular",storeId:store,region:"Berlin, DE",source:"Open Prices",sourceType:"open_data",proof:"openprices:proof:1",proofType:"PRICE_TAG"};
function resolved(changes={},request=query,context={}){
 const observation=Query.normalizeObservation({...native,...changes});
 const result=Core.resolveMerchant(request,"REWE",observation?[observation]:[],{today,storeId:store,region:"Berlin",maxAgeDays:7,quantity:item.quantity,...context});
 return{...result,product:item.product,benchmarkKey:item.key,query:request,canonicalStore};
}
const opts={today,region:"Berlin",maxAgeDays:7};
function measure(row,requested=item,options={}){return Benchmark.matrix(row?[row]:[],[requested],["REWE"],{...opts,...options});}
function missing(row,reason,requested=item,options={}){const result=measure(row,requested,options);assert.equal(result.totalCells,1);assert.equal(result.knownCells,0,reason);assert.equal(result.verifiedCells,0);assert.equal(result.currentCoverage,0);assert.equal(result.missing[0].reason,reason);assert.equal(result.cells[0].price,null);assert.equal(result.cells[0].payablePrice,null);assert.equal(Benchmark.productSummary(result)[0].known,0);return result;}
const observed=resolved();
assert.equal(observed.state,"observed");assert.equal(observed.locationLevel,"store");assert.equal(observed.match,"ground-truth");
const counted=measure(observed);assert.equal(counted.knownCells,1);assert.equal(counted.verifiedCells,0);assert.equal(counted.missing.length,0);assert.equal(counted.payableBasketVerified,false);assert.equal(counted.coverageBasis,"exact-product-pack-store-evidence");assert.equal(counted.cells[0].proof,native.proof);assert.equal(counted.cells[0].region,"Berlin, DE");
assert.equal(measure({...observed,region:"Berlin"}).knownCells,1);
assert.equal(measure({...observed,region:null,city:"Berlin"}).knownCells,1);
assert.equal(measure({...observed,region:null,sourceRegion:"Berlin, DE"}).knownCells,1);
for(const region of [null,"Hamburg","Berlin-Mitte","Berlin, US"]){missing({...observed,region:"Berlin",canonicalStore:{...canonicalStore,region,city:region},query:{...query,region:"Berlin"}},"different-or-unknown-region");}
for(const country of [null,"AT","US"]){missing({...observed,canonicalStore:{...canonicalStore,country}},"different-or-unknown-country");}
for(const fields of [{canonicalStore:null},{canonicalStore:{...canonicalStore,id:"20000000-0000-4000-8000-000000000002"}},{canonicalStore:{...canonicalStore,active:false}},{canonicalStore:{...canonicalStore,merchantActive:false}},{canonicalStore:{...canonicalStore,merchant:"EDEKA"}}]){missing({...observed,...fields},"canonical-store-evidence-required");}
missing({...observed,canonicalStore:{...canonicalStore,city:"Hamburg",region:"Berlin"}},"different-or-unknown-region");
missing({...observed,canonicalStore:{...canonicalStore,city:null,region:"Berlin"}},"different-or-unknown-region");
assert.equal(measure({...observed,region:null,city:null,sourceRegion:null,canonicalStore:{...canonicalStore,city:"Berlin, DE",region:null}}).knownCells,1,"Canonical store city supplies the independently established pilot geography");
for(const locationLevel of ["region","regional-fallback","unspecified"]){missing({...observed,locationLevel},"canonical-store-evidence-required");}
missing({...observed,storeId:"external:6586"},"canonical-store-evidence-required");
missing({...observed,scopeWarning:"not-store-specific"},"canonical-store-evidence-required");

const consensus=Core.resolveMerchant(query,"REWE",[Query.normalizeObservation(native),Query.normalizeObservation({...native,proof:"openprices:proof:2"})],{today,storeId:store,region:"Berlin",maxAgeDays:7});assert.equal(consensus.state,"verified");
const consensusRow={...consensus,benchmarkKey:item.key,query,canonicalStore},supported=measure(consensusRow);assert.equal(supported.knownCells,1);assert.equal(supported.supportedCells,1);assert.equal(supported.verifiedCells,0,"Independent unreviewed evidence supports a price but cannot manufacture reviewed coverage");assert.equal(supported.cells[0].state,"observed");assert.equal(supported.cells[0].engineState,"verified");assert.equal(Benchmark.productSummary(supported)[0].supported,1);assert.equal(Benchmark.productSummary(supported)[0].verified,0);assert.equal(Benchmark.merchantSummary(supported)[0].supported,1);
assert.equal(measure({...consensusRow,identityVerified:true,proofVerified:true}).verifiedCells,1);
for(const flags of [{identityVerified:true,proofVerified:false},{identityVerified:false,proofVerified:true},{identityVerified:"true",proofVerified:true}]){assert.equal(measure({...consensusRow,...flags}).verifiedCells,0);}
const unsupportedOfficial=resolved({source:"retailer-contract-test",sourceType:"official_retailer",proof:"retailer:price:1"});assert.equal(unsupportedOfficial.state,"verified");missing(unsupportedOfficial,"source-not-physical-current-price");
missing({...observed,source:"unknown-upstream",sourceId:"unknown-upstream",sourceType:"open_data"},"source-not-physical-current-price");
missing({...observed,source:"SPARKORB POS feed",sourceId:"SPARKORB POS feed",sourceType:"pos_feed"},"source-not-physical-current-price");
const unreviewedReceipt=resolved({source:"SPARKORB receipt",sourceType:"first_party_receipt",status:"pending",identityVerified:false,proofVerified:false,proof:"upload:1"});assert.equal(measure({...unreviewedReceipt,state:"verified",truth:{state:"supported"}}).knownCells,1);assert.equal(measure({...unreviewedReceipt,state:"verified",truth:{state:"supported"}}).verifiedCells,0,"A claimed verification cannot overrule first-party verification requirements");
const derived=resolved({price:1.19,per:"l"});assert.equal(derived.priceBasis,"derived-pack");assert.equal(measure({...derived,state:"verified",truth:{state:"supported"}}).knownCells,1);assert.equal(measure({...derived,state:"verified",truth:{state:"supported"}}).verifiedCells,0);

const category=resolved({}, {name:"Milch",mode:"category"});assert.equal(category.price,1.19);assert.equal(category.comparisonOnly,true);missing(category,"exact-product-selection-required");
missing({...observed,queryMode:"brand",comparisonOnly:false},"exact-product-selection-required");
const legacy=Benchmark.matrix([{...category,product:"Milch"}],["Milch"],["REWE"],opts);assert.equal(legacy.knownCells,0);assert.equal(legacy.missing[0].product,"Milch");assert.equal(Benchmark.productSummary(legacy)[0].product,"Milch");
missing(observed,"exact-product-selection-required",{key:"0",product:"Milch"});
for(const state of ["unknown","stale","ineligible"]){missing({...observed,state,price:1.19},"no-current-evidence");}
for(const price of [null,0,-1,Infinity,NaN,"1.19"]){missing({...observed,price},"no-current-evidence");}
missing({...observed,comparisonOnly:true},"exact-product-selection-required");
for(const source of ["Wolt EDEKA Berlin","Wolt nahkauf Berlin Wrangelstraße","REWE Berlin pickup","dm online","ALDI Nord published assortment","Open Food Facts"]){missing({...observed,source,sourceId:source,sourceType:"pos_feed",truthEligible:true},"source-not-physical-current-price");}
for(const scopeChannel of ["online","pickup","assortment-publication"]){missing({...observed,scopeChannel},"source-not-physical-current-price");}
missing({...observed,truthEligible:false},"source-not-physical-current-price");
missing({...observed,sourceHealthState:"quarantine"},"ineligible-evidence");
missing({...observed,isOutlier:true},"ineligible-evidence");
missing({...observed,currency:"USD"},"unsupported-currency");
for(const observedAt of [null,"invalid","2026-09-22","2026-10-01"]){missing({...observed,observedAt,fetchedAt:today},"stale-or-undated-evidence");}
assert.equal(measure({...observed,observedAt:"2026-09-23"}).knownCells,1,"Seven-day native source evidence remains within the core age contract");
missing({...observed,observedAt:"2026-09-28"},"stale-or-undated-evidence",item,{maxAgeDays:1});
missing({...observed,observedAt:"2026-09-22"},"stale-or-undated-evidence",item,{maxAgeDays:100});
for(const dates of [{validTo:"2026-09-29"},{validFrom:"2026-10-01"},{validFrom:"2026-02-30"},{validFrom:"2026-10-01",validTo:"2026-09-01"}]){missing({...observed,...dates},"price-outside-validity");}
missing({...observed,proof:null,proofHash:null},"price-proof-required");

for(const conditional of ["loyalty","app","coupon","personalized"]){
 const permitted=resolved({priceType:conditional},{...query},{eligibility:{[conditional]:true}});assert.equal(permitted.price,1.19);
 missing(permitted,"price-conditions-unproven");missing(permitted,"price-conditions-unproven",item,{eligibility:{[conditional]:"true"}});
 assert.equal(measure(permitted,item,{eligibility:{[conditional]:true}}).knownCells,1);
 missing({...permitted,eligibility:null},"price-conditions-unproven",item,{eligibility:{[conditional]:true}});
}
const multi=resolved({priceType:"multi_buy",minQuantity:2},{...query},{quantity:2});missing(multi,"price-conditions-unproven");assert.equal(measure(multi,{...item,quantity:2}).knownCells,1);missing({...multi,minQuantity:null},"price-conditions-unproven",{...item,quantity:2});
missing({...observed,priceType:"mystery",eligibility:{ok:true}},"price-conditions-unproven");

for(const fields of [{gtin:otherGtin},{productId:"30000000-0000-4000-8000-000000000002"},{query:{...query,gtin:otherGtin}},{query:{...query,mode:"category"}}]){missing({...observed,...fields},"product-identity-conflict");}
missing({...observed,brand:"Different brand"},"product-brand-conflict");
missing({...observed,match:"reviewable"},"exact-product-evidence-required");
for(const pack of [null,"Milch 1 l","1-Liter-Packung"]){missing({...observed,pack},"exact-pack-evidence-required");}
for(const pack of ["2 x 500 ml","2 x 1 l","500 ml"]){missing({...observed,pack},"product-pack-conflict");}
missing({...observed,packParsed:{amount:500,unit:"ml"}},"product-pack-conflict");
missing({...observed,packAmount:500,packUnit:"ml",packCount:2},"product-pack-conflict");
missing({...observed,per:"l"},"pack-price-required");
assert.equal(measure(observed,{...item,pack:null}).knownCells,1,"GTIN-only selection uses the resolved canonical pack rather than a title guess");
missing({...observed,query:{...query,pack:null}},"exact-pack-evidence-required",{...item,pack:null});
assert.equal(measure(observed,{...item,pack:"1000 ml"}).knownCells,1,"Strict equivalent native quantity units may match");
const multiQuery={...query,pack:"6 x 500 ml"},multiNative=resolved({pack:"6 x 500 ml"},multiQuery);assert.equal(measure(multiNative,{...item,pack:"6 x 500 ml"}).knownCells,1);missing({...multiNative,pack:"3 l",packParsed:{amount:3000,unit:"ml"}},"product-pack-conflict",{...item,pack:"6 x 500 ml"});
const skuQuery={...query,gtin:null,mode:"sku"},sku=resolved({gtin:null},skuQuery);assert.equal(sku.queryMode,"sku");assert.equal(measure(sku,{...item,gtin:null}).knownCells,1,"An exact canonical productId/brand/pack is countable without inventing a GTIN");
const legacyShelf=resolved({source:"ECHTPREIS shelf",sourceType:"first_party_shelf",proof:"shelf:1"});assert.equal(measure(legacyShelf).knownCells,1,"Supported legacy source aliases retain the canonical source policy");

const variants=[item,{...item,key:"1",pack:"2 x 1 l"}],rows=[observed,{...resolved({pack:"2 x 1 l"},{...query,pack:"2 x 1 l"}),benchmarkKey:"1"}];
const variantMatrix=Benchmark.matrix(rows,variants,["REWE","EDEKA"],opts);assert.equal(variantMatrix.products,2);assert.equal(variantMatrix.totalCells,4);assert.equal(variantMatrix.knownCells,2);assert.equal(variantMatrix.currentCoverage,.5);assert.deepEqual(Benchmark.productSummary(variantMatrix).map(row=>[row.key,row.product,row.pack,row.known,row.total]),[["0","H-Milch","1 l",1,2],["1","H-Milch","2 x 1 l",1,2]]);assert.deepEqual(variantMatrix.missing.map(row=>[row.key,row.product,row.pack,row.merchant]),[["0","H-Milch","1 l","EDEKA"],["1","H-Milch","2 x 1 l","EDEKA"]]);assert.deepEqual(Benchmark.merchantSummary(variantMatrix).map(row=>[row.merchant,row.known,row.total,row.missing]),[["REWE",2,2,0],["EDEKA",0,2,2]]);
assert.equal(Benchmark.matrix([{...observed,benchmarkKey:"different"}],[item],["REWE"],opts).knownCells,0,"A same-name row from another basket position cannot cover the selected variant");
const ambiguous=Benchmark.matrix([observed,{...observed,price:2.19}],[item],["REWE"],opts);assert.equal(ambiguous.knownCells,0);assert.equal(ambiguous.missing[0].reason,"ambiguous-benchmark-cell");
const defaults=Benchmark.matrix();assert.equal(defaults.totalCells,105);assert.equal(defaults.knownCells,0);assert.equal(defaults.missing.length,105);
assert.equal(Benchmark.matrix([],[],[]).currentCoverage,0);
assert.deepEqual(observed,resolved(),"Measurement must not mutate or renew the source evidence");
console.log("current-price-benchmark: exact physical product/pack/store coverage, native freshness, conditions, honest denominator and variant identity OK");
