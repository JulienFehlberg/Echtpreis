"use strict";
const assert=require('node:assert/strict'),Pub=require('../penny-berlin-publications'),Client=require('../app/penny-reference-client'),Directory=require('../berlin-reference-directory');
const {capture,rehash}=require('./helpers/penny-capture-fixture');
const now=Date.parse('2026-10-02T18:01:00Z'),at=now-60000;
let groups=0;const test=(name,fn)=>{fn();groups++;console.log('ok '+groups+' - '+name);};
test('Original raw hash, Berlin market/region and whole snapshot are bound',()=>{
 const raw=capture(at),before=JSON.stringify(raw),p=Pub.parseCapture(raw,{now});assert.equal(JSON.stringify(raw),before);assert.equal(p.received,36);assert.equal(p.accepted,33);assert.equal(p.rejected,3);
 assert.equal(p.quarantined.filter(r=>r.reasons.includes('unresolved-same-title-pack-price-conflict')).length,2);assert(p.quarantined.some(r=>r.reasons.includes('native-pack-base-price-conflict')));
 assert(p.publications.every(r=>Client.candidate(r,{now})));const regional=p.publications.find(r=>r.publication.sourceUrl.includes('/15A-01-56/'));assert(regional);
 for(const {publication:q,reference:r} of p.publications){assert.equal(q.gtin,null);assert.equal(q.retailerSku,null);assert.equal(q.deposit,null);assert.equal(q.payablePackPrice,null);assert.equal(q.truthEligible,false);assert.equal(q.priceType,'unknown');assert.equal(q.nativeValidity,null);assert.equal(q.fullAssortment,undefined);assert.equal(r.observedAt,q.capturedAt);}
});
test('Reject body tampering, wrong country/market/region, cached HTTP and invented capture times',()=>{
 for(const mutate of [r=>r.offers.body+=' ',r=>r.market.sourceResponseUrl+='?other=1',r=>r.offers.sourceResponseUrl=r.offers.sourceResponseUrl.replace('15A-01-56','15A-99-99'),r=>r.offers.headers.age='301',r=>r.offers.headers.date=new Date(at-301000).toUTCString(),r=>r.offers.capturedAt=new Date(now+1).toISOString(),r=>r.offers.headers['content-type']='text/html',r=>{const s=JSON.parse(r.market.body);s.city='Hamburg';r.market.body=JSON.stringify(s);rehash(r);},r=>{r.categoryPage.body=r.categoryPage.body.replace('2026-40','2026-39');rehash(r);}]){const raw=capture(at);mutate(raw);assert.throws(()=>Pub.parseCapture(raw,{now}),/penny-/);}
});
test('Exact sales packs, cents and first party detail URLs retain conflicting raw cards',()=>{
 const changes=[t=>t.price='1.491',t=>t.quantity='je ca. 125 g',t=>t.quantity='je 250 g',t=>t.linkHref='/angebote/15A-99-99/dauerhaft-im-preis-gesenkt/test',t=>t.linkHref='https://outside.test/card',t=>t.onlyOnline=true,t=>t.multiBuy=true,t=>t.gtin='4008400401621',t=>t.productData=JSON.stringify({...JSON.parse(t.productData),price:'1.99'})];
 for(const change of changes){const raw=capture(at,b=>change(b.offerTiles[0])),p=Pub.parseCapture(raw,{now});assert.equal(p.accepted,32);assert(p.quarantined.some(r=>r.rawRowIndex===0));}
 const p=Pub.parseCapture(capture(at),{now}),multi=p.publications.find(r=>r.publication.packCount===6);assert(multi);assert.equal(multi.publication.packAmount,40);assert.equal(multi.publication.pack,'6 x 40 g');
});
test('Duplicate CMS documents withhold every version; names alone never merge sales packs',()=>{
 const p=Pub.parseCapture(capture(at,b=>b.offerTiles.push(structuredClone(b.offerTiles[0]))),{now});assert.equal(p.accepted,32);assert.equal(p.quarantined.filter(r=>r.reasons.includes('duplicate-cms-document')).length,2);
 const original=Pub.parseCapture(capture(at),{now});assert(original.publications.some(r=>r.publication.packAmount===400));assert(original.publications.some(r=>r.publication.packAmount===500));
});
test('Original expiry, Berlin DST week boundaries and ISO year stay conservative',()=>{
 const p=Pub.parseCapture(capture(at),{now});assert.equal(p.expiresAt,new Date(at+Pub.DAY_MS).toISOString());assert.equal(Pub.parseCapture(capture(at),{now:at+Pub.DAY_MS}).current,false);
 for(const [stamp,end]of[['2026-10-04T21:30:00Z','2026-10-04T22:00:00.000Z'],['2026-10-25T22:30:00Z','2026-10-25T23:00:00.000Z'],['2026-03-29T21:30:00Z','2026-03-29T22:00:00.000Z']])assert.equal(new Date(Pub.weekEnd(Date.parse(stamp))).toISOString(),end);
 assert.equal(Pub.week(Date.parse('2027-01-01T12:00:00Z')),'2026-53');
});
function poolFor(raws){return{query:async sql=>({rows:sql.startsWith('SELECT')?raws.map(raw=>{const p=Pub.parseCapture(raw,{now});return{proofHash:p.proofHash,capturedAt:p.capturedAt,rawCapture:raw};}):[],rowCount:0})};}
(async()=>{
 const old=capture(at-1000),bad=capture(at,b=>{b.offerTiles[0].quantity='je ca.125 g';});
 const name=JSON.parse(old.offers.body).offerTiles[0].title;
 const result=await Pub.search(poolFor([bad,old]),{search:name,now});assert.equal(result.publications.length,0,'Latest invalid native card cannot reveal old good card');groups++;
 const empty=capture(at,b=>b.offerTiles=[]);assert.equal((await Pub.search(poolFor([empty,old]),{now})).publications.length,0);groups++;
 const tied=capture(at,b=>b.offerTiles[0].title='OTHER TEST CARD');assert.equal((await Pub.search(poolFor([capture(at),tied]),{now})).publicationCoverage.ambiguousLatestCapture,true);groups++;
 assert.equal((await Pub.search(poolFor([capture(at)]),{gtin:'4008400401621',now})).publications.length,0);assert.equal((await Pub.search(poolFor([capture(at)]),{scopeChannel:'physical-store',now})).publications.length,0);groups++;
 const pool={query:async()=>({rows:[],rowCount:1})};await assert.rejects(Pub.persist(pool,capture(at),{now:at+Pub.DAY_MS}),/already-expired/);groups++;
 const query={search:'Schoko',merchant:'penny',now,limit:20};let passed;
 const ordinary={ok:true,city:'Berlin',country:'DE',items:[],scopeChannels:[],coverage:{complete:false,retailers:['ALDI','PENNY','REWE','Lidl','Kaufland','EDEKA'].map(merchant=>({merchant,referenceRows:0,missing:true,scopeChannels:[],supportedSources:[]}))}};
 const regional={publications:[Pub.parseCapture(capture(at),{now}).publications[0]],publicationCoverage:{matchedCards:1},truncated:false};
 const combined=await Directory.search(pool,query,{references:{search:async()=>ordinary},penny:{search:async(_pool,input)=>{passed=input;return regional;}}});assert.equal(passed.merchant,'PENNY');assert.equal(combined.items.length,0);assert.equal(combined.publications.length,1);assert.equal(combined.coverage.retailers.find(r=>r.merchant==='PENNY').referenceRows,0);assert.equal(combined.coverage.retailers.find(r=>r.merchant==='PENNY').publicationReferences,1);assert(!combined.coverage.missingRetailers.includes('PENNY'));assert.equal(combined.coverage.complete,false);groups++;
 console.log('penny-berlin-publications: '+groups+' original binding, pack/quarantine, no canonical identities, expiry, latest-snapshot and separate coverage groups OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
