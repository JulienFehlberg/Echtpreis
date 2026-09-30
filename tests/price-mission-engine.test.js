const assert=require("assert"),M=require("../price-mission-engine");
let x=M.mission({productId:"p",storeId:"s",searches:20,unknown:true,ageDays:30,coverageGap:1});assert.strictEqual(x.eligible,true);assert(x.missionValue>=80);assert(x.rewardPoints>=70);assert.strictEqual(x.reason,"Preis fehlt");
let fresh=M.mission({productId:"p",storeId:"s",searches:1,unknown:false,ageDays:0,coverageGap:0});assert(fresh.missionValue<x.missionValue);
let conflict=M.mission({productId:"p",storeId:"s",searches:10,conflict:true,ageDays:1});assert.strictEqual(conflict.reason,"Preis widersprüchlich");assert(conflict.rewardPoints>0);
let vague=M.mission({searches:50,unknown:true});assert.strictEqual(vague.eligible,false);
console.log("price-mission-engine: ok");