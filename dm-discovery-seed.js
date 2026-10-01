"use strict";
const fs=require("fs"),path=require("path"),crypto=require("crypto"),Identity=require("./product-identity"),Client=require("./dm-price-client");
const HASH="5cfc1b998165638c26618ca50172e77096e12d924d17bb85b42621fb504076d1";
function validate(seed){
 if(seed?.version!==1||seed.sourceId!=="dm online"||seed.purpose!=="discovery"||seed.truthEligible!==false||!Array.isArray(seed.targets)||seed.targets.length!==150)throw Error("dm-seed-discovery-only-required");
 const seen=new Set();for(const target of seed.targets){
  if(Object.keys(target).some(key=>/price|offer|availability|currency|pack|capturedAt|expiresAt/i.test(key)))throw Error("dm-seed-price-fields-forbidden");
  if(!/^[1-9]\d{0,9}$/.test(target.retailerSku)||!Identity.gtinValid(target.gtin)||typeof target.name!=="string"||!target.name.trim()||seen.has(target.retailerSku))throw Error("dm-seed-identity-invalid");seen.add(target.retailerSku);
  const url=new URL(target.sourceUrl);if(url.origin!=="https://www.dm.de"||!url.pathname.startsWith("/p/d/"+target.retailerSku+"/")||url.search||url.hash||url.username||url.password)throw Error("dm-seed-retailer-url-invalid");
  if(target.origin?.source!=="dm online"||!Client.allowedApiUrl(target.origin.sourceUrl).startsWith(Client.SEARCH_ORIGIN+"/de/search/"))throw Error("dm-seed-discovery-provenance-invalid");
 }
 const hash=crypto.createHash("sha256").update(JSON.stringify(seed.targets)).digest("hex");if(hash!==HASH||hash!==seed.targetsSha256)throw Error("dm-seed-identity-checksum-mismatch");
 return seed.targets;
}
function read(){return validate(JSON.parse(fs.readFileSync(path.join(__dirname,"data","dm-discovery-seed.json"),"utf8")))}
module.exports={HASH,validate,read};
