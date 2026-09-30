"use strict";
const assert=require("assert/strict"),Queue=require("../stable-coverage-queue");
const product=(index,priority=50,locationId)=>({productCode:String(3400000000000+index),priority,...(locationId===undefined?{}:{locationId})});
assert.equal(Queue.key(product(1,100,0)),"3400000000001@0");
assert.deepEqual(Queue.select([],{}).selected,[]);
const simple=[product(1,1),product(2,100),product(3,10),product(4,20),product(5,30),product(6,40),product(7,50),product(8,60)];
let picked=Queue.select(simple,{},4,.25);assert.deepEqual(picked.selected.map(Queue.key),[Queue.key(simple[1]),Queue.key(simple[0]),Queue.key(simple[2]),Queue.key(simple[3])]);
assert.equal(picked.next.cursorKey,Queue.key(simple[3]),"The checkpoint follows the rotating queue, not the hot target");
picked=Queue.select(simple,picked.next,4,.25);assert.deepEqual(picked.selected.map(Queue.key),[Queue.key(simple[1]),Queue.key(simple[4]),Queue.key(simple[5]),Queue.key(simple[6])]);
const merged=Queue.select([product(1,1),product(1,100),product(1,50,"12"),product(1,25,"13")],{},10,0);assert.equal(merged.selected.length,3);assert.equal(merged.selected.find(row=>row.locationId===undefined).priority,100);
assert.equal(new Set(merged.selected.map(Queue.key)).size,3,"A product-wide target and two location targets are independent queue entries");
// Moving a product into/out of the hot list cannot shift a persisted rest-array offset backwards.
const first=Queue.select(simple,{},4,.25),changed=simple.map(row=>({...row,priority:row.productCode===simple[7].productCode?1000:row.priority}));
const afterChange=Queue.select(changed,first.next,4,.25);assert.deepEqual(afterChange.selected.map(Queue.key),[Queue.key(simple[7]),Queue.key(simple[4]),Queue.key(simple[5]),Queue.key(simple[6])]);
const migrated=Queue.select(simple,{cursorKey:Queue.key(simple[3]),cursorOffset:999999,cycle:2,processedTotal:"40"},4,.25);assert.equal(migrated.selected[1].productCode,simple[4].productCode);assert.equal(migrated.next.processedTotal,44);
const rows=Array.from({length:6107},(_,index)=>product(index,index<5?1000:50)),input=JSON.stringify(rows),seen=new Set();let checkpoint={},runs=0;
for(;runs<520&&seen.size<6107;runs++){
 const hotStart=(Math.floor(runs/25)*37)%rows.length;
 const changing=rows.map((row,index)=>({...row,priority:index>=hotStart&&index<hotStart+5?10000:((index+runs)%97)}));
 const result=Queue.select(runs%2?changing.reverse():changing,checkpoint,20,.25);
 assert.equal(result.selected.length,20);assert(result.selected.slice(0,5).every(row=>row.priority===10000),"Hot demand keeps its five reserved request slots");
 for(const row of result.selected)seen.add(row.productCode);checkpoint=JSON.parse(JSON.stringify(result.next));
}
assert.equal(seen.size,6107,"Stable key rotation must cover >6,000 items while priority and hot-list membership change and checkpoints reload");
assert(runs<520);assert.equal(JSON.stringify(rows),input);assert.equal(checkpoint.lastQueueSize,6107);
const added=product(99999,1),removed=rows.filter(row=>row.productCode!==checkpoint.cursorKey?.split("@")[0]);
const resumed=Queue.select([...removed,added],checkpoint,20,.25);assert.equal(resumed.selected.length,20);assert.equal(new Set(resumed.selected.map(Queue.key)).size,20);
const one=Queue.select([product(1,100)],{},1,.25);assert.equal(one.selected.length,1);assert.equal(one.next.cursorKey,Queue.key(product(1)));
console.log("stable-coverage-queue: persisted GTIN/location rotation, priority hot share, dynamic6,107-product coverage, insert/remove and legacy checkpoint compatibility OK");
