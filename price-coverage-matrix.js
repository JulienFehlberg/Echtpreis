"use strict";
function ageHours(x,now){const t=new Date(x.observedAt||x.fetchedAt||0).getTime();return Number.isFinite(t)&&t>0?Math.max(0,(now-t)/36e5):Infinity}
function identity(x={}){return x.gtin?"gtin-exact":x.productId?"canonical-product":x.match?.level==="exact"?"attribute-exact":x.product?"name-only":"unknown"}
function location(x={}){if(x.storeId)return"store-exact";if(x.externalLocationId)return"external-store";if(x.region)return"regional";return"national"}
function authority(x={}){if(x.priceAuthority)return x.priceAuthority;const t=x.sourceType||"";return t==="pos_feed"?"pos-live":["retailer","official_retailer","retailer_feed"].includes(t)?"official-published":["open_data","receipt","shelf"].includes(t)?"observed-evidence":"secondary"}
function freshness(x={},now=Date.now(),hours=24){const a=ageHours(x,now);return a<=hours?"fresh":a<=hours*3?"aging":"stale"}
function summarize(rows=[],opts={}){
 const now=opts.now??Date.now(),freshHours=Number(opts.freshHours)||24,out={total:rows.length,priced:0,fresh:0,storeExact:0,gtinExact:0,posLive:0,officialPublished:0,observedEvidence:0,secondary:0,stale:0,byMerchant:{},cells:{}};
 for(const x of rows){const priced=Number(x?.price)>0,id=identity(x),loc=location(x),auth=authority(x),fr=freshness(x,now,freshHours),m=x?.merchant||x?.store||"unknown";if(priced)out.priced++;if(fr==="fresh"&&priced)out.fresh++;if(fr==="stale")out.stale++;if(loc==="store-exact"&&priced)out.storeExact++;if(id==="gtin-exact"&&priced)out.gtinExact++;if(auth==="pos-live"&&priced)out.posLive++;else if(auth==="official-published"&&priced)out.officialPublished++;else if(auth==="observed-evidence"&&priced)out.observedEvidence++;else if(priced)out.secondary++;
  const bm=out.byMerchant[m]??={total:0,priced:0,fresh:0,storeExact:0,gtinExact:0,posLive:0,officialPublished:0,observedEvidence:0};bm.total++;if(priced)bm.priced++;if(priced&&fr==="fresh")bm.fresh++;if(priced&&loc==="store-exact")bm.storeExact++;if(priced&&id==="gtin-exact")bm.gtinExact++;if(priced&&auth==="pos-live")bm.posLive++;if(priced&&auth==="official-published")bm.officialPublished++;if(priced&&auth==="observed-evidence")bm.observedEvidence++;
  const k=[m,loc,id,auth,fr].join("|");out.cells[k]=(out.cells[k]||0)+1;
 }
 const d=Math.max(1,out.total);out.rates={priced:out.priced/d,fresh:out.fresh/d,storeExact:out.storeExact/d,gtinExact:out.gtinExact/d,posLive:out.posLive/d,officialPublished:out.officialPublished/d};return out
}
function gaps(summary={}){return Object.entries(summary.byMerchant||{}).map(([merchant,x])=>({merchant,missing:x.total-x.priced,stale:x.priced-x.fresh,notStoreExact:x.priced-x.storeExact,notGtinExact:x.priced-x.gtinExact,withoutOfficial:x.priced-x.officialPublished-x.posLive})).sort((a,b)=>(b.missing+b.stale+b.notStoreExact+b.notGtinExact+b.withoutOfficial)-(a.missing+a.stale+a.notStoreExact+a.notGtinExact+a.withoutOfficial))}
module.exports={ageHours,identity,location,authority,freshness,summarize,gaps};
