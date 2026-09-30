"use strict";
function date(value){
 const parsed=value instanceof Date?value:new Date(value);
 if(!Number.isFinite(parsed.getTime()))return null;
 const day=parsed.toISOString().slice(0,10);
 if(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}/.test(value)&&value.slice(0,10)!==day&&(!value.includes("T")||!/[+-]\d\d:\d\d$/.test(value)))return null;
 return{date:day,observedAt:parsed.toISOString()};
}
module.exports={date};
