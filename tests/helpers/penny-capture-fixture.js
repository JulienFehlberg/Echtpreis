"use strict";
const fixture=require('../fixtures/retailers/penny-berlin-publication-capture.json').capture;
const Pub=require('../../penny-berlin-publications');
// Synthetic compact capture only. Never load this fixture into production.
function capture(at=Date.parse('2026-10-02T18:00:00Z'), mutate=()=>{}) {
 const raw=structuredClone(fixture), week=Pub.week(at);
 for(const [key,offset] of [['market',30000],['categoryPage',20000],['offers',0]]) {
  raw[key].capturedAt=new Date(at-offset).toISOString();
  raw[key].headers.date=new Date(at-offset).toUTCString();
  raw[key].headers.age=null;
 }
 raw.categoryPage.body=raw.categoryPage.body.replace(/data-week="\d{4}-\d{2}"/,'data-week="'+week+'"');
 raw.offers.sourceResponseUrl=`https://www.penny.de/.rest/offers/by-category/${week}/${Pub.CATEGORY}/?region=${Pub.SHOP.nativeSellingRegion}`;
 const rows=JSON.parse(raw.offers.body);mutate(rows,raw);raw.offers.body=JSON.stringify(rows);
 rehash(raw);return raw;
}
function rehash(raw){for(const key of ['market','categoryPage','offers'])raw[key].sourceResponseHash=Pub.hash(raw[key].body);return raw;}
module.exports={capture,rehash};
