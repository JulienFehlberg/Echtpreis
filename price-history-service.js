"use strict";
const Temporal=require("./temporal-price-intelligence");
function scopeKey({productId,storeId,region}){return[productId||"unknown",storeId||"*",region||"*"].join("|")}
async function rebuild(pool,{productId,storeId=null,region=null,windowDays=90,today=new Date().toISOString().slice(0,10)}){
 const params=[productId,windowDays,today],where=["product_id=$1","observed_at >= $3::date - ($2::int * interval '1 day')"];
 if(storeId){params.push(storeId);where.push("store_id=$"+params.length)}if(region){params.push(region);where.push("region=$"+params.length)}
 const q=await pool.query('SELECT id,price::float,price_type AS "priceType",observed_at::date::text AS date,store_id AS "storeId",region FROM product_price_facts WHERE '+where.join(" AND ")+" ORDER BY observed_at",params);
 const base=Temporal.baseline(q.rows,{today,storeId,region,windowDays});
 await pool.query("INSERT INTO price_history_snapshots(product_id,store_id,region,window_days,sample_count,median_price,low_price,high_price,q25_price,q75_price,volatility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[productId,storeId,region,windowDays,base.samples,base.median,base.low,base.high,base.q25,base.q75,base.volatility]);
 return{scope:scopeKey({productId,storeId,region}),baseline:base,rows:q.rows};
}
module.exports={scopeKey,rebuild};
