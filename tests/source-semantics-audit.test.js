const assert=require("assert"),A=require("../source-semantics-audit");
(async()=>{const pool={query:async()=>({rows:[
 {source:"Open Prices",sourceId:"Open Prices",sourceType:"open_data",evidencePurpose:"current-price",truthEligible:true,rows:10},
 {source:"Open Food Facts",sourceId:"Open Food Facts",sourceType:"product_catalog",evidencePurpose:"identity",truthEligible:false,rows:4},
 {source:"REWE daily open dataset",sourceId:"REWE daily open dataset",sourceType:"aggregated_open_data",evidencePurpose:null,truthEligible:null,rows:3},
 {source:"Open Food Facts",sourceId:"Open Food Facts",sourceType:"product_catalog",evidencePurpose:"identity",truthEligible:true,rows:1}
]})};const x=await A.summarize(pool);assert.strictEqual(x.totalRows,18);assert.strictEqual(x.directTruthRows,10);assert.strictEqual(x.blockedFromTruthRows,8);assert.strictEqual(x.unclassifiedRows,3);assert.strictEqual(x.mismatchGroups,1);console.log("source-semantics-audit: ok")})().catch(e=>{console.error(e);process.exit(1)});
