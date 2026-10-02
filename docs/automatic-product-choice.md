# Automatic shopping suggestions

Typing a product adds it immediately. The app searches in the background and
proposes a concrete, currently evidenced product without requiring the shopper
to choose a barcode, pack or variant first. Later edits remain optional.

`CaddyAutomaticProductChoice.choose({wish, items, now})` validates the original
GTIN and exact native sales pack, then matches each source's own product title.
The chosen identity contains no price or invented canonical product ID. Prices
remain dated source evidence and are fetched again for comparisons.

An unspecified property is a permitted default suggestion. Explicit amounts,
brands and supported properties constrain the suggestion; a missing property,
unavailable/expired quote or unsupported negative request leaves the price open.
Milk excludes other product families; Nutella means the spread bearing that
brand, excluding biscuits, B-ready, ice cream and snack sticks.

Rank by goods price per litre/kilogram/piece inside one channel. Prefer available
physical-store evidence, then pickup, then clearly labelled delivery evidence.
Never compare unlike denominators or imply that delivery is a store price.
Unknown deposits and additional fees remain open. Only the six priority German
retailers with evidenced Berlin scope qualify. Dated CMS publications lacking a
concrete native identity are not automatic identity selections.

Automatic searches remain bounded to 20 identities / 200 source offers and
use a strict `priorityRetailersOnly: true` filter. Today
the eligible native sources for those retailers are EDEKA delivery and REWE
pickup; unrelated HIT proof scans, dm, nahkauf and unidentified ALDI publication
rows are skipped. The optional broad product picker retains its original scope.

Because searches remain bounded, the UI
says “günstigste gefundene Option”; it does not claim complete market coverage
or the cheapest price in every Berlin store. Request tokens are per list object,
so adding other articles does not cancel previous searches. Removing, editing
or manually selecting an article prevents a late response from overwriting it.

The archived Berlin API fixture is deterministic regression evidence. Its
captured prices do not prove present freshness or physical store availability.
