# Autonomous retailer prices

Sparkorb's external price collection runs without app-user receipts. Receipts supplement evidence; they are not required to start, refresh or query the retailer price inventory.

The first direct retailer connector reads dm's official German product services. The public search listing discovers retailer product IDs and GTINs. Listing prices are never imported: the listing can be cached for four days. Current offers are fetched from the official product tile service with a short cache lifetime; online purchase availability is read separately. Responses retain exact retailer SKU, GTIN, package, EUR price, source product URL, capture time and payload hash. A past price-change date is not substituted for the current offer capture.

These are published German **online** offers. They do not establish the price or stock of any physical dm branch, or the final delivered basket cost. Prices are saved in a separate published-offer inventory and expire after 24 hours. Source failure preserves existing evidence without extending its freshness. Out-of-stock and unknown availability are explicit.

Automatic discovery covers food staples and common household purchases and resumes across bounded runs. Discovered product targets persist in PostgreSQL. A checksum-validated seed contains 150 real retailer identities for cold starts when search is throttled; it contains no bundled prices or availability. Every price is fetched from the current official price service. Every run refreshes at most 100 product targets in stable order, with separate source leases, success/failure timestamps and backoff. No user request or receipt submission is needed. The default discovery budget is eight requests per run, and current-price/availability bulk collection uses at most two requests per run. A partial discovery rate-limit response is persisted and delays further discovery for an hour; already discovered products can still receive current offers. Retries also consume request budgets.

`GET /v1/published-prices` queries current offers using `merchant`, `gtin` or `search`; `GET /v1/published-prices/status` reports this autonomous inventory separately from physical-store evidence. `/v1/price-coverage` remains the exact physical product/store evidence audit. An online offer never silently supplies a missing local branch price.

Validation includes recorded official response shapes, source/date/package/currency/hash gates, request budgets, persistent rotation, pure source-driven ingestion with zero new receipts, online-scope SQL reads, expiry and source-failure behavior.

## REWE Berlin pickup

REWE's public guest shop serves the selected pickup market **REWE Steven Horn oHG, Hallesches Ufer 40, 10963 Berlin**, native market `8321066`, store `7ae33841-fa98-3b7e-9ee5-8132f39c189c`. The official shop bundle documents `/shop/api/filters` and `/shop/api/products`. The connector uses their native versioned Accept headers, public market/channel parameters and anonymous GETs; it does not require employee access, login or transferred browser cookies.

The broad search has a 10,000-result ceiling. The collector instead enumerates every native root category, prioritizes everyday groceries, and reads all its verified 40-item pages. A changing price/count does not invalidate the stable category-identity hash. Persisted checkpoints continue after one minute until the last category; a completed cycle returns to the 15-minute cadence. Each run allows at most 16 requests by default, one second apart, with strict response-byte and time limits. A verified category shrink that invalidates a saved page restarts the scan after backoff. Early empty pages, missing pages and unconfirmed progress fail without claiming completion. Source 403/429 errors are respected and do not extend price freshness.

`rewe_retailer_published_prices` retains exact native listing IDs, optional validated GTIN, fixed sales packs, merchant/market/shop, source URL, capture time and raw response hash. Pack contradictions, variable weights, unresolved variants and conditional prices are rejected. The published REWE price excludes separately reported deposit. Missing deposit and unreported availability remain unknown. A known promotion deadline caps expiry even when the normal/discount classification is unconfirmed. Quotes expire within 24 hours and cannot update physical-store observations.

The central published-price search and exact-product alternatives combine dm, Wolt/EDEKA and REWE without changing each quote's channel: `online` or `pickup`. Combined metadata lists `scopeChannels` and reports `mixed` when both are present. Distinct GTIN coverage is computed by a real SQL union across all three ledgers; multiple retailer quotes do not inflate the product count. Full published assortment completion and physical-store assortment verification remain separate.

## Wolt venue proof and price freshness

The official public app fetches venue identity from `https://consumer-api.wolt.com/order-xp/web/v1/pages/venue/slug/edeka-hilbrecht/static`. The collector uses this documented anonymous JSON response to verify the exact Berliner venue, address, coordinates and active assortment. It no longer depends on a hydrated HTML query-cache timestamp as if that were a price publication time. Venue, assortment and every product page require a real HTTP Date within 15 minutes; a reported Age above 15 minutes, malformed/future timestamps and stale price pages still fail before persistence.

The previous local `wolt-native-venue-stale-or-future` metadata error may resume the saved cursor once through the new native proof. Genuine 403/429 denials and actual response-freshness failures retain their cooldowns. Success and quote freshness change only after a real successful fetch and database write.

PostgreSQL 18 integration checks exercise real source constraints, idempotent/newer-only batch writes, expiry, pickup scope, overlapping GTIN counts and preservation of canonical products, stores and receipts. The current free Render service can sleep, so its process timer cannot guarantee continuous collection.
