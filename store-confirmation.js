"use strict";
function rad(x){return Number(x)*Math.PI/180}
function distanceKm(a,b){if(!a||!b||![a.latitude,a.longitude,b.latitude,b.longitude].every(Number.isFinite))return null;const R=6371,dLat=rad(b.latitude-a.latitude),dLon=rad(b.longitude-a.longitude),x=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function nearby(stores=[],position={},merchant,limit=4){
 return stores.filter(s=>String(s.merchant||"").toLowerCase()===String(merchant||"").toLowerCase()).map(s=>({...s,distanceKm:distanceKm(position,{latitude:Number(s.latitude),longitude:Number(s.longitude)})})).filter(s=>s.distanceKm!=null).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,Math.max(1,Math.min(10,limit))).map(s=>({id:s.id,merchant:s.merchant,address:s.address,postalCode:s.postalCode,city:s.city,distanceKm:Math.round(s.distanceKm*100)/100}));
}
function needsConfirmation(resolution){return!resolution||!["verified","user_verified"].includes(String(resolution.state||"").toLowerCase())}
module.exports={distanceKm,nearby,needsConfirmation};
