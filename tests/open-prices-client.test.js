"use strict";
const assert=require("assert/strict"),C=require("../open-prices-client");
const today="2026-09-30",code="3017620422003";
function row(id=1,patch={}){return{id,type:"PRODUCT",price:3.99,currency:"EUR",date:today,proof_id:80+id,proof:{id:80+id,type:"PRICE_TAG",draft:false,date:today,currency:"EUR",location_id:12,location_osm_id:1234567,location_osm_type:"NODE"},product_code:code,product:{code,product_name:"Nutella",brands:"Ferrero",quantity:"450 g"},location_id:12,location:{id:12,type:"OSM",osm_id:1234567,osm_type:"NODE",osm_tag_key:"shop",osm_tag_value:"supermarket",osm_name:"EDEKA",osm_brand:"EDEKA",osm_address_city:"Berlin",osm_address_country:"Deutschland",osm_address_country_code:"DE",osm_lat:52.52,osm_lon:13.4},...patch}}
function response(items,extra={}){return{ok:true,status:200,json:async()=>({page:1,pages:1,size:100,total:items.length,items,...extra})}}
(async()=>{
 const p=C.params({today,page:0,size:999,productCode:"3017 620422003",locationId:"openprices:12",since:"2020-01-01",currency:"USD",orderBy:"date"});
 assert.equal(p.get("size"),"100");assert.equal(p.get("product_code"),code);assert.equal(p.get("location_id"),"12");assert.equal(p.get("currency"),"EUR");assert.equal(p.get("date__gte"),"2026-09-23");assert.equal(p.get("date__lte"),today);assert.equal(p.get("order_by"),"-date,-id");assert.equal(p.get("duplicate_of__isnull"),"true");
 assert.equal(C.todayBerlin(new Date("2026-09-29T22:30:00Z")),today,"The Germany observation window uses Berlin's date");
 for(const input of [{productCode:"bad"+code},{productCode:"3017620422004"},{locationId:"openprices:0"},{locationId:"12junk"},{since:"2026-10-01"},{today:"2026-02-30"}])assert.throws(()=>C.params({...input,today:input.today||today}));
 const good=row(),x=await C.fetchPage({today,productCode:code,locationId:"12"},async()=>response([good]));
 assert.equal(x.accepted.length,1);assert.equal(x.total,1);assert.equal(x.rawItems[0],good,"Raw proof, OSM and product source metadata must survive adaptation unchanged");assert.equal(x.accepted[0].proof,"openprices:proof:81");assert.equal(x.window.until,today);
 const foreign=row(2,{location:{...good.location,osm_address_country_code:"FR"}}),stale=row(3,{date:"2026-09-22"}),future=row(4,{date:"2026-10-01"}),usd=row(5,{currency:"USD"}),otherCode=row(6,{product_code:"4006381333931",product:{...good.product,code:"4006381333931"}}),otherStore=row(7,{location_id:13,location:{...good.location,id:13}}),draft=row(8,{proof:{...good.proof,id:88,draft:true}});
 const mixed=await C.fetchPage({today,productCode:code,locationId:"12"},async()=>response([good,foreign,stale,future,usd,otherCode,otherStore,draft]));
 assert.equal(mixed.accepted.length,1);assert.equal(mixed.rejected.length,7);assert.equal(mixed.rawItems.length,8,"Rejected originals remain available for audit/quarantine");
 for(const reason of ["country-outside-DE","date-outside-window","unsupported-currency","product-outside-scope","location-outside-scope","draft-proof"])assert(mixed.rejected.some(r=>r.reasons.includes(reason)),reason);
 let calls=0;const paged=async url=>{calls++;const page=Number(new URL(url).searchParams.get("page"));return response([row(page)],{page,pages:2,size:1,total:2})};
 const all=await C.fetchAll({today,productCode:code,size:1},paged);assert.equal(calls,2);assert.equal(all.accepted.length,2);assert.equal(all.rawItems.length,2);assert.equal(all.fetchedPages,2);assert.equal(all.complete,true);assert.equal(all.nextPage,null);
 calls=0;const capped=await C.fetchAll({today,productCode:code,size:1,maxRequests:1},paged);assert.equal(calls,1);assert.equal(capped.complete,false);assert.equal(capped.nextPage,2);
 await assert.rejects(()=>C.fetchPage({today,page:2},async()=>response([])),/invalid-pagination/);
 await assert.rejects(()=>C.fetchPage({today},async()=>response(Array(101).fill(good))),/invalid-pagination/);
 await assert.rejects(()=>C.fetchPage({today,retries:0},async()=>({ok:true,status:200,text:async()=>" ".repeat(5*1024*1024+1)})),/body-too-large/);
 console.log("open-prices-client: raw evidence retained; DE/EUR/Berlin seven-day upper/lower bounds, exact target scopes and bounded pagination OK");
})().catch(error=>{console.error(error);process.exitCode=1});
