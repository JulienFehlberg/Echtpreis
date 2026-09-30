"use strict";
const CSV=require("./csv-price-feed"),Adapter=require("./retailer-feed-adapter"),Persist=require("./external-price-import");
const FEEDS=[
 {region:"Bavaria",url:"https://raw.githubusercontent.com/L480/rewe-price-data/main/data/bavaria.csv"},
 {region:"Schleswig-Holstein",url:"https://raw.githubusercontent.com/L480/rewe-price-data/main/data/schleswig-holstein.csv"}
];
async function refresh({pool,fetchImpl=fetch,feeds=FEEDS}={}){
 if(!pool)throw new Error("database-required");let received=0,accepted=0,rejected=0,duplicates=0;
 for(const feed of feeds){const res=await fetchImpl(feed.url);if(!res.ok)throw new Error("rewe-daily-http-"+res.status);const text=await res.text(),rows=CSV.rewe(CSV.parse(text),feed);received+=rows.length;
  const normalized=Adapter.normalize("rewe",rows,{allowUnapproved:true,region:feed.region,date:new Date().toISOString().slice(0,10),fetchedAt:new Date().toISOString()});
  const saved=await Persist.persist(pool,normalized,{source:"REWE daily open dataset",sourceUrl:feed.url});accepted+=saved.accepted;rejected+=saved.rejected;duplicates+=saved.duplicates}
 return{received,accepted,rejected,duplicates,feeds:feeds.length};
}
module.exports={FEEDS,refresh};
