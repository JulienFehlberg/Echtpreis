"use strict";
const Net=require("./resilient-fetch"),Identity=require("./product-identity");
const BASE="https://world.openfoodfacts.org/api/v2/product/";
async function product(gtin,{fetchImpl=fetch,timeoutMs=10000}={}){const code=String(gtin||"").replace(/\D/g,"");if(!Identity.gtinValid(code))throw new Error("invalid-gtin");const r=await Net.request(BASE+encodeURIComponent(code)+".json",{}, {fetchImpl,timeoutMs,retries:2,baseDelayMs:500});if(!r.ok)throw new Error("open-food-facts-http-"+r.status);const j=await r.json();if(!j.product)return null;const p=j.product;return{gtin:code,name:p.product_name_de||p.product_name||null,brand:p.brands||null,pack:p.quantity||null,categories:p.categories_tags||[],imageUrl:p.image_front_url||null,source:"Open Food Facts"}}
module.exports={BASE,product};
