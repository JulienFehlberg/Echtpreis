"use strict";
const Sources=require("./price-sources");
const MIN=60*1000,HOUR=60*MIN,DAY=24*HOUR;
const DEFAULTS={pos_feed:MIN,retailer:15*MIN,open_data:HOUR,product_catalog:DAY,aggregator:30*MIN,price_archive:6*HOUR,b2b_price_data:15*MIN,aggregated_open_data:6*HOUR,first_party_receipt:DAY,first_party_shelf:DAY};
function interval(source={}){const n=Number(source.refreshMs);return Number.isFinite(n)&&n>=MIN?n:DEFAULTS[source.type]||HOUR}
function due(source={},state={},now=Date.now()){if(!source.active)return false;const last=state.lastSuccessAt||state.lastAttemptAt;if(!last)return true;const t=new Date(last).getTime();return Number.isFinite(t)&&now-t>=interval(source)}
function plan(states={},now=Date.now()){return Object.entries(Sources.SOURCES).map(([name,source])=>({name,type:source.type,active:!!source.active,intervalMs:interval(source),due:due(source,states[name]||{},now),lastSuccessAt:states[name]?.lastSuccessAt||null,lastAttemptAt:states[name]?.lastAttemptAt||null})).sort((a,b)=>Number(b.due)-Number(a.due)||a.intervalMs-b.intervalMs)}
function freshness(source={},lastSuccessAt,now=Date.now()){if(!lastSuccessAt)return{state:"never",ageMs:null,stale:true};const ageMs=Math.max(0,now-new Date(lastSuccessAt).getTime()),i=interval(source);return{state:ageMs<=i*1.5?"fresh":ageMs<=i*3?"late":"stale",ageMs,stale:ageMs>i*3}}
module.exports={MIN,HOUR,DAY,DEFAULTS,interval,due,plan,freshness};
