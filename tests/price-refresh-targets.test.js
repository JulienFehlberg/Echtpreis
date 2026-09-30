const assert=require("assert"),T=require("../price-refresh-targets");const now=Date.parse("2026-09-30T12:00:00Z");const x=T.rank([{gtin:"4008400401621",lastObservedAt:null,demandScore:.9},{gtin:"3017620422003",lastObservedAt:"2026-09-30T11:00:00Z",demandScore:.1},{gtin:"4008400401621",lastObservedAt:"2026-09-20",demandScore:1},{gtin:"bad"}],{now,limit:10});assert.strictEqual(x.length,2);assert.strictEqual(x[0].productCode,"4008400401621");assert(x[0].priority>x[1].priority);assert.deepStrictEqual(T.batches([1,2,3,4,5],2),[[1,2],[3,4],[5]]);console.log("price-refresh-targets: ok");
const staple=T.rank([{gtin:"3017620422003",lastObservedAt:null,catalogPriority:0,demandScore:1},{gtin:"4008400401621",lastObservedAt:null,catalogPriority:100,demandScore:0}],{now});assert.equal(staple[0].productCode,"4008400401621","A missing staple price should lead an unrelated missing price");
const popular=T.rank([{gtin:"3017620422003",catalogPriority:100,catalogPopularity:1},{gtin:"4008400401621",catalogPriority:100,catalogPopularity:1000}],{now});assert.equal(popular[0].productCode,"4008400401621","Equal staple priorities should use source popularity before barcode order");
function gtin(index){const body=String(340000000000+index),sum=[...body].reduce((total,digit,position)=>total+Number(digit)*(position%2?3:1),0);return body+(10-sum%10)%10}
const inventory=Array.from({length:6107},(_,index)=>({gtin:gtin(index),productId:"canonical-"+index,catalogPriority:index<5?100:index===6106?20:90,demandScore:index<5?1:0,observationCount:0,lastObservedAt:null}));
assert.equal(T.rank(inventory,{now,fullCoverage:true,limit:250}).length,6107,"Full coverage must preserve the entire >6,000-item inventory regardless of request shortlist settings");
assert.equal(T.rank(inventory,{now,limit:250}).length,250,"The existing explicit shortlist contract stays bounded");
async function databaseCoverage(){
 let calls=0;const pool={query:async(sql,params)=>{calls++;if(/LIMIT \$1\s*$/.test(sql))return{rows:inventory.slice(0,params[0])};return{rows:inventory}}};
 const all=await T.fromDatabase(pool,{now,fullCoverage:true,limit:250,candidateLimit:2000});assert.equal(all.length,6107);assert(all.some(row=>row.productCode===gtin(6106)),"The rarest lowest-priority product must enter the research universe");
 const short=await T.fromDatabase(pool,{now,limit:250,candidateLimit:2000});assert.equal(short.length,250);assert.equal(calls,2);
 const Queue=require("../stable-coverage-queue");let checkpoint={},seen=new Set(),runs=0;
 while(seen.size<6107&&runs<500){const picked=Queue.select(all,checkpoint,20,.25);assert.equal(picked.selected.length,20);for(const row of picked.selected)seen.add(row.productCode);checkpoint=picked.next;runs++}
 assert.equal(seen.size,6107,"Repeated real-budget refresh selections must reach every database product, including those outside the former2,000/5,000 caps");
 assert(runs>300&&runs<500);assert.equal(checkpoint.lastQueueSize,6107);assert.equal(checkpoint.processedTotal,runs*20);
 console.log("price-refresh-targets: complete6,107-product SQL candidate universe, bounded priority shortlist and repeated20-request coverage OK");
}
databaseCoverage().catch(error=>{console.error(error);process.exitCode=1});
