"use strict";
const assert=require("assert/strict"),Seed=require("../dm-discovery-seed"),actual=require("../data/dm-discovery-seed.json");
const targets=Seed.read();assert.equal(targets.length,150);assert.equal(new Set(targets.map(t=>t.retailerSku)).size,150);assert(targets.some(t=>/reis|nudel|drink|mehl|hafer|müsli/i.test(t.name)));
const withPrice=structuredClone(actual);withPrice.targets[0].price=.9;assert.throws(()=>Seed.validate(withPrice),/price-fields-forbidden/);
const changed=structuredClone(actual);changed.targets[0].name="Changed identity";assert.throws(()=>Seed.validate(changed),/checksum-mismatch/);
const foreign=structuredClone(actual);foreign.targets[0].sourceUrl="https://example.test/p/d/123/offer";assert.throws(()=>Seed.validate(foreign),/retailer-url-invalid/);
assert.throws(()=>Seed.validate({...actual,truthEligible:true}),/discovery-only-required/);console.log("dm-discovery-seed: 150 captured real retailer identities, exact provenance/checksum and no bundled price/availability evidence OK");
