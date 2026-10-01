"use strict";
async function ensure(pool){await pool.query(`CREATE TABLE IF NOT EXISTS price_geo_discovery_cells(source_id text NOT NULL,cell_key text NOT NULL,latitude numeric NOT NULL,longitude numeric NOT NULL,radius_km numeric NOT NULL,parent_key text,status text NOT NULL DEFAULT 'pending',last_scanned_at timestamptz,last_received int NOT NULL DEFAULT 0,last_accepted int NOT NULL DEFAULT 0,scan_count int NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(source_id,cell_key));ALTER TABLE price_geo_discovery_cells ADD COLUMN IF NOT EXISTS parent_key text;CREATE INDEX IF NOT EXISTS price_geo_cells_scan_idx ON price_geo_discovery_cells(source_id,last_scanned_at,status);ALTER TABLE price_geo_discovery_cells ADD COLUMN IF NOT EXISTS cooldown_until timestamptz;`)}
async function seed(pool,source,cells=[]){await ensure(pool);let n=0;for(const x of cells){const q=await pool.query(`INSERT INTO price_geo_discovery_cells(source_id,cell_key,latitude,longitude,radius_km,parent_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[source,x.key,x.lat,x.lon,x.radiusKm,x.parentKey||null]);n+=q.rowCount||0}return n}
const MAX_SCOPE_ROOTS=2000;
function scopeKeys(scope){
 if(scope===undefined)return null;
 if(!scope||typeof scope!=="object"||Array.isArray(scope)||Object.keys(scope).some(key=>key!=="rootKeys")||!Array.isArray(scope.rootKeys)||scope.rootKeys.length>MAX_SCOPE_ROOTS)throw new Error("invalid-geo-discovery-scope");
 const keys=scope.rootKeys.slice();
 if(keys.some(key=>typeof key!=="string"||!key.length||key.length>128||key.trim()!==key)||new Set(keys).size!==keys.length)throw new Error("invalid-geo-discovery-scope");
 return keys;
}
function scopedLimit(limit,max){if(!Number.isInteger(limit)||limit<1||limit>max)throw new Error("invalid-geo-discovery-limit");return limit}
const SCOPED_CTE=`WITH RECURSIVE scoped_cells(cell_key) AS (
 SELECT cell_key FROM price_geo_discovery_cells WHERE source_id=$1 AND parent_key IS NULL AND cell_key=ANY($3::text[])
 UNION
 SELECT child.cell_key FROM price_geo_discovery_cells child JOIN scoped_cells parent ON child.parent_key=parent.cell_key WHERE child.source_id=$1 AND child.cell_key LIKE 'adaptive:%'
) `;
const COLUMNS=`cell_key AS key,latitude::float AS lat,longitude::float AS lon,radius_km::float AS "radiusKm",parent_key AS "parentKey",last_scanned_at AS "lastScannedAt",last_received AS "lastReceived",last_accepted AS "lastAccepted",scan_count AS "scanCount"`;
async function next(pool,source,limit=10,scope){
 const roots=scopeKeys(scope),n=roots===null?Math.max(1,Math.min(500,Number(limit)||10)):scopedLimit(limit,500);
 await ensure(pool);
 const sql=(roots===null?"":SCOPED_CTE)+`SELECT ${COLUMNS} FROM price_geo_discovery_cells WHERE source_id=$1 ${roots===null?"":"AND cell_key IN (SELECT cell_key FROM scoped_cells) "}AND (cooldown_until IS NULL OR cooldown_until<=now()) ORDER BY last_scanned_at ASC NULLS FIRST,scan_count ASC,cell_key ASC LIMIT $2`;
 const q=await pool.query(sql,roots===null?[source,n]:[source,n,roots]);return q.rows;
}
async function scanned(pool,source,limit=500,scope){
 const roots=scopeKeys(scope),n=roots===null?Math.max(1,Math.min(10000,Number(limit)||500)):scopedLimit(limit,10000);
 await ensure(pool);
 const sql=(roots===null?"":SCOPED_CTE)+`SELECT ${COLUMNS} FROM price_geo_discovery_cells WHERE source_id=$1 ${roots===null?"":"AND cell_key IN (SELECT cell_key FROM scoped_cells) AND (cooldown_until IS NULL OR cooldown_until<=now()) "}AND scan_count>0 ORDER BY last_received DESC,last_scanned_at DESC${roots===null?"":",cell_key ASC"} LIMIT $2`;
 const q=await pool.query(sql,roots===null?[source,n]:[source,n,roots]);return q.rows;
}
async function mark(pool,source,key,result={}){await pool.query(`UPDATE price_geo_discovery_cells SET last_scanned_at=now(),last_received=$3,last_accepted=$4,scan_count=scan_count+1,status='scanned',updated_at=now() WHERE source_id=$1 AND cell_key=$2`,[source,key,Number(result.received||0),Number(result.accepted||0)])}
module.exports={ensure,seed,next,scanned,mark};
