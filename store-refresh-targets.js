"use strict";
function score(x={}){const prices=Number(x.priceCount||0),products=Number(x.productCount||0),proofs=Number(x.proofCount||0),distance=Number(x.distanceKm||999);return Math.round(Math.max(0,100-Math.min(40,distance*2)-Math.min(35,prices/20)-Math.min(15,products/50)+Math.min(10,proofs/10)))}
function rank(rows=[],limit=100){return rows.map(x=>({...x,refreshPriority:score(x)})).sort((a,b)=>b.refreshPriority-a.refreshPriority||a.distanceKm-b.distanceKm).slice(0,Math.max(1,limit))}
function productLocationPairs(products=[],locations=[],limit=1000){const ps=[...products].sort((a,b)=>Number(b.priority||0)-Number(a.priority||0)),ls=rank(locations,locations.length),out=[];for(const l of ls)for(const p of ps){out.push({productCode:p.productCode,locationId:l.locationId,priority:Math.round((Number(p.priority||0)+Number(l.refreshPriority||0))/2)});if(out.length>=limit)return out}return out}
module.exports={score,rank,productLocationPairs};
