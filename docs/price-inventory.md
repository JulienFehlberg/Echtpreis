# Deutscher Preisbestand: Betrieb und Datenvertrag

`price-inventory-service.js` baut den kanonischen Produkt-, Filial- und Beobachtungsbestand aus der öffentlichen Open-Prices-API auf. Der Dienst liest die Quelle selbst; der Refresh-Endpunkt akzeptiert keine hochgeladenen Preise oder Identitätsbehauptungen.

## Quelle und Attribution

- Preise: [Open Prices / Open Food Facts](https://prices.openfoodfacts.org/), API `https://prices.openfoodfacts.org/api/v1/prices`.
- Produktdaten: Open Food Facts, über die eingebetteten `product`-Felder der Preisantwort.
- Filialdaten: OpenStreetMap, über die eingebetteten `location`-Felder; jede kanonische Filiale behält `osm:{node|way|relation}:{id}`.
- Datenlizenz: ODbL; die Quelle nennt die Anforderungen in ihrer [Datendokumentation](https://openfoodfacts.github.io/open-prices/guides/data/). Die Attribution für Standorte lautet „OpenStreetMap contributors“, mit Link zu [Copyright und Lizenz](https://www.openstreetmap.org/copyright). Datenweitergaben müssen diese Quellen und die [ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/) erhalten. Die Lizenz der Daten ist von einer etwaigen Softwarelizenz zu unterscheiden.

Der Import speichert Quell-URL, Abrufzeit, Importbatch, Belegreferenz und vorhandenen Belegbild-Hash. Die Produktidentität erhält `product_identity_evidence`; Filialverknüpfungen bleiben in `external_store_mappings` und `canonical_store_sources` nachvollziehbar. Der Dienst lädt keine Belegbilder herunter.

## Automatischer Aufbau

Beim Backendstart beginnt ein Scan. Die bestehende Hintergrundschleife prüft jede Minute, ob ein neuer Lauf fällig ist. Ein vollständig beendeter Scan wird standardmäßig nach einer Stunde wiederholt; ein unvollständiger Scan kann nach einer Minute mit seinem gespeicherten Cursor fortsetzen.

Ein Lauf liest höchstens 20 Seiten mit jeweils 100 Einträgen. Die API-Abfrage begrenzt das Beobachtungsdatum auf heute minus sieben Tage bis einschließlich heute, verlangt EUR und schließt gekennzeichnete Quellduplikate aus. `today` wird im Backend für `Europe/Berlin` bestimmt. Da der Preisendpunkt keinen Länderfilter anbietet, werden die zurückgegebenen Datensätze zusätzlich anhand ihrer Standortdaten auf Deutschland geprüft. Ein kompletter Scan bedeutet das Ende dieses API-Fensters, keine vollständige Abdeckung deutscher Supermärkte.

Eine Datenbanklease verhindert gleichzeitige Inventarläufe. Pro Identität sichern Transaktionen, Savepoints und Advisory Locks den kanonischen Aufbau. Wiederholungen verwenden vorhandene Identitäten und Preisbelege. Konflikte überschreiben keine bestehenden Mappings; sie erscheinen mit Gründen im Laufbericht und im Quarantänebestand.

Konfiguration:

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PRICE_INVENTORY_ENABLED` | aktiviert | `false` deaktiviert den automatischen Inventarlauf. |
| `PRICE_INVENTORY_MAX_PAGES` | `20` | Seitenbudget je Lauf, auf 1–20 begrenzt. |
| `PRICE_INVENTORY_INTERVAL_MS` | `3600000` | Abstand zwischen vollständig beendeten Scans. |
| `SPARKORB_INVENTORY_TOKEN` | keiner | Bearer-Token ausschließlich für den Inventar-Refresh. |
| `SPARKORB_ADMIN_TOKEN` | keiner | Übergeordneter administrativer Bearer-Token. |

## Identitäten und Preisbedeutung

Produkte brauchen eine unverändert gültige GTIN, einen bekannten Namen und eine bekannte Packungsgröße. Explizite strukturierte Mengenfelder können eine fehlende Mengenangabe ersetzen. Ganzzahlige Dezimal-Multipacks wie `2.0 x 175 g` werden zu zwei Packungseinheiten normalisiert; unbekannte oder widersprüchliche Größen bleiben zur Prüfung offen.

Filialen brauchen einen echten OSM-Einzelhandelseintrag, eine stabile OSM-ID, plausible Deutschlandkoordinaten und einen eindeutig bekannten Händler. Verwaltungsregionen, Onlineorte und mehrdeutige Bezeichnungen wie generisches „ALDI“ werden nicht zu bestätigten Filialidentitäten. Verwertbare Teilidentitäten können in den Katalog gelangen; Preisimport verlangt sowohl Produkt- als auch Filial-ID.

Bestätigte GTIN- und OSM-Zuordnung bestätigen die Identität. Importierte Preiszeilen bleiben `observed`; der Import setzt keine Belegprüfung auf `true`. Die zentrale Engine entscheidet über Nutzbarkeit und etwaige Bestätigung durch unabhängige Evidenz, inklusive Belegduplikaten und Preiswidersprüchen. Treue-, App-, Coupon- und Mengenpreise behalten ihre Bedingungen. Ein Beleglink allein belegt keinen öffentlich verfügbaren regulären Preis.

Katalogprodukte und Filialen bleiben nach Ablauf des Preisfensters erhalten. Ältere Beobachtungen bleiben Historie; sie werden durch ihren Verbleib in der Datenbank nicht wieder zu aktuellen Preisen. Die Bestandszahlen sind daher getrennt von aktuellen Beobachtungen und tatsächlich vergleichbaren Preisentscheidungen auszuwerten.

## Endpunkte und Kontrolle

| Endpunkt | Zugriff | Ergebnis |
| --- | --- | --- |
| `GET /v1/price-inventory` | öffentlich | Bestandszahlen, letzter Lauf, Cursor, Ausschlussgründe, Beispielbeobachtungen und Attribution. |
| `POST /v1/admin/price-inventory/refresh` | Bearer-Token | Startet einen begrenzten serverseitigen Scan; Body `{}` oder `{"maxPages":20}`. |
| `GET /health/price-engine` | öffentlich | Datenbankbereitschaft und Preisengine-Coverage. |
| `POST /v1/price-query` | öffentlich | Kanonische Produkt- und Filialauswahl. |
| `POST /v1/current-prices` | öffentlich | Zentrale Preisentscheidung für die ausgewählten Identitäten und Bedingungen. |

Ein vorhandener Lauf wird bei Parallelaufruf nicht doppelt gestartet. Teilscans und Quellenfehler müssen im Laufstatus sichtbar bleiben. `price_inventory_runs` hält Fenster, Cursor, Ergebnis, Fehler und Zeitpunkte fest; `price_import_batches` und `price_import_quarantine` erklären die Speicherung und Ablehnung einzelner Zeilen. Tokens gehören ausschließlich in die Backendumgebung und nie in Browserkonfiguration, Berichte oder Logs.

Der Bestand folgt der tatsächlichen Community-Abdeckung. Fehlende Produkte, unbekannte Packungen, unklare Filialen und fehlende aktuelle Belege bleiben erkennbare Lücken; bundesweite Vollsortimente oder bestätigte POS-Preise entstehen daraus nicht automatisch.
