"use strict";
const key=(row={})=>[String(row.productCode||""),String(row.locationId??"*")].join("@");
const compare=(a,b)=>a<b?-1:a>b?1:0;
const number=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const priority=row=>number(row.priority);
function select(rows=[],checkpoint={},limit=250,hotShare=.25){
 const unique=new Map();
 for(const row of Array.isArray(rows)?rows:[]){if(!row||!row.productCode)continue;const id=key(row),old=unique.get(id);if(!old||priority(row)>priority(old))unique.set(id,row)}
 const ordered=[...unique.values()].sort((a,b)=>priority(b)-priority(a)||compare(key(a),key(b))),n=Math.min(ordered.length,Math.max(1,Math.floor(number(limit,250)||250)));
 if(!ordered.length)return{selected:[],next:{...checkpoint,cursorKey:null,cursorOffset:0,lastQueueSize:0}};
 const hotN=Math.floor(n*Math.max(0,Math.min(.8,number(hotShare,.25)))),hot=ordered.slice(0,hotN),hotKeys=new Set(hot.map(key));
 const rest=ordered.filter(row=>!hotKeys.has(key(row))).sort((a,b)=>compare(key(a),key(b))),room=n-hot.length;
 // A persisted key survives priority changes, hot-list changes, inserts and removals; an array offset does not.
 const previous=typeof checkpoint.cursorKey==="string"?checkpoint.cursorKey:null;
 let start=previous?rest.findIndex(row=>compare(key(row),previous)>0):0;if(start<0)start=0;
 const rotated=[];for(let index=0;index<Math.min(room,rest.length);index++)rotated.push(rest[(start+index)%rest.length]);
 const cursorKey=rotated.length?key(rotated[rotated.length-1]):previous,wrapped=previous&&rotated.length&&compare(cursorKey,previous)<=0?1:0,selected=[...hot,...rotated];
 return{selected,next:{cursorKey,cursorOffset:rest.length?(start+rotated.length)%rest.length:0,cycle:Math.max(0,number(checkpoint.cycle))+wrapped,lastQueueSize:ordered.length,processedTotal:Math.max(0,number(checkpoint.processedTotal))+selected.length}};
}
module.exports={key,select};
