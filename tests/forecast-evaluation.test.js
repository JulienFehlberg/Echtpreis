const assert=require("assert"),E=require("../forecast-evaluation");
const champ=[],chall=[];for(let i=0;i<60;i++){champ.push({predicted:100,actual:104,rangeMin:90,rangeMax:110});chall.push({predicted:100,actual:102,rangeMin:94,rangeMax:106})}
let r=E.compare(champ,chall,{minSamples:50});assert(r.promote);assert(r.apeGain>0);
assert.strictEqual(E.compare(champ.slice(0,10),chall.slice(0,10),{minSamples:50}).promote,false);
assert.notStrictEqual(E.scopeKey({merchant:"REWE",horizonDays:1}),E.scopeKey({merchant:"REWE",horizonDays:10}));
console.log("forecast-evaluation: ok");