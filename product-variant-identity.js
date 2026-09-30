"use strict";
const I=require("./product-identity");
const VARIANT_WORDS=["zero","light","classic","original","vanille","vanilla","zitrone","lemon","kirsche","cherry","erdbeere","strawberry","bio","vegan","laktosefrei","glutenfrei","mild","scharf"];
function gtin(x){const s=String(x||"").replace(/\D/g,"");return I.gtinValid(s)?s:null}
function pack(x={}){return I.parsePack(x.pack||x.packageSize||x.name||x.product||x.rawName||"")}
function variant(x={}){const t=new Set(I.tokens([x.name||x.product||x.rawName,x.variant,x.flavor].filter(Boolean).join(" ")));return VARIANT_WORDS.filter(v=>t.has(v)).sort()}
function signature(x={}){const g=gtin(x.gtin||x.ean);if(g)return"gtin:"+g;const p=pack(x),v=variant(x);return["attr",I.norm(x.brand),I.norm(x.name||x.product||x.rawName),p?.total?.amount||"",p?.total?.unit||"",v.join("+")].join(":")}
function compatibility(a={},b={}){const ga=gtin(a.gtin||a.ean),gb=gtin(b.gtin||b.ean);if(ga&&gb)return ga===gb?{ok:true,level:"exact",reason:"same-gtin"}:{ok:false,level:"reject",reason:"different-gtin"};const pa=pack(a),pb=pack(b);if(pa&&pb&&I.packScore(pa,pb)<.85)return{ok:false,level:"reject",reason:"pack-mismatch"};const va=variant(a),vb=variant(b);if(va.length&&vb.length&&va.join("|")!==vb.join("|"))return{ok:false,level:"reject",reason:"variant-mismatch"};const m=I.match(a,b);return{ok:m.level!=="reject",level:m.level,reason:m.reason,score:m.score}}
module.exports={VARIANT_WORDS,gtin,pack,variant,signature,compatibility};
