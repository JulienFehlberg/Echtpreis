# Deutscher Alltagskatalog

Der Katalog erweitert die kanonischen Produktidentitäten unabhängig vom Import aktueller Preisbelege. Grundlage ist ein reproduzierbarer Ausschnitt des offiziellen [Open-Food-Facts-CSV-Exports](https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz). Der Snapshot enthält echte Quellprodukte, keine generierten Namen, EANs oder Preise.

## Auswahl und Herkunft

Jedes Produkt braucht eine gültige, unveränderte GTIN, einen lesbaren Namen, eine bekannte Packungsgröße und das Quell-Marktmerkmal `en:germany`. Dieses Merkmal bedeutet, dass die Quelle das Produkt dem deutschen Markt zuordnet; es beweist keine heutige Verfügbarkeit in einer konkreten Filiale. Bestehende kanonische Packungsgrößen und Identitätszuordnungen werden bei Konflikten nicht überschrieben.

`german-basket-priorities.js` ordnet Produkte konservativ den Familien täglicher Einkäufe zu, beispielsweise Milch, Brot, Eier, Butter, Nudeln, Reis, Mehl, Kaffee und Wasser. Die Auswahl berücksichtigt knappe Familien zuerst und füllt nicht mit unklassifizierten Produkten auf. Die Quell-Popularität bestimmt lediglich die Reihenfolge innerhalb des Katalogs; sie ist kein Nachweis bundesweiter Kaufhäufigkeit. Der Manifestbericht nennt die tatsächlich besetzten Familien und ihre Zahlen.

Der Snapshot und sein Manifest liegen unter `data/de-product-catalog.*`. Das Manifest enthält Quell-URL, ETag, Exportdatum, Auswahlregeln, Zeilen- und Bytebudgets, Familienzahlen und SHA256-Prüfsummen sowohl des JSON-Inhalts als auch der komprimierten Bytes. Der Laufzeitimport prüft diese Angaben erneut. Produktidentitäten behalten ihren eigenen Link auf `https://world.openfoodfacts.org/product/{GTIN}`. Datenquelle: **Open Food Facts**, Datenlizenz: [ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/). Diese Attribution und Lizenz müssen bei Weitergabe des Katalogs erhalten bleiben.

## Import und Preisrecherche

Beim Start importiert der Server den kleinen geprüften Snapshot in Bulk-Transaktionen. Render lädt dafür nicht den gesamten Export herunter. Eine Datenbanklease verhindert konkurrierende Katalogläufe, und wiederholte Imports erzeugen keine doppelten Produkte oder Identitätsbelege. `PRODUCT_CATALOG_ENABLED=false` deaktiviert den Katalogimport; `PRODUCT_CATALOG_TARGET` beträgt standardmäßig 6000 und wird auf 5000 bis 10000 begrenzt.

`GET /v1/product-catalog` zeigt Gesamtbestand, tatsächlich importierte Alltagsprodukte, Familien, letzten Lauf und Herkunft. `GET /v1/products?search=Milch` sucht kanonische Identitäten; `family=eggs` grenzt die Produktfamilie ein. `limit` ist auf 100 begrenzt. Die vorhandene kanonische Preisabfrage nutzt denselben Produktbestand. Die automatische Preisrecherche priorisiert Alltagsprodukte und deren fehlende oder alte Preise.

Ein Katalogimport schreibt **keine Filialen oder Preisbeobachtungen**. `purpose=identity` und `truthEligible=false` bleiben im Importbericht erhalten. Die Anzahl aktueller und tatsächlich nutzbarer Preise muss weiterhin über `/health/price-engine`, `/v1/price-inventory` und die zentrale Preisentscheidung bewertet werden. 6000 identifizierte Produkte bedeuten nicht 6000 aktuelle Filialpreise.

## Snapshot erneuern

Auf einer Entwicklungsmaschine mit Node 20 oder neuer:

```powershell
node scripts/build-german-catalog.js --target 6400 --budget-mib 700 --max-duration-ms 450000 --max-segments 5 --work-dir ../catalog-build
```

Mit `--resume-file ../catalog-build/catalog-progress.json` lässt sich ein Lauf gegen denselben Export fortsetzen. Ein geändertes ETag verwirft den Cursor. Der gzip-Export wird beim Fortsetzen von vorne gelesen; Byte- und Zeitbudgets umfassen diesen Replay-Aufwand. Wenn der Cursor nicht vorankommt, muss das ausdrücklich begrenzte Budget erhöht werden. Ein Snapshot mit 6400 gültigen Artikeln lässt einen Puffer für die Laufzeitauswahl von 6000. Der Builder erzeugt anschließend Snapshot und Manifest erneut. Erst Prüfungen und PostgreSQL-Integration erlauben die Veröffentlichung des aktualisierten Bestands.
