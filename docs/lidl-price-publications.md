# Lidl dated national price announcements

The reviewed public source is Lidl's 1 October 2026 snack/drink price reduction announcement. Its native text explicitly covers all German Lidl stores, including Berlin. It contains 24 publication groups, not 24 unique products: 20 have a fixed pack and consistent price/base-price arithmetic; three offer alternative pack sizes and one has inconsistent arithmetic. These four remain quarantined with their native text.

`lidl-price-publications.js` binds the full original UTF-8 HTML, SHA-256, exact source URL, retrieval timestamp, HTTP Date/Age, native article date, national scope and matching embedded/rendered lists. Immutable captures live in `lidl_dated_publication_captures`. Reads select the latest full capture before searching. Equal-time conflicting captures yield no rows; newer held groups never reveal older usable prices.

The source is a dated publication. Re-fetching it does **not** prove today's shelf price or renew the publication date. Every row keeps `sourcePublishedDate: 2026-10-01`, `current: false`, unknown validity/expiry/deposit and no GTIN, SKU or source branch. Publication group ordinals are document positions. No rows enter canonical products, ordinary current-price counts or shopping-list winners.

The Berlin directory returns separate `datedPublications` and `datedPublicationCoverage`. Lidl `datedPublicationReferences` remain separate from current references, and cannot clear a missing-current-price marker. The app displays the published date, national scope and open current shelf-price/variant/deposit questions. A requested GTIN or incompatible channel gets no dated rows. A 9 x 330 ml sales pack does not match 2.97 l as a single pack.

The autonomous source makes one bounded public GET every 24 hours, respects persistent 403/429/Retry-After cooldowns, does not follow redirects and shares the server's persistent lease mechanism. This checks document accessibility; finding newer announcements and full assortment remains open work. No claim of full Lidl assortment or Berlin branch coverage follows from this source.

Tests cover original/hash/date/scope binding, pack arithmetic, held groups, duplicate groups, whole latest capture, query and canonical isolation, retrieval cadence/cooldown, a strict browser contract, and actual PostgreSQL/HTTP storage. CI runs PostgreSQL 18. Retailer fixtures stay under `tests/fixtures/retailers`.
