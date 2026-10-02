# Berlin grocery collection priority

Caddy prioritizes PENNY, EDEKA, Lidl, ALDI, Kaufland and REWE in Berlin.
The goal is each retailer's accessible full assortment and current prices,
including normal prices. Offers alone do not meet that goal.

The first rollout measures retailer-product coverage in Berlin. One evidenced
Berlin source market per exact product and retailer is sufficient for a city
reference; full per-branch coverage is not a prerequisite. The app names the
source market and original sales channel next to the price. A single quote is
the last observed reference, not a calculated Berlin average. Next come other
German states, followed by more specific individual-store coverage.
See [Berliner Händlerreferenzen](berlin-reference-prices.md) for the API and
the exact identity, source, deposit and original-capture boundaries.

`grocery-collection-focus.js` allows the automatic retailer collectors for
REWE Berlin pickup, Wolt EDEKA Berlin, ALDI Nord published assortment,
PENNY Berlin regional price publications and Lidl dated national announcements.
These are the implemented priority connectors, not proof of complete store
coverage. PENNY, Lidl and Kaufland still need viable full-assortment price
connectors. The policy must be extended when a reviewed connector is added.
Lidl's dated publication groups remain separate from current-price coverage;
checking document accessibility daily never renews their published price date.

HIT, dm and Wolt nahkauf automatic collection is paused. Source registration,
existing facts, checkpoints, leases and refusal deadlines are retained;
pausing does not grant freshness or change price authority. The source wake
planner also receives the filtered handlers so a paused retailer cannot wake
its collector. Existing stored prices remain subject to their usual expiry.

Open Prices, its location discovery and Open Food Facts remain shared support
for regional observations, store identities and product identities. Regional
Open Prices scans can contain other retailers; they are not a new dedicated
retailer expansion and do not imply assortment completeness.

Delivery, pickup, published assortment and physical-store prices keep their
original scope. In particular, one EDEKA delivery venue or one REWE pickup
store does not establish prices at every Berlin branch. Published ALDI
products do not establish live shelf availability. Unknown GTIN, deposits,
sales packs and dates remain unknown rather than inferred.

`GET /v1/admin/price-sources/status` exposes the collection focus alongside
actual source state. `coverageComplete` remains false until accessible
assortment and current retailer-product price coverage can be demonstrated.
Unknown assortment denominators prevent a claimed completion percentage. A registered
handler alone never counts as full coverage.
