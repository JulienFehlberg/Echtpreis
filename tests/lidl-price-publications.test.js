"use strict";
const assert=require('node:assert/strict'),Pub=require('../lidl-price-publications'),Directory=require('../berlin-reference-directory');
const {fixture,rehash,changeArticle}=require('./helpers/lidl-capture-fixture');
const now=Date.parse('2026-10-02T18:00:00Z');let groups=0;
const test=(name,fn)=>{fn();groups++;console.log('ok '+groups+' - '+name);};
test('Original list has 20 exact-pack groups and four held groups, never native products',()=>{
 const raw=fixture(),before=JSON.stringify(raw),parsed=Pub.parseCapture(raw,{now});assert.equal(JSON.stringify(raw),before);
 assert.equal(parsed.received,24);assert.equal(parsed.accepted,20);assert.equal(parsed.rejected,4);assert.deepEqual(parsed.quarantined.map(r=>r.groupOrdinal),[8,10,17,19]);
 for(const {publication:p,reference:r}of parsed.datedPublications){assert.equal(p.current,false);assert.equal(p.gtin,null);assert.equal(p.retailerSku,null);assert.equal(p.deposit,null);assert.equal(p.expiresAt,null);assert.equal(p.priceObservedAt,null);assert.equal(p.truthEligible,false);assert.equal(p.shop,null);assert.equal(r.sourceMarket,null);assert.equal(r.observedMarkets,0);assert.equal(p.sourcePublishedDate,'2026-10-01');}
 assert.equal(parsed.nativeProductIdentities,0);assert.equal(parsed.currentPhysicalPriceImports,0);assert.equal(parsed.fullAssortment,false);
});
test('Retrieval on a later day never advances publication date or current-price eligibility',()=>{
 const original=Pub.parseCapture(fixture(),{now}),later=Pub.parseCapture(fixture('2026-10-20T12:00:00Z'),{now:'2026-10-20T12:00:00Z'});
 assert.equal(later.sourcePublishedDate,original.sourcePublishedDate);assert.notEqual(later.proofHash,original.proofHash);assert.equal(later.current,false);assert(later.datedPublications.every(r=>r.publication.expiresAt===null&&r.reference.publishedOn==='2026-10-01'));
 assert.equal(Pub.parseCapture(fixture('2026-09-30T22:00:00Z'),{now}).sourcePublishedDate,'2026-10-01','Native publication date is a Berlin calendar day, without an invented effective instant');
});
test('HTTP evidence, UTF8 hash, exact source, date, scope and rendered/native binding are required',()=>{
 for(const change of [r=>r.body+='x',r=>r.sourceResponseUrl+='?other=1',r=>r.status=302,r=>r.headers.age='301',r=>r.headers.date='Thu, 01 Oct 2026 00:00:00 GMT',r=>r.headers['content-type']='application/json',r=>r.capturedAt='2026-10-03T00:00:00Z',r=>{r.body=r.body.replace('deutschlandweit in allen','nur in ausgewählten');rehash(r);},r=>{r.body=r.body.replace('<li>Alesto Cashewkerne,','<li>OTHER Cashewkerne,');rehash(r);},r=>changeArticle(r,s=>s.replace('Es gibt keine regionalen Preisunterschiede.','Nur mit Lidl Plus.'))]){
  const raw=fixture();change(raw);assert.throws(()=>Pub.parseCapture(raw,{now}),/lidl-/);
 }
});
test('Alternative sizes, fractional gram packs, multipack arithmetic and secondary quotes stay separate',()=>{
 const rows=Pub.parseCapture(fixture(),{now}).datedPublications;
 const cereal=rows.find(r=>r.publication.groupOrdinal===18).publication;assert.equal(cereal.packAmount,211.5);assert.equal(cereal.packCount,1);
 const multi=rows.find(r=>r.publication.groupOrdinal===23).publication;assert.equal(multi.packAmount,330);assert.equal(multi.packCount,9);assert.equal(multi.pack,'9 x 0.33 l');
 assert.equal(rows.filter(r=>r.publication.groupOrdinal===24).length,1);assert.equal(Pub.salesPack('4,5-Liter-Packung (8 x 0,5 l)'),null);assert.equal(Pub.salesPack('125/200 Gramm'),null);
});
test('Wrong cents/base price and duplicate native name+pack are withheld before search',()=>{
 const wrong=changeArticle(fixture(),s=>s.replace('200 Gramm, neu 2,49 Euro (Grundpreis: 12,45','200 Gramm, neu 2,50 Euro (Grundpreis: 12,45'));
 assert(Pub.parseCapture(wrong,{now}).quarantined.some(r=>r.groupOrdinal===1));
 const duplicate=changeArticle(fixture(),s=>s.replace('<li>Alesto Studentenfutter Classic / sort., 200 Gramm, neu 1,69 Euro (Grundpreis: 8,45 Euro/kg) statt 2,29 Euro</li>','<li>Alesto Cashewkerne, 200 Gramm, neu 2,49 Euro (Grundpreis: 12,45 Euro/kg) statt 2,89 Euro</li>'));
 const parsed=Pub.parseCapture(duplicate,{now});assert.equal(parsed.accepted,18);assert.equal(parsed.quarantined.filter(r=>r.reasons.includes('duplicate-native-name-pack')).length,2);
});
function poolFor(raws){return{query:async sql=>({rows:sql.startsWith('SELECT')?raws.map(raw=>{const p=Pub.parseCapture(raw,{now});return{proofHash:p.proofHash,capturedAt:p.capturedAt,rawCapture:raw};}):[],rowCount:0})};}
(async()=>{
 const current=fixture(),pool=poolFor([current]);
 assert.equal((await Pub.search(pool,{search:'Cashewkerne',pack:'200 g',now})).datedPublications.length,1);
 assert.equal((await Pub.search(pool,{search:'Cola',pack:'9 x 330 ml',now})).datedPublications.length,1);
 assert.equal((await Pub.search(pool,{search:'Cola',pack:'2.97 l',now})).datedPublications.length,0);
 assert.equal((await Pub.search(pool,{search:'Erdnusskerne',pack:'500 g',now})).datedPublications.length,0);groups++;
 let queried=0;const forbidden={query:async()=>{queried++;assert.fail('Ineligible request must not read this source');}};
 for(const query of [{gtin:'4008400401621'},{merchant:'PENNY'},{scopeChannel:'physical-store'}])assert.equal((await Pub.search(forbidden,{...query,now})).datedPublications.length,0);assert.equal(queried,0);groups++;
 const old=fixture('2026-10-02T15:00:00Z'),bad=changeArticle(fixture(),s=>s.replace('200 Gramm, neu 2,49 Euro (Grundpreis: 12,45','200 Gramm, neu 2,50 Euro (Grundpreis: 12,45'));
 assert.equal((await Pub.search(poolFor([bad,old]),{search:'Alesto Cashewkerne',pack:'200 g',now})).datedPublications.length,0);groups++;
 const tie=changeArticle(fixture(),s=>s.replace('Alesto Cashewkerne,','Alesto OTHER Cashewkerne,'));assert.equal((await Pub.status(poolFor([current,tie]),{now})).ambiguousLatestCapture,true);groups++;
 const ordinary={ok:true,city:'Berlin',country:'DE',items:[],scopeChannels:[],coverage:{complete:false,retailers:['ALDI','PENNY','REWE','Lidl','Kaufland','EDEKA'].map(merchant=>({merchant,referenceRows:0,missing:true,scopeChannels:[],supportedSources:[]}))}};
 const combined=await Directory.search(pool,{search:'Cashewkerne',merchant:'lidl',pack:'200 g',now},{references:{search:async()=>ordinary},penny:{search:async()=>({publications:[],publicationCoverage:{matchedCards:0}})},lidl:Pub});
 assert.equal(combined.items.length,0);assert.equal(combined.publications.length,0);assert.equal(combined.datedPublications.length,1);const retailer=combined.coverage.retailers.find(r=>r.merchant==='Lidl');assert.equal(retailer.referenceRows,0);assert.equal(retailer.publicationReferences,0);assert.equal(retailer.datedPublicationReferences,1);assert.equal(retailer.missing,true,'Dated document does not claim current coverage');groups++;
 console.log('lidl-price-publications: '+groups+' original/date/scope/pack/quarantine/latest/coverage groups OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
