"use strict";
const assert=require("assert/strict"),Snapshot=require("../product-catalog-snapshot"),Import=require("../canonical-product-catalog-import"),Basket=require("../german-basket-priorities"),Client=require("../open-food-facts-catalog-client");
const snapshot=Snapshot.read(),coverage=Basket.coverage(snapshot.products);
assert.equal(snapshot.ok,true);assert(snapshot.products.length>=6000&&snapshot.products.length<=10000);assert.equal(snapshot.manifest.purpose,"identity");assert.equal(snapshot.manifest.truthEligible,false);assert.equal(snapshot.sourceUrl,Client.SOURCE_URL);assert.equal(snapshot.manifest.source.license,"ODbL-1.0");assert.equal(coverage.classified,snapshot.products.length);assert.equal(coverage.unclassified,0);assert.equal(coverage.representedFamilies,snapshot.manifest.coverage.representedFamilies);
for(const raw of snapshot.products){
 const product=Import.productCandidate(raw);assert(product.ok);assert(raw.countries_tags.includes("en:germany"));assert(Basket.family(raw));assert.equal(raw.code,product.gtin);
 for(const field of ["price","priceObservation","currentPrice","storeId","proofVerified"])assert(!Object.hasOwn(raw,field),"Metadata snapshot must not contain price evidence: "+field);
 assert(!/POSTGRES TEST|Katalogartikel|catalog item/i.test(product.name));
}
for(const family of ["milk","eggs","bread","pasta","rice","flour","coffee","water"])assert(coverage.counts[family]>0,"Real staple coverage required: "+family);
console.log("product-catalog-snapshot: Real DE GTINs with known packs, both checksums, populated staple families and identity-only provenance OK");
