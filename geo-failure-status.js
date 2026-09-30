"use strict";
async function view(pool,source="Open Prices",limit=100){const q=await pool.query(`SELECT cell_key AS key,latitude::float AS lat,longitude::float AS lon,radius_km::float AS "radiusKm",consecutive_failures AS "consecutiveFailures",total_failures AS "totalFailures",last_error AS "lastError",cooldown_until AS "cooldownUntil" FROM price_geo_discovery_cells WHERE source_id=$1 AND (consecutive_failures>0 OR cooldown_until>now()) ORDER BY consecutive_failures DESC,updated_at DESC LIMIT $2`,[source,Math.max(1,Math.min(1000,Number(limit)||100))]);return q.rows}
module.exports={view};
