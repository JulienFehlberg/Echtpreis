"use strict";
const CSV=require("./csv-price-feed"),Adapter=require("./retailer-feed-adapter"),Persist=require("./external-price-import"),Net=require("./resilient-fetch");
const FEEDS=[
 {region:"Bavaria",url:"https://raw.githubusercontent.com/L480/rewe-price-data/main/data/bavaria.csv"},
 {region:"Schleswig-Holstein",url:"https://raw.githubusercontent.com/L480/rewe-price-data/main/data/schleswig-holstein.csv"}
];
async function refresh({pool,fetchImpl=fetch,feeds=FEEDS,today=new Date().toISOString().slice(0,10)}={}){
 if(!pool)throw new Error("database-required");let received=0,accepted=0,rejected=0,duplicates=0;const prepared=[];
 // Validate every feed before any database writes. Undated legacy exports fail
 // closed, even if HTTP headers or their latest Git commit look recent.
 for(const feed of feeds){const res=await Net.request(feed.url,{}, {fetchImpl,timeoutMs:15000,retries:2,baseDelayMs:500});if(!res.ok)throw new Error("rewe-daily-http-"+res.status);const text=await res.text(),rows=CSV.rewe(CSV.parse(text),{...feed,sourceUrl:feed.url,today});received+=rows.length;
  const normalized=Adapter.normalize("rewe",rows,{allowUnapproved:true,region:feed.region,sourceUrl:feed.url,fetchedAt:new Date().toISOString()});
  normalized.accepted=(normalized.accepted||[]).map((x,index)=>{
   if(String(x.observedAt||"").slice(0,10)!==rows[index]?.date)throw new Error("rewe-source-date-not-preserved");
   return{...x,brand:rows[index].brand,pack:rows[index].pack,proof:null,proofType:null,sourceDateBasis:rows[index].sourceDateBasis,source:"REWE daily open dataset",sourceId:"REWE daily open dataset",sourceType:"aggregated_open_data",registryTrust:76,evidencePurpose:"corroboration",truthEligible:false};
  });prepared.push({feed,normalized})}
 for(const {feed,normalized}of prepared){const saved=await Persist.persist(pool,normalized,{source:"REWE daily open dataset",sourceUrl:feed.url});accepted+=saved.accepted;rejected+=saved.rejected;duplicates+=saved.duplicates}
 return{received,accepted,rejected,duplicates,feeds:feeds.length};
}
module.exports={FEEDS,refresh};
