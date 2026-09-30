const assert=require("assert");const C=require("../price-calibration");
const rows=[{predicted:1,actual:1.01,rangeMin:.95,rangeMax:1.05},{predicted:2,actual:2.02,rangeMin:1.9,rangeMax:2.1},{predicted:3,actual:3,rangeMin:2.9,rangeMax:3.1}];
const s=C.summarize(rows);assert.strictEqual(s.sampleCount,3);assert(s.medianApe<2);assert.strictEqual(s.rangeHitRate,1);
const base={sampleCount:100,medianApe:2,within5pct:.95,bias:0,rangeHitRate:.9};
const bad={sampleCount:20,medianApe:7,within5pct:.6,bias:8,rangeHitRate:.5};
const d=C.drift(bad,base);assert(d.detected);assert(C.learningActions(bad,base).actions.includes("reduce_confidence"));console.log("price-calibration: ok");
const cal=[];for(let i=0;i<20;i++)cal.push({predicted:10,actual:10.1,confidence:95,rangeMin:9.5,rangeMax:10.5});for(let i=0;i<20;i++)cal.push({predicted:10,actual:10.4,confidence:65,rangeMin:9,max:11,rangeMax:11});const h=C.calibrationHealth(cal);assert(["healthy","watch"].includes(h.status));
