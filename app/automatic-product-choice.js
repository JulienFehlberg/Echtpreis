(function(root){
"use strict";
const node=typeof module==="object"&&module.exports;
const Products=node?require("./published-product-client"):root.SparkorbPublishedProductClient;
const Matcher=node?require("../shopping-need-matcher"):root.SparkorbShoppingNeedMatcher;
const families={milch:"milk",brot:"bread",eier:"eggs",butter:"butter"};
const retailers=new Set(["ALDI","PENNY","REWE","Lidl","Kaufland","EDEKA"]);
const channels=["physical-store","pickup","online"];
const text=v=>typeof v==="string"?v.trim():"";
const norm=v=>text(v).normalize("NFKC").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ß/g,"ss");
const words=v=>norm(v).match(/[a-z0-9]+/g)||[];
const nonfood=/\b(?:\w*(?:shampoo|seife|lotion|duschgel|waschmittel|reinigungsmilch)|spielzeug|kerze|dekoration)\b/;
const rules={
 kekse:{positive:/\b(?:[a-z]*keks(?:e|en)?|cookies?|biscuits?)\b/,negative:/\b(?:aufstrich|creme|kuchen|torte|eis|backmischung|proteindrink|joghurt|pudding)\b/},
 nutella:{positive:/\bnutella\b/,negative:/\b(?:biscuits?|cookies?|[a-z]*keks(?:e|en)?|b[ -]?ready|waffel\w*|geback|croissant\w*|kuchen|eis|ice cream|go|brot[ -]?sticks?|muffin\w*|donut\w*|rieg(?:el|eln)|mit nutella)\b/},
 cashewkerne:{positive:/\b(?:cashewkerne?|cashews?)\b/,negative:/\b(?:[a-z]*(?:milch|drink|creme|mus|butter)|nussmix|nussmischung|schokolade|honig|mandeln|walnusse)\b/},
 mandeln:{positive:/\bmandeln?\b/,negative:/\b(?:[a-z]*(?:milch|drink|creme|mus|butter)|nussmix|nussmischung|schokoliert\w*|honig|cashews?|walnusse)\b/},
 erdnuesse:{positive:/\b(?:erdnusse?|erdnusskerne?)\b/,negative:/\b(?:[a-z]*(?:milch|drink|creme|mus|butter)|nussmix|nussmischung|schokoliert\w*|honig|cashews?|walnusse)\b/},
 studentenfutter:{positive:/\bstudentenfutter\b/,negative:/\b(?:[a-z]*(?:milch|drink|creme|mus|butter)|schokolade|honig)\b/}
};
function withoutAmount(raw){return norm(raw).replace(/\d+(?:[.,]\d+)?\s*%/g," ").replace(/\d+(?:[.,]\d+)?\s*(?:kg|gramm|g|liter|ml|cl|l|stuck|stueck|stk)\b/g," ").replace(/^\s*\d+\s*(?:x|packungen?|packs?|stuck|stueck|stk)?\s*/,"").replace(/\b(?:packungen?|packs?|a|je|zu|egal)\b/g," ").trim();}
function prepared(wish){
 if(!wish||typeof wish!=="object"||wish.ean||wish.selectedProduct)return null;
 const raw=text(wish.raw);let key=text(wish.key);if(raw.length<2||raw.length>120)return null;
 if(!key){const term=withoutAmount(raw);key=/\bnutella\b/.test(term)?"nutella":/\b(?:kekse?|cookies?|biscuits?)\b/.test(term)?"kekse":/\bmilch\b/.test(term)?"milch":"";}
 let need=null;const family=families[key];
 if(family){try{need=Matcher?.parse({search:raw,constraints:{family}});if(!need)return null;}catch(_){return null;}}
 const rule=rules[key];let residual=withoutAmount(raw);
 if(family){
  const labels={milk:/\b(?:h[ -]?)?(?:(?:voll|frisch|weide|roh|ziegen|schafs|heu|mager)?milch)\b/g,bread:/\b(?:[a-z]*brot|pumpernickel)\b/g,eggs:/\b(?:bio|freiland|huhner|bodenhaltungs|oster)?eier\b|\bei\b/g,butter:/\bbutter\b/g};
  residual=residual.replace(labels[family]," ");
  // Only supported, parsed claims can be removed from literal matching.
  if(need.constraints.processing)residual=residual.replace(/\b(?:frische?[rnse]*|haltbare?[rnse]*|uht|ultrahocherhitzte?[rnse]*)\b/g," ");
  if(need.constraints.lactose)residual=residual.replace(/\b(?:laktosefrei\w*|lactosefrei\w*|laktosehaltig\w*|lactosehaltig\w*|ohne laktose|ohne lactose|mit laktose|mit lactose)\b/g," ");
  if(need.constraints.flavour)residual=residual.replace(/\b(?:natur|naturell|unaromatisiert\w*|ohne aroma|ohne aromen)\b/g," ");
  if(need.constraints.salt)residual=residual.replace(/\b(?:ungesalzen\w*|gesalzen\w*|salzfrei\w*|ohne salz|mit salz|meersalz)\b/g," ");
  if(need.constraints.grain)residual=residual.replace(/\b(?:vollkorn\w*|roggen\w*|weizen\w*)\b/g," ");
  if(need.constraints.sliced!==undefined)residual=residual.replace(/\b(?:ungeschnitten\w*|geschnitten\w*|in scheiben)\b/g," ");
  if(need.constraints.husbandry)residual=residual.replace(/\b(?:bio|freiland\w*|bodenhaltung)\b/g," ");
  if(need.constraints.size)residual=residual.replace(/\b(?:grosse|grossen|size|klasse|gewichtsklasse|xl|s|m|l)\b/g," ");
  if(need.constraints.raw!==undefined)residual=residual.replace(/\b(?:roh\w*|ungekocht\w*|gekocht\w*|hart)\b/g," ");
 }else if(rule){residual=residual.replace(key==="kekse"?/\b(?:kekse?|cookies?|biscuits?)\b/:rule.positive," ");}
 const required=words(residual);
 // Negations and unsupported ranges are never silently weakened.
 if(required.some(w=>["ohne","nicht","kein","keine","frei","oder","bis"].includes(w)))return null;
 const explicit=wish.explicitAmount;
 if(explicit!=null&&(!explicit||!["g","ml","piece"].includes(explicit.unit)||!Number.isFinite(explicit.amount)||explicit.amount<=0||!Number.isSafeInteger(explicit.packCount)||explicit.packCount<1))return null;
 return{raw,key,need,rule,required,explicit};
}
function matches(request,offer){
 const name=norm(offer.name);if(!name||nonfood.test(name))return false;
 if(request.need){try{if(Matcher.classify(request.need,{name:offer.name}).status!=="confirmed")return false;}catch(_){return false;}}
 else if(request.rule){if(!request.rule.positive.test(name)||request.rule.negative.test(name))return false;}
 // Outside the supported families, require literal native title tokens; no
 // fuzzy category, ingredient, invented property or brand substitution.
 const titleWords=new Set(words(name));
 if(!request.need&&!request.rule&&/\b(?:mit|aus|fur|geschmack|aroma)\b/.test(name))return false;
 return request.required.length>0||request.need||request.rule?request.required.every(w=>titleWords.has(w)):false;
}
function choose({wish,items,now=Date.now()}={}){
 const request=prepared(wish);if(!request||!Products||!Array.isArray(items)||items.length>20||!Number.isFinite(now))return null;
 const expectedUnit=request.explicit?.unit||({milch:"ml",butter:"g",eier:"piece",kekse:"g",nutella:"g",cashewkerne:"g",mandeln:"g",erdnuesse:"g",studentenfutter:"g"})[request.key];
 const choices=[],seen=new Set(),duplicates=new Set();
 for(const raw of items){
  const item=Products.candidate(raw,{now});if(!item)continue;
  const identity=Products.selection(item),id=Products.key(identity);if(seen.has(id))duplicates.add(id);seen.add(id);
  if(expectedUnit&&identity.packUnit!==expectedUnit)continue;
  if(request.explicit&&(identity.packUnit!==request.explicit.unit||identity.packCount!==request.explicit.packCount||Math.abs(identity.packAmount-request.explicit.amount)>1e-9))continue;
  for(const offer of[...item.offers,...item.physicalOffers]){
   if(!retailers.has(offer.merchant)||!channels.includes(offer.scopeChannel)||offer.scopeCountry!=="DE"||offer.shop?.city!=="Berlin"&&offer.branch?.city!=="Berlin"||offer.availability==="unavailable"||["loyalty","app","coupon","multi_buy","personalized"].some(type=>type===offer.priceType||type===offer.promotionStatus)||offer.conditional===true||!matches(request,offer))continue;
   const total=identity.packAmount*identity.packCount,unit=identity.packUnit==="g"?"kg":identity.packUnit==="ml"?"l":"piece",factor=unit==="piece"?1:1000,unitPrice=offer.price*factor/total;
   if(!Number.isFinite(unitPrice)||unitPrice<=0)continue;
   const selection=Products.selection({...identity,name:offer.name,brand:offer.brand});if(!selection)continue;
   choices.push({selection,offer,unitPrice,unit,scopeChannel:offer.scopeChannel,reason:"cheapest-found-unit-price",id});
  }
 }
 const valid=choices.filter(c=>!duplicates.has(c.id));
 // A delivery quote never competes with an in-store/collection quote. Use
 // the first evidenced channel and explicitly retain its source in the UI.
 const channel=channels.find(c=>valid.some(v=>v.scopeChannel===c));if(!channel)return null;
 const channelChoices=valid.filter(c=>c.scopeChannel===channel),units=new Set(channelChoices.map(c=>c.unit));
 // A loaf and a weighed pack have no comparable denominator. Prefer a
 // measured bread pack if present; otherwise keep incompatible units open.
 const denominator=request.key==="brot"&&units.has("kg")?"kg":units.size===1?[...units][0]:null;if(!denominator)return null;
 const ranked=channelChoices.filter(c=>c.unit===denominator).sort((a,b)=>a.unitPrice-b.unitPrice||a.offer.price-b.offer.price||b.offer.capturedAt.localeCompare(a.offer.capturedAt)||a.id.localeCompare(b.id));
 const best=ranked[0];delete best.id;return{...best,channelAlternatives:channels.filter(c=>c!==channel&&valid.some(v=>v.scopeChannel===c))};
}
const api=Object.freeze({choose});if(root)root.CaddyAutomaticProductChoice=api;if(node)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
