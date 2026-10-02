# Price-source scheduling status

GET /v1/admin/price-sources/status keeps the stored nextAttemptAt and fetch-success freshness fields and adds schedulerEligibility. A stored native retry deadline can already have passed while the runner still waits for exponential failure backoff or a live database lease. This read-only view uses the existing pure wake-plan inspection and actual configured handler map.

eligibleAt is the latest of the stored source deadline (or normal cadence), capped runner failure backoff and a live lease. blockedBy distinguishes source-deadline, failure-backoff, lease-held, no-handler, inactive and invalid state. handlerConfigured is null for callers that omit the handler map; the actual HTTP route supplies its current map. Even a lease held by this worker blocks another database acquire until release or expiry.

The result describes eligibility under persisted runner state. It does not guarantee the next timer, an exact start time, native-handler readiness, collector success, product-price freshness, available stock or assortment completeness. A source may have further native checks and a current batch may delay starting an eligible handler. Invalid timestamps, incomplete lease ownership or malformed failure counters never produce confirmed eligibility.

Example: the native retry time is 01:56 UTC, the last failed attempt is 00:56 UTC and capped runner backoff ends at 06:56 UTC. The original nextAttemptAt remains 01:56; schedulerEligibility.eligibleAt is 06:56, with failure-backoff while that time remains in the future. A longer actual Retry-After or later live lease takes precedence. No stored pause, state, request budget, price capture, expiry, quarantine or scheduler decision changes.

The isolated test program checks real persisted Date objects, native and capped failure deadlines, lease overlap/expiry, invalid records, configured and absent handlers, source inactivity, unchanged freshness/redaction and the actual HTTP route over a stubbed persisted state. It performs no retailer request or database write.
