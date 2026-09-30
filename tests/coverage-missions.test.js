const assert=require("assert"),M=require("../coverage-missions");
const ranked=M.prioritize([{product:"Hackfleisch",merchant:"EDEKA",price:null,date:null,demandScore:.9,coverageGap:1},{product:"Milch",merchant:"REWE",price:1.19,date:"2026-09-30",observedAt:"2026-09-30",proof:"x",storeId:"s",demandScore:.4}],{today:"2026-09-30"});
assert.strictEqual(ranked[0].product,"Hackfleisch");assert.strictEqual(ranked[0].missionType,"PRICE_AND_AVAILABILITY");assert(ranked[0].missionValue>70);
const o=M.observation("OUT_OF_STOCK",{storeId:"s",productId:"p",proof:"photo"});assert.strictEqual(o.price,null);assert.throws(()=>M.observation("FREE"));
console.log("coverage-missions: ok");