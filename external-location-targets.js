"use strict";
const Targets=require("./store-refresh-targets");
async function fromDatabase(pool,{limit=100}={}){if(!pool)return[];const q=await pool.query(`SELECT external_location_id AS "locationId",name,brand,postal_code AS postcode,city,country_code AS "countryCode",latitude::float AS lat,longitude::float AS lon,price_count AS "priceCount",product_count AS "productCount",proof_count AS "proofCount" FROM external_price_locations WHERE source_id='Open Prices' AND status='candidate' ORDER BY last_seen_at DESC LIMIT $1`,[Math.max(1,Math.min(5000,Number(limit)||100))]);return Targets.rank(q.rows.map(x=>({...x,locationId:String(x.locationId).replace(/^openprices:/,"")})),limit)}
module.exports={fromDatabase};
