"use strict";
const Grid=require("./geo-discovery-grid");
function density(cell={}){return Number(cell.lastReceived||0)+Number(cell.lastAccepted||0)*2}
function shouldSplit(cell={},opts={}){return Number(cell.scanCount||0)>=Number(opts.minScans||1)&&density(cell)>=Number(opts.minDensity||12)&&Number(cell.radiusKm||0)>Number(opts.minRadiusKm||2)}
function children(cell={}){const lat=Number(cell.lat),lon=Number(cell.lon),r=Math.max(.5,Number(cell.radiusKm||6)/2),latStep=Math.max(.015,r/111),lonStep=Math.max(.015,r/(111*Math.max(.2,Math.cos(lat*Math.PI/180))));return [[-1,-1],[-1,1],[1,-1],[1,1]].map(([a,b])=>{const la=lat+a*latStep/2,lo=lon+b*lonStep/2;return{key:"adaptive:"+Grid.cellKey(la,lo,latStep),lat:Number(la.toFixed(6)),lon:Number(lo.toFixed(6)),radiusKm:Number(r.toFixed(2)),parentKey:cell.key}})}
function expand(cells=[],opts={}){return cells.filter(x=>shouldSplit(x,opts)).flatMap(children)}
module.exports={density,shouldSplit,children,expand};
