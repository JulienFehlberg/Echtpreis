"use strict";
const crypto=require("crypto");
function sameToken(actual,expected){
 if(typeof actual!=="string"||typeof expected!=="string"||!expected.trim()||actual.length>1024)return false;
 const a=crypto.createHash("sha256").update(actual).digest(),b=crypto.createHash("sha256").update(expected).digest();
 return crypto.timingSafeEqual(a,b);
}
function protectedRoute(req={}){return req.method==="POST"&&(/^\/v1\/admin(?:\/|$)/.test(String(req.url||"").split("?")[0])||req.url==="/v1/price-missions/verify")}
function authorized(req={},env=process.env){
 const header=req.headers?.authorization||"",match=typeof header==="string"&&header.match(/^Bearer (\S+)$/);
 if(match&&sameToken(match[1],env.SPARKORB_ADMIN_TOKEN||env["ECHT"+"PREIS_ADMIN_TOKEN"]))return true;
 if(req.url==="/v1/admin/price-inventory/refresh"&&match&&sameToken(match[1],env.SPARKORB_INVENTORY_TOKEN||env["ECHT"+"PREIS_INVENTORY_TOKEN"]))return true;
 return req.url==="/v1/admin/open-prices/import"&&sameToken(req.headers?.["x-price-import-token"],env.PRICE_IMPORT_TOKEN);
}
module.exports={sameToken,protectedRoute,authorized};
