"use strict";
function cellKey(lat,lon,step=.1){return [Number(lat).toFixed(3),Number(lon).toFixed(3),Number(step).toFixed(3)].join(":")}
function grid(bounds={},step=.1,radiusKm=8){const minLat=Number(bounds.minLat),maxLat=Number(bounds.maxLat),minLon=Number(bounds.minLon),maxLon=Number(bounds.maxLon),s=Math.max(.02,Number(step)||.1);if(![minLat,maxLat,minLon,maxLon].every(Number.isFinite)||minLat>maxLat||minLon>maxLon)throw new Error("invalid-bounds");const out=[];for(let lat=minLat;lat<=maxLat+1e-9;lat+=s)for(let lon=minLon;lon<=maxLon+1e-9;lon+=s)out.push({key:cellKey(lat,lon,s),lat:Number(lat.toFixed(6)),lon:Number(lon.toFixed(6)),radiusKm});return out}
const PRESETS={berlin:{minLat:52.34,maxLat:52.68,minLon:13.09,maxLon:13.76,step:.08,radiusKm:6},germany:{minLat:47.27,maxLat:55.06,minLon:5.87,maxLon:15.04,step:.25,radiusKm:18}};
function preset(name){const x=PRESETS[name];if(!x)throw new Error("unknown-grid-preset");return grid(x,x.step,x.radiusKm)}
module.exports={cellKey,grid,preset,PRESETS};
