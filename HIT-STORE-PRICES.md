# Berliner HIT-Filialpreise

Die offizielle HIT-Sortiments-FAQ bindet die angezeigten Preise ausdrücklich an den ausgewählten Markt. Anders als unsere Wolt- und REWE-Abholquellen kann diese Quelle deshalb konkrete Filialpreise belegen. Ein Bon, Kundenkonto oder Mitarbeiterzugang ist für die normale Gastansicht nicht erforderlich.

Primärquellen:
- https://www.hit.de/faq/sortiment
- https://www.hit.de/maerkte/berlin-mitte

Zunächst ist ausschließlich Berlin-Mitte zugelassen: Anton-Wilhelm-Amo-Str. 69, 10117 Berlin; native `storeId=1775`, `storeNumber=258`. Die Produktmarke REWE BIO auf einer HIT-Karte ist keine REWE-Filiale.

Der Collector folgt nur der auf der offiziellen Marktseite tatsächlich angebotenen Gast-Marktauswahl und den öffentlichen HTML-Seiten des Sortiments. Gastcookies bleiben im Arbeitsspeicher und werden ausschließlich nach ihrem Host/Pfad und Ablauf benutzt. Der nicht freigegebene `/api/v2/assortment/article`-Zugang wird nicht verwendet. Die erste native API-Probe wurde am 01.10.2026 um 18:51:16.522 UTC mit 403 abgewiesen; alle HIT-Abrufe pausieren bis mindestens 19:51:16.522 UTC.

Pro Lauf gelten höchstens 16 Requests, mindestens eine Sekunde Abstand, begrenzte Antwortgrößen und feste erlaubte URLs. 403/429 stoppen den Lauf und führen zu mindestens einer Stunde Pause; ein längeres `Retry-After` wird eingehalten. Cursor und Sperrzeit überstehen Neustarts. Die Quellenpause wird nicht durch neue Header, Proxywechsel oder einen anderen Standort umgangen.

Jeder Preis benötigt eine native Haupt-GTIN mit gültiger Prüfziffer, SKU, genaue Verkaufspackung, feste native Filialidentität und einen eindeutigen Normalpreis in Cent. Nur normale Preisschilder und ausdrücklich dauerhafte Discountpreise werden übernommen. Bilddateinamen, zusätzliche EAN-Aliasse, Apppreise, Streichpreise und uneindeutige Varianten ersetzen keinen Produktbeleg. Die Warenverfügbarkeit bleibt eine gesonderte Aussage.

Die Datenbank erhält die originalen Antwortzeitpunkte, HTTP-Date/Cache-Age, Antwort- und Beleg-Hashes sowie die native Produktkarte. `inventoryUpdatedAt` und `highlightUntil` sind keine Preiszeitpunkte. Mit der vorhandenen DATE-Gültigkeit ist jeder importierte Preis nur am tatsächlichen Berliner Erfassungstag aktiv. Ein späterer Abruf verlängert ausschließlich seinen eigenen neuen Beleg. Ältere Belege bleiben historisch erhalten und werden für die aktuelle Preisentscheidung ersetzt.

HIT-Warenpreise schließen Pfand aus. Ein fehlender nativer Pfandbetrag bleibt `null`. API-Entscheidungen führen Warenpreis, Pfand und `payablePackPrice` getrennt; unbekanntes Pfand verhindert einen Kassenpreis-Sieger und einen zahlbaren Warenkorbvergleich. Der Waren-Grundpreis bleibt sichtbar. Eine feste Packung wird nie aus einer anderen Packung oder einer ähnlichen Produktbezeichnung abgeleitet.

Nach validierten Seiten werden zuerst die Belege in einer Transaktion gespeichert und erst danach der Cursor fortgesetzt. Eine Datenbankstörung verwirft die gesamte Preis-Transaktion. Wiederholte SKUs oder geänderte native Seitenzahlen verhindern eine behauptete Vollständigkeit. Widersprüchliche Preise derselben GTIN/Packung werden für diese Quelle und Filiale gesperrt; ihre Beleggeschichte bleibt erhalten.

`GET /v1/hit-prices/status` unterscheidet native Scanfortschritte, aktuelle kanonische Produkte, historische Captures und unbekanntes Pfand. Ein vollständig durchlaufenes öffentliches Sortimentsverzeichnis ist kein Nachweis eines lückenlosen physischen Ladenbestands. Die offizielle FAQ nennt mögliche Preis-/Bestandsabweichungen. Die automatische Aktualisierung läuft im bestehenden Webservice; Schlafzeiten des kostenlosen Render-Tarifs begrenzen die tatsächliche Abrufkadenz.

Validierung: Parser, Gast-Collector, Import, Wiederaufnahme und Preisentscheidung besitzen Offline-Tests. Der PostgreSQL-18-Lauf prüft echte DDL, Produkt-/Filialzuordnung, Packkonflikte, Idempotenz, Preisänderungen, Ablauf, parallele Imports, Bonunabhängigkeit und Datenbank-Rollback. Native HTML-Pagination und produktive Preiszahlen werden zusätzlich live geprüft; diese Dokumentation behauptet dafür keine Zahl ohne aktuellen Beleg.
