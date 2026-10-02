"use strict";
const assert=require('node:assert/strict'),{Pool}=require('pg');
const Pub=require('../penny-berlin-publications'),Directory=require('../berlin-reference-directory');
const {capture}=require('./helpers/penny-capture-fixture');
async function main(){
 const connectionString=process.env.DATABASE_URL;assert(connectionString,'DATABASE_URL required');const url=new URL(connectionString);
 assert.equal(url.hostname,'localhost','Only local isolated PostgreSQL allowed');assert(/^\/[a-z0-9_]+_test$/i.test(url.pathname),'Dedicated *_test database required');
 const pool=new Pool({connectionString,ssl:false,connectionTimeoutMillis:5000});let api,groups=0;const owned=[];
 const now=Date.now(),at=now-10000;
 async function snapshot(table,predicate='true',params=[]){if(!(await pool.query('SELECT to_regclass($1) AS name',['public.'+table])).rows[0].name)return null;return(await pool.query("SELECT count(*)::int AS count,md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "+table+' t WHERE '+predicate,params)).rows[0];}
 async function save(raw){const p=Pub.parseCapture(raw,{now});assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${Pub.TABLE} WHERE proof_hash=$1`,[p.proofHash])).rows[0].count,0,'Own proof must be absent');owned.push(p.proofHash);assert.equal((await Pub.persist(pool,raw,{now})).upserted,1);return p;}
 try{
  await Pub.ensure(pool);const baseline=await snapshot(Pub.TABLE),tables=['products','stores','price_observations','receipts','retailer_published_prices','wolt_retailer_published_prices','rewe_retailer_published_prices','aldi_assortment_published_prices','price_source_refresh_state'];const others=new Map();for(const table of tables)others.set(table,await snapshot(table));
  const original=capture(at),parsed=await save(original);assert.equal(parsed.accepted,33);assert.equal(parsed.rejected,3);
  assert.equal((await Pub.persist(pool,original,{now})).unchanged,1);const stored=(await pool.query(`SELECT raw_capture,accepted,quarantined FROM ${Pub.TABLE} WHERE proof_hash=$1`,[parsed.proofHash])).rows[0];assert.deepEqual(stored.raw_capture,original);assert.equal(stored.accepted,33);assert.equal(stored.quarantined.length,3);groups++;
  const title=JSON.parse(original.offers.body).offerTiles[0].title;
  const result=await Directory.search(pool,{search:title,merchant:'penny',pack:'125 g',now});assert.equal(result.items.length,0);assert.equal(result.publications.length,1);assert.equal(result.publications[0].publication.price,1.49);assert.equal(result.publications[0].publication.gtin,null);assert.equal(result.publications[0].publication.retailerSku,null);assert.equal(result.publications[0].publication.deposit,null);assert.equal(result.coverage.complete,false);assert.equal(result.coverage.retailers.find(r=>r.merchant==='PENNY').referenceRows,0);assert.equal(result.coverage.retailers.find(r=>r.merchant==='PENNY').publicationReferences,1);groups++;
  const multipack=await Directory.search(pool,{search:'Butterwaffeln',pack:'6 x 40 g',merchant:'PENNY',now});assert(multipack.publications.length);assert.equal((await Directory.search(pool,{search:'Butterwaffeln',pack:'240 g',merchant:'PENNY',now})).publications.length,0);
  assert.equal((await Directory.search(pool,{gtin:'4008400401621',merchant:'PENNY',now})).publications.length,0);assert.equal((await Directory.search(pool,{search:title,scopeChannel:'physical-store',now})).publications.length,0);groups++;
  const invalidLatest=capture(at+1000,b=>b.offerTiles[0].quantity='je ca. 125 g');await save(invalidLatest);assert.equal((await Directory.search(pool,{search:title,pack:'125 g',merchant:'PENNY',now})).publications.length,0,'New held card cannot revive an older usable card');groups++;
  const latest=capture(at+2000);await save(latest);const changedPack=capture(at+3000,b=>{const t=b.offerTiles[0];t.quantity='je 250 g';t.basePrice='(1 kg = 5.96)';});await save(changedPack);assert.equal((await Directory.search(pool,{search:title,pack:'125 g',merchant:'PENNY',now})).publications.length,0);assert.equal((await Directory.search(pool,{search:title,pack:'250 g',merchant:'PENNY',now})).publications.length,1);groups++;
  const empty=capture(at+4000,b=>b.offerTiles=[]);await save(empty);assert.equal((await Pub.status(pool,{now})).currentPublications,0);assert.equal((await Directory.search(pool,{search:title,merchant:'PENNY',now})).publications.length,0);groups++;
  const tieA=capture(at+5000),tieB=capture(at+5000,b=>b.offerTiles[0].title='POSTGRES PENNY DISTINCT CAPTURE');await save(tieA);await save(tieB);assert.equal((await Pub.status(pool,{now})).ambiguousLatestCapture,true);assert.equal((await Directory.search(pool,{search:title,merchant:'PENNY',now})).publications.length,0);groups++;
  const final=await save(capture(at+6000));const preRead=await snapshot(Pub.TABLE);
  process.env.PORT='0';api=require('../server');await new Promise((resolve,reject)=>{api.server.once('error',reject);api.server.listen(0,'127.0.0.1',()=>{api.server.off('error',reject);resolve();});});
  const base='http://127.0.0.1:'+api.server.address().port;
  const request=async route=>{const response=await fetch(base+route,{signal:AbortSignal.timeout(10000)});return{status:response.status,body:await response.json()};};
  const http=await request('/v1/berlin-reference-prices?'+new URLSearchParams({search:title,merchant:'PENNY',scopeChannel:Pub.CHANNEL,pack:'125 g'}));assert.equal(http.status,200,JSON.stringify(http));assert.equal(http.body.items.length,0);assert.equal(http.body.publications.length,1);assert.equal(http.body.publications[0].publication.proofHash,final.proofHash);assert.equal(http.body.physicalStorePrices,false);groups++;
  const status=await request('/v1/penny-berlin-publications/status');assert.equal(status.status,200);assert.equal(status.body.currentPublications,33);assert.equal(status.body.quarantinedPublications,3);assert.equal(status.body.nativeProductIdentities,0);assert.equal(status.body.fullAssortment,false);groups++;
  for(const query of ['','?search=Schoko&scopeChannel=wrong','?search=Schoko&merchant=foreign','?search=Schoko&limit=201','?search=Schoko&search=other'])assert.equal((await request('/v1/berlin-reference-prices'+query)).status,400);groups++;
  assert.equal((await Directory.search(pool,{search:title,merchant:'PENNY',now:at+6000+Pub.DAY_MS})).publications.length,0);assert.deepEqual(await snapshot(Pub.TABLE),preRead,'API/read expiry cannot mutate original captures');
  for(const [table,value]of others)assert.deepEqual(await snapshot(table),value,'No canonical or existing retailer mutation: '+table);
  assert.deepEqual(await snapshot(Pub.TABLE,'NOT(proof_hash=ANY($1::text[]))',[owned]),baseline);groups++;
  console.log('penny-berlin-publications-postgres: '+groups+' actual SQL/HTTP synthetic groups OK; raw immutable evidence, separate publication counts, quarantine, pack change, no old fallback, ties, expiry, canonical isolation');
 }finally{if(api){if(api.server.listening)await new Promise((resolve,reject)=>api.server.close(e=>e?reject(e):resolve()));await api.closeDb();}if(owned.length)await pool.query(`DELETE FROM ${Pub.TABLE} WHERE proof_hash=ANY($1::text[])`,[owned]);await pool.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
