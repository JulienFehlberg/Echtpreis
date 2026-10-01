const assert=require("assert"),S=require("../source-semantics");
let p=S.policy({source:"Open Prices"});assert.strictEqual(p.currentPrice,true);assert(p.purposes.includes("current-price"));
p=S.policy({source:"Open Food Facts"});assert.strictEqual(p.currentPrice,false);assert.strictEqual(p.identity,true);
p=S.policy({source:"Open Prices locations"});assert.strictEqual(p.currentPrice,false);assert.strictEqual(p.discovery,true);
p=S.policy({source:"REWE daily open dataset"});assert.strictEqual(p.currentPrice,false);assert.strictEqual(p.corroboration,true);
p=S.policy({source:"SPARKORB POS feed"});assert.strictEqual(p.currentPrice,false);
assert.strictEqual(S.truthEligible({sourceType:"official_retailer",sourceId:"licensed-feed"}),true);
assert.strictEqual(S.truthEligible({sourceType:"product_catalog",sourceId:"catalog"}),false);
assert.strictEqual(S.truthEligible({sourceType:"store_catalog",sourceId:"locations"}),false);
assert.strictEqual(S.truthEligible({sourceType:"open_data",truthEligible:false}),false);
assert.strictEqual(S.sourceName({source:"external",sourceId:"Open Food Facts"}),"Open Food Facts");assert.strictEqual(S.truthEligible({source:"external",sourceId:"Open Food Facts",sourceType:"open_data"}),false);
console.log("source-semantics: ok");
for(const source of["ALDI Nord published assortment","Wolt EDEKA Berlin","REWE Berlin pickup","dm online"]){for(const sourceType of["official_retailer","pos_feed","open_data"]){const policy=S.policy({source,sourceType,type:"official_retailer",truthEligible:true});assert.strictEqual(policy.type,"retailer_published_offer");assert.strictEqual(policy.currentPrice,false,"A caller cannot promote a registered published quote to physical price truth");assert.strictEqual(S.policy({source:"external",sourceId:source,sourceType}).currentPrice,false);}}
