# Current German price coverage

The product catalog and price evidence are separate inventories. A German product GTIN with a known package does not prove that a retailer sells it or establish its price. Missing exact product/store evidence returns an unknown price.

## Complete research rotation

Automatic Open Prices research reads the entire canonical GTIN catalog without the previous 2,000-candidate and 250-target cuts. Eligible observations and assortment demand are aggregated before joining products; unsupported historical data cannot reset current-price freshness.

Each successful scheduling attempt selects at most 20 targets. One quarter prioritizes demand and staple products. The rest rotates in stable GTIN/location order using a persisted cursor key, even when priorities change or products enter the catalog. Product/store gap expansion remains bounded to 25 products and 250 gaps per scheduling pass. The default source cadence is 15 minutes; retries and existing failure backoff still apply. Around 6,500 targets require roughly 4.5 days at 15 rotating slots per pass, assuming uninterrupted upstream availability. A completed research pass is not proof of a current price.

Targeted queries request EUR prices from the previous seven days through today. The original response is revalidated for the requested GTIN, location, Germany, date and price/proof semantics before canonical writes. The same inventory importer used by bootstrap binds existing package identities and real retail OpenStreetMap stores. Newly attached source proofs remain observed until independently reviewed. Empty price results are valid research results.

## Date provenance repair

The two legacy `L480/rewe-price-data` CSVs have no observation-date column or exact store identity. Their latest file changes were published on 2024-04-12; publication does not establish when a price was collected. The old refresh assigned its fetch date to those rows. These exports are disabled for current research. The adapter now requires an explicit source observation date and validates every feed before writing any of them.

On startup, a narrow, idempotent transaction moves only the known legacy import pattern into `price_import_quarantine`. It requires the exact source, both legacy URLs, matching original import batch, historical/corroboration flags, unreviewed synthetic `rewe:<index>` proof, matching UTC fetch/observation day, and fetch time before 2026-09-30T17:00:00Z. Every original column, ID and original batch reference is preserved as JSON. A failed backup rolls back all changes. No guessed historical date is assigned; genuine receipt evidence and explicitly dated later imports are preserved.

## Honest coverage status

`GET /v1/price-coverage` reports current evidence for an exact GTIN/product and active German store with a known package, EUR, an attached proof and a valid observation window. It reports product and staple-family coverage, proof-reviewed observations separately, research attempt counters, and the preserved legacy rows. Coverage in one store does not establish national price coverage or eligibility for conditional offers. Fetch-success timestamps describe connector health and do not date the source's prices.

PostgreSQL 18 integration checks cover an existing real OFF catalog product acquiring a newly discovered store price, unsupported/future/foreign/incorrectly scoped evidence, complete catalog targeting and transactional preservation of legacy rows.

## Berlin pilot benchmark

`POST /v1/current-price-benchmark` defaults to Berlin and accepts up to 40 product positions and 20 merchants. A position can be a legacy diagnostic name or an exact descriptor containing `product`, `gtin`/`productId`, `brand`, `pack` and `quantity`. Common `storeId`/`storeIds`, `region`, `today`, `maxAgeDays` and eligibility flags use the same validation and physical price query as `/v1/current-prices`. No source requests, price imports or refresh targets are triggered by this measurement. Oversized or malformed inputs are rejected instead of silently truncating the denominator.

Only recent eligible physical store evidence for the exact identity and sales pack covers a benchmark cell. Category/comparison-only references, stale or future evidence, unsupported sources, unproven conditional prices and online/pickup/delivery alternatives remain gaps. Returned store UUIDs are bound in one final read to active canonical stores and merchants, country DE and the actual selected city/region. A price row's Berlin label cannot cover a foreign or different-city store. Different variants with the same name keep distinct position keys and denominators. Source-attached proofs are counted as observed; they are not promoted to reviewed/verified evidence. `supportedCells` separately counts eligible quotes supported by the engine's source/consensus rules. `verifiedCells` additionally requires explicit verified product identity and proof flags; two unreviewed Open-Prices observations alone do not satisfy this benchmark review metric.

The shared physical resolver also enforces the requested or canonically resolved pack in exact GTIN mode. A GTIN query for 450 g rejects 500 g, 2 x 225 g and 2 x 450 g observations, while 450 g and 0.45 kg remain equivalent. A consumer GTIN on a retailer bundle does not establish the price of its individual unit. PostgreSQL 18 checks that source-shaped exact store evidence covers one cell while a conflicting pack stays missing.

The result preserves the cell denominator, missing positions and coverage per product and merchant. `coverageBasis` is `exact-product-pack-store-evidence`. This measures goods-price evidence; `payableBasketVerified` remains false because physical price evidence alone does not establish deposits, availability or the payable total for an entire basket. A default diagnostic run with names is not a proof of a ready Berlin shopping-list comparison.
