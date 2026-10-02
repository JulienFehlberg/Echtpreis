"use strict";
// Real collector execution over wholly synthetic responses, no network.
const Collector=require("../../hit-assortment-collector"),Gap=require("./hit-list-gap"),F=require("./hit-brand-partition"),Probe=require("../../hit-native-brand-partition");
async function batch({now=F.NOW,enabled=true,maxRequests=4,filtered={},response={},previous=null,followingRows=null}={}){
 const node=F.node(),following={...Gap.node("4261911"),count:2},prior=previous?structuredClone(previous):Gap.cursor([node,following],now);prior.total=1000;prior.seenSkus=[F.sku(999)];prior.received=1;
 const control=F.page({now}),filteredBody=F.page({now,filtered:true,...filtered}),next=F.page({now,category:following,total:2,rows:(followingRows||[F.row(90),F.row(91)]).map(raw=>({...raw,url:following.url+"/synthetic-product-"+raw.external_id}))}),capability=Probe.prepareControl(control.body,control.meta,node,{now,nativeState:F.state(Array.from({length:40},(_,i)=>F.row(i+1)),control.meta)}),url=Probe.proposal(capability).requestedUrl,h=Gap.harness({[node.url]:control.body,[url]:{body:filteredBody.body,...response},[following.url]:next.body},{now,maxRequests});
 const result=await Collector.collect({...h.options,storeProfile:require("../../hit-price-import").STORE_PROFILE,cursor:prior,brandProbeEnabled:false,brandPartitionProbeEnabled:enabled});return{previous:prior,result,calls:h.calls,time:h.options.now(),filteredUrl:url};
}
module.exports={batch};
