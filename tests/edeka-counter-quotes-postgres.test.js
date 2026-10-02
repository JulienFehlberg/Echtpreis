"use strict";
const assert=require('node:assert/strict'),Q=require('../edeka-counter-quotes'),F=require('./helpers/edeka-counter-capture-fixture');
async function main(){
 if(!process.env.DATABASE_URL){console.log('edeka-counter-quotes-postgres: skipped (DATABASE_URL absent)');return;}
 const databaseUrl=new URL(process.env.DATABASE_URL),database=decodeURIComponent(databaseUrl.pathname.slice(1));
 assert(['localhost','127.0.0.1'].includes(databaseUrl.hostname)&&databaseUrl.search===''&&/^[a-z][a-z0-9_]*_test$/i.test(database),'Integration requires an explicitly named local *_test PostgreSQL database');
 const {Pool}=require('pg'),pool=new Pool({connectionString:process.env.DATABASE_URL}),owned=[];let api,groups=0;
 const snapshot=async table=>(await pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS data FROM ${table} t`)).rows[0].data;
 const now=Date.now(),at=now-20000;
 const save=async raw=>{const parsed=Q.parseCapture(raw);owned.push(parsed.proofHash);return Q.persist(pool,raw);};
 try{
  console.log('edeka-counter-quotes-postgres runtime: '+(await pool.query('SELECT version() AS version')).rows[0].version);
  api=require('../server');await api.initDb();await Q.ensure(pool);
  const untouched=new Map();for(const table of ['products','stores','price_observations','offers'])untouched.set(table,await snapshot(table));
  const baseline=await snapshot(Q.TABLE),raw=F.synthetic(at),saved=await save(raw);
  assert.equal(saved.received,155);assert.equal(saved.accepted,124);assert.equal(saved.rejected,31);assert.equal(saved.upserted,1);groups++;
  const beforeReplay=await snapshot(Q.TABLE);assert.equal((await Q.persist(pool,raw)).unchanged,1);assert.deepEqual(await snapshot(Q.TABLE),beforeReplay);groups++;
  const found=await Q.search(pool,{nativeProductId:'538',grams:300});assert.equal(found.quotes.length,1);assert.equal(found.quotes[0].merchandiseEstimate,6.66);assert.equal(found.quotes[0].pack,null);assert.equal(found.quotes[0].truthEligible,false);assert.equal(found.quotes[0].minimumOrderOffsetDays,3);groups++;
  assert.equal((await Q.search(pool,{search:'Lachs'},{now:at+Q.DAY_MS})).quotes.length,0);assert.deepEqual(await snapshot(Q.TABLE),beforeReplay);await assert.rejects(Q.persist(pool,F.synthetic(at-Q.DAY_MS)),/capture-expired/);groups++;
  const transaction=await pool.connect();try{await transaction.query('BEGIN');const rollbackRaw=F.synthetic(at+1000,rows=>rows[0].name='SYNTHETIC TRANSACTION ROLLBACK');await Q.persist(transaction,rollbackRaw);await transaction.query('ROLLBACK');}finally{transaction.release();}assert.deepEqual(await snapshot(Q.TABLE),beforeReplay);groups++;
  const sparse=F.synthetic(at+2000,rows=>{const index=rows.findIndex(r=>r.id==='538');rows.splice(index,1);});await save(sparse);assert.equal((await Q.search(pool,{nativeProductId:'538'})).quotes.length,0,'Absent latest quote must not fall back to old evidence');groups++;
  const tieA=F.synthetic(at+3000),tieB=F.synthetic(at+3000,rows=>rows[0].name='SYNTHETIC CONFLICTING LATEST CAPTURE');await save(tieA);await save(tieB);assert.equal((await Q.status(pool)).ambiguousLatestCapture,true);assert.equal((await Q.search(pool,{search:'Lachs'})).quotes.length,0);groups++;
  const final=await save(F.synthetic(at+4000));await new Promise((resolve,reject)=>{api.server.once('error',reject);api.server.listen(0,'127.0.0.1',()=>{api.server.off('error',reject);resolve();});});
  const base='http://127.0.0.1:'+api.server.address().port,request=async route=>{const response=await fetch(base+route,{signal:AbortSignal.timeout(10000)});return{status:response.status,body:await response.json()};};
  const http=await request('/v1/edeka-counter-quotes?nativeProductId=538&grams=300');assert.equal(http.status,200,JSON.stringify(http));assert.equal(http.body.quotes[0].merchandiseEstimate,6.66);assert.equal(http.body.quotes[0].proofHash,final.proofHash);assert.equal(http.body.physicalStorePrices,false);groups++;
  const status=await request('/v1/edeka-counter-quotes/status');assert.equal(status.status,200,JSON.stringify(status));assert.equal(status.body.currentUnitPriceQuotes,124);assert.equal(status.body.storedLatestArticles,155);assert.equal(status.body.quarantinedArticles,31);groups++;
  for(const suffix of ['','?search=a','?search=Lachs&search=other','?search=Lachs&scopeChannel=physical-store','?search=Lachs&grams=0','?search=Lachs&grams=100g','?search=Lachs&limit=201'])assert.equal((await request('/v1/edeka-counter-quotes'+suffix)).status,400);groups++;
  for(const [table,value]of untouched)assert.deepEqual(await snapshot(table),value,'Canonical data remains untouched: '+table);
  assert.deepEqual((await pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS data FROM ${Q.TABLE} t WHERE NOT(proof_hash=ANY($1::text[]))`,[owned])).rows[0].data,baseline);groups++;
  console.log('edeka-counter-quotes-postgres: '+groups+' actual SQL/HTTP groups OK; original snapshots, immutable replay, rollback, latest-only absence/ties/expiry, query validation and canonical isolation');
 }finally{
  if(api){if(api.server.listening)await new Promise((resolve,reject)=>api.server.close(e=>e?reject(e):resolve()));await api.closeDb();}
  if(owned.length)await pool.query(`DELETE FROM ${Q.TABLE} WHERE proof_hash=ANY($1::text[])`,[owned]);await pool.end();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
