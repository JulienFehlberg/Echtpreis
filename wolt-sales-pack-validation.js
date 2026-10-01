"use strict";

// An explicit title multipack may contradict native quantity, but never supplies it.
const TITLE_MULTIPACK_PATTERN=String.raw`(?:^|[^0-9A-Za-zÀ-ÿ.,])([1-9][0-9]*)\s*[x×]\s*([0-9]+(?:[.,][0-9]+)?)\s*(pieces|piece|pcs|stück|stuck|stk|kg|ml|cl|g|l)(?![A-Za-zÀ-ÿ])`;
const UNITS=Object.freeze({pieces:{unit:"piece",scale:1},piece:{unit:"piece",scale:1},pcs:{unit:"piece",scale:1},"stück":{unit:"piece",scale:1},stuck:{unit:"piece",scale:1},stk:{unit:"piece",scale:1},kg:{unit:"g",scale:1000},ml:{unit:"ml",scale:1},cl:{unit:"ml",scale:10},g:{unit:"g",scale:1},l:{unit:"ml",scale:1000}});
const TOLERANCE=.001;
function multipackConflict(name,baseAmount,baseUnit,count=1){
 if(typeof name!=="string")return false;
 const matches=[...name.normalize("NFKC").matchAll(new RegExp(TITLE_MULTIPACK_PATTERN,"gi"))];if(!matches.length)return false;
 const nativeTotal=baseAmount*count;
 if(typeof baseAmount!=="number"||!Number.isFinite(baseAmount)||baseAmount<=0||!Number.isSafeInteger(count)||count<1||!Number.isFinite(nativeTotal)||!["g","ml","piece"].includes(baseUnit))return true;
 return matches.some(match=>{const factor=UNITS[match[3].toLowerCase()],titleTotal=Number(match[1])*Number(match[2].replace(",","."))*factor.scale,scale=Math.max(1,titleTotal,nativeTotal);return!Number.isFinite(titleTotal)||factor.unit!==baseUnit||Math.abs(titleTotal-nativeTotal)>scale*TOLERANCE+scale*Number.EPSILON*8;});
}
const unitCase="CASE lower(parts[3]) "+Object.entries(UNITS).map(([unit,value])=>"WHEN '"+unit+"' THEN '"+value.unit+"'").join(" ")+" END";
const scaleCase="CASE lower(parts[3]) "+Object.entries(UNITS).map(([unit,value])=>"WHEN '"+unit+"' THEN "+value.scale).join(" ")+" END";
const titleTotal="(parts[1]::numeric*replace(parts[2],',','.')::numeric*("+scaleCase+"))",nativeTotal="(pack_amount*pack_count)";
// PostgreSQL 18 predicate for the same explicit title/native quantity comparison.
// These unqualified column names refer to the outer published-price record.
const SQL_CONFLICT="EXISTS(SELECT 1 FROM regexp_matches(normalize(name,NFKC),'"+TITLE_MULTIPACK_PATTERN+"','gi') AS explicit_multipack(parts) WHERE ("+unitCase+")<>pack_unit OR abs("+titleTotal+"-"+nativeTotal+")>greatest(1,"+titleTotal+","+nativeTotal+")*0.001)";
module.exports={multipackConflict,SQL_CONFLICT,TITLE_MULTIPACK_PATTERN};
