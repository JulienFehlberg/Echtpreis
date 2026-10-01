# Sparkorb: vollständige Sortimente und aktuelle Preise

Ziel der Preisengine ist der Vergleich einer vorher erstellten Einkaufsliste anhand möglichst vollständiger, aktueller Händlerbestände. **Wochenangebote ergänzen den Normalpreisbestand. Sie ersetzen ihn nicht.** Kassenbons unserer Appnutzer sind keine Voraussetzung für Erfassung, Aktualisierung oder Abfrage.

Der erste regionale Schwerpunkt ist Berlin. REWE, EDEKA und die Lebensmitteldiscounter haben Vorrang. Die Erfassung soll ohne Mitarbeiterzugänge, persönliche Kontakte oder Mithilfe aus den Märkten funktionieren: öffentlich lesbare Händlerseiten, native Shopdienste und die normale Gast-Standortwahl bilden den Zugang. Häufig gekaufte Grundprodukte erhalten zuerst hohe Aktualisierungspriorität; anschließend muss die Erfassung das gesamte belegte Sortiment des jeweiligen öffentlichen Datenzugangs durchlaufen.

Berlin ist der verbindliche erste Ausbau für die Testversion. Weitere Bundesländer folgen nach dem Berliner Piloten. Testreife wird an realen Einkaufslisten für klar benannte Berliner Märkte gemessen: aktuelle Preisbelege, genaue Verkaufspackungen, Pfand, sichtbare fehlende Positionen und korrekte Warenkorbsummen. Ein vollständiger Warenkorb-Gewinner erfordert Preise für jede Position im jeweiligen Verkaufskanal. Eine hohe deutschlandweite Produkt- oder Onlinepreiszahl bestätigt keinen Berliner Filialvergleich. Ein bis zwei Wochen sind eine bedingte Arbeitsschätzung für eine nützliche begrenzte Testversion, keine Zusage für sämtliche Preise in sämtlichen Berliner Märkten.

## Regionale Erfassung und sichtbare Berliner Lücken

Der autonome Open-Prices-Inventarscan verwendet standardmäßig den dokumentierten nativen geografischen Filter für Berlin: Mittelpunkt 52.52/13.405, Radius 35 km und OSM-Orte. Jede Rohzeile benötigt zusätzlich eine native deutsche Berliner Ortsidentität und plausible Berliner Koordinaten, bevor Produkt-/Filialidentitäten oder Preisbeobachtungen geschrieben werden. Ein Standort in Brandenburg oder ein Onlineort wird dadurch nicht als Berliner Filiale importiert. Der Sieben-Tage-Zeitraum beruht weiterhin auf dem tatsächlichen Beobachtungsdatum; erneutes Abrufen macht einen alten Preis nicht aktuell.

Inventarcursor und gespeicherte Laufmetadaten sind an Region, Datumsfenster und Standortauswahl gebunden. Ein älterer deutschlandweiter Cursor setzt den Berliner Scan nicht auf einer späteren Seite fort. Fehlgeschlagene Quellabrufe behalten ihre Wartezeit auch beim Scopewechsel. Die bisherige deutschlandweite Statistik bleibt erhalten; `berlinCoverage` und `berlinSamples` weisen die gesonderte regionale Abdeckung aus. `scan.complete` bestätigt ausschließlich die durchlaufene Pagination der angegebenen Quellenabfrage. Weder eine leere Antwort noch ein beendeter Beobachtungsscan bestätigen ein vollständiges Filialsortiment.

Die gespeicherte geografische Marktsuche wählt für das Berliner Preset nur dessen Basiszellen und tatsächlich gespeicherte adaptive Nachkommen. Alte deutschlandweite Suchzellen und Sperrzeiten bleiben erhalten. Eine gesperrte Elternzelle wird nicht zur Erzeugung neuer Ersatzanfragen verwendet. Begrenzte adaptive Auswahl wird mit `adaptiveScanTruncated` sichtbar gemacht. Die vorhandenen allgemeinen Produktabfragen und bereits gespeicherten anderen Regionen bleiben von dieser regionalen Auswahl getrennt; sie sind kein Nachweis eines fertigen Berliner Piloten.

Die Quellenprobe vom 1. Oktober 2026 fand im regionalen Sieben-Tage-Fenster keine Open-Prices-Preise. Ohne Datumsfilter wurden 2.129 historische regionale Beobachtungen gemeldet; der jüngste Preis der Probe stammt vom 23. September. Diese historischen Preise werden nicht als neue aktuelle Preise importiert. Offizielle bundesweite Lidl-Filialpreisankündigungen sind ein zusätzlicher datierter Belegweg, aber noch kein vollständiger Livekatalog. Öffentliche Scan&Go-Funktionen bestätigen Kundenpreisabfragen; deren autonome technische Erreichbarkeit und Gesamtumfang müssen erst belegt werden. Zusätzliche Lieferkataloge bestätigen weiterhin keine Regalpreisgleichheit.

## Was ein vollständiger Bestand bedeutet

Für jede Quelle werden drei Dinge getrennt gezählt: entdeckte Artikelidentitäten, Artikel mit frischem Preis und Artikel mit belegtem Preis für den tatsächlich gewählten Markt. Eine Produktdatenbank mit 6.000 Identitäten ist kein Preisbestand mit 6.000 aktuellen Filialpreisen.

Ein vollständiger Lauf braucht einen vom Händler oder Datenlieferanten belegten Gesamtumfang für einen bestimmten Markt und Verkaufskanal. Alle Seiten beziehungsweise vollständigen Snapshots müssen verarbeitet sein; Dubletten werden über native Artikelkennungen entfernt. Ein einzelner Suchbegriff, eine Produktkategorie oder die Sitemap einer öffentlichen Website beweist kein vollständiges Filialsortiment. Fehlende, nicht bepreiste und nicht auflösbare Artikel bleiben in der Abdeckung sichtbar.

Die Gesamtmenge darf nicht auf die ersten 100, 250, 2.000 oder 5.000 Artikel abgeschnitten werden. Begrenzungen gelten für einzelne Abrufläufe. Persistierte Cursor und faire Warteschlangen setzen danach fort. Quellfehler verlängern weder Frische noch Vollständigkeit.

Die 6.000 priorisierten Grundartikel sind ein Startbestand, keine Obergrenze des Händlerkatalogs. Dieselbe belegte GTIN/Packung bei mehreren Händlern ist eine Produktidentität mit mehreren Preisangeboten; andere Varianten und Packungsgrößen bleiben getrennt. Native Artikel ohne belegte GTIN bleiben über Händler und native Artikel-ID identifizierbar. Sie werden nicht durch ähnlich klingende Namen zu einem gemeinsamen Produkt zusammengelegt.

## Fortsetzung und Aktualität

Ein bestätigter, noch unvollständiger Wolt- oder REWE-Sortimentslauf setzt nach einer Minute fort. Jeder einzelne Abruflauf behält seine Anfragegrenzen und Pausen bei. Nach der letzten nativen Seite gilt wieder das normale Aktualisierungsintervall von 15 Minuten. Fehlende oder widersprüchliche Cursor sowie Läufe ohne bestätigten Fortschritt werden nicht als erfolgreiche Fortsetzung gespeichert.

Der nächste Abrufzeitpunkt wird in PostgreSQL gespeichert. Nach einem Neustart wird ein gültiger, unvollständiger Cursor wieder aufgenommen; Sperrfristen der Quelle bleiben erhalten. Ein wegen einer Sperrfrist oder eines bereits laufenden Abrufs übersprungener Lauf verändert weder den letzten erfolgreichen Abruf noch dessen Artikelzahlen. Die angezeigte Frische beruht auf einem tatsächlich erfolgreichen Quellenabruf.

## Anforderungen an den öffentlichen Händler-/Shopbestand

| Bereich | Benötigte Angaben |
| --- | --- |
| Quelle und Rechte | Anbieter, erlaubter Appvergleich, Datenformat, Änderungs-/Abrufgrenzen |
| Markt | stabile native Markt-ID, Händler, Adresse, PLZ, Stadt, Land |
| Verkaufskanal | Filiale, Abholung oder Lieferung; belegte Geltung des Preises |
| Artikel | native Artikel-ID, GTIN sofern vorhanden, Name, Marke, genaue Variante |
| Verkaufspackung | Inhalt, Einheit und Multipack-Anzahl; lose Ware gesondert |
| Normalpreis | aktueller Bruttopreis der Verkaufspackung, EUR, Pfand getrennt |
| Aktionen | Aktionspreis und native Gültigkeit; Normalpreis separat erhalten |
| Bedingungen | App, Kundenkarte, Coupon, Mindestmenge und persönliche Preise getrennt |
| Aktualität | echte Erhebungs-/Publikationszeit, Gültigkeit, Änderungsversion |
| Sortiment | native Gesamtzahl, vollständige Pagination/Snapshot-Marke, entfernte Artikel |
| Verfügbarkeit | tatsächlich gemeldeter Marktbestand; fehlende Angaben bleiben unbekannt |
| Nachweis | exakte Quelladresse, Abrufzeit und Antwort-Hash |

Eine native Artikel-ID kann einen Händlerartikel identifizieren. Eine DOM-ID, ein Foto oder ein ähnlich klingender Name beweist keine GTIN. Mehrsortige Angebote bleiben mehrsortig. Abhol- und Lieferpreise werden erst bei belegter Gleichheit als Filialpreise verwendet. Pfand sowie Liefer-/Servicegebühren gehören bei einem zahlbaren Gesamtkorb gesondert dazu.

Ziel für den vollständigen Normalpreisbestand ist eine Aktualisierung mindestens täglich. Häufig nachgefragte Artikel sollen, soweit die Quelle dies erlaubt, häufiger aktualisiert werden. Die tatsächliche Frische bleibt pro Datensatz sichtbar. Die vorhandenen veröffentlichten Onlinepreise verfallen nach 24 Stunden; unbekannte oder veraltete Preise werden nicht durch Richtwerte zu einem günstigen Gesamtkorb ergänzt.

## Verifizierter Quellenstand am 1. Oktober 2026

- **dm:** aktueller autonomer Preisabruf für validierte GTIN/Packungen ist produktiv. Die Quelle gilt für den deutschen Onlineshop. Die Suchentdeckung ist noch unvollständig; der laufende Teilbestand belegt weder ein vollständiges dm-Sortiment noch bestätigte Filialpreise.
- **REWE Berlin:** die normale Gast-Auswahl bestätigt den Abholmarkt REWE Steven Horn oHG, Hallesches Ufer 40, Marktkennung `8321066`, Kanal `PICKUP`. Die vom offiziellen Shopbundle benannten nativen Produkt-/Filterdienste sind anonym lesbar. Der Collector durchläuft alle 20 belegten Hauptkategorien und ihre echten Folgeseiten, statt die auf 10.000 begrenzte breite Suche als Gesamtbestand zu übernehmen. Einzelne Abrufe sind auf 16 Anfragen begrenzt; ein dauerhafter Cursor setzt nach einer Minute fort. Abholpreise werden mit vollständiger Listing-ID, GTIN sofern belegt, Packung, separat angegebenem Pfand und Quellenbeleg in einem eigenen Ledger gespeichert. Quellenfehler verlängern die Frische nicht; native Aktionsfristen verkürzen sie. Ein geschrumpfter Kategorieumfang startet nach Sperrfrist einen neuen Scan. Verfügbarkeit und Filialpreisgleichheit bleiben ohne Nachweis unbekannt. Die vollständige Erfassung ist erst nach der letzten bestätigten Kategorie belegt.
- **EDEKA:** die native Berliner Marktseite Britzer Damm bietet datierte Wochenangebote. Der vorbereitete, getestete Client liest nur die regionalen Anzeigen und trennt Aktionspreise, Apppreise und Pfand. Diese Anzeigen belegen keinen vollständigen Normalpreisbestand. Die geprüfte offizielle edeka.shop-Marktsuche liefert für Berlin und 10117 keinen verfügbaren Shop.
- **Wolt / EDEKA Hilbrecht, Berlin:** der öffentliche Kundenshop liefert ohne Login einen nativen Kategoriebaum mit 263 Blattkategorien und Artikel-/Preisantworten mit echter Pagination. Der neue Collector liest alle Kategorien in fortsetzbaren Läufen; Milch, Butter, Eier, Brot, Nudeln, Reis und weitere Grundartikel zuerst. Preise werden in einem eigenen Onlinebestand gespeichert und über die zentrale Preis-API durchsucht. Vollständigkeit gilt erst nach der letzten bestätigten Seite. Variable Gewichte, ungeklärte Varianten und fehlerhafte Artikel bleiben abgelehnt. GTIN wird nur übernommen, wenn sie nativ vorhanden und gültig ist. Der native Preis enthält angegebenes Pfand; Warenpreis und Pfand werden getrennt. Liefer-/Servicegebühren und Filialpreisgleichheit sind nicht belegt. Eine Normalpreis-/Aktionsklassifikation wird nicht aus einem aktuellen Preis geraten.
- **ALDI Nord:** die autonome Erfassung der offiziellen Produkt-Sitemap und nativen Detailpreise ist veröffentlicht. Ganze Kataloge werden in begrenzten Läufen ohne globale Artikelkappung durchlaufen; Standardartikel kommen zuerst. Echte `hasError:true`-Antworten bleiben gespeicherte Lücken mit eigener Frist, während andere Seiten weiter verarbeitet werden. Ein separater Aktualisierungscursor erneuert erfolgreiche Artikel auch bei permanenten Lücken am Ende des ersten Durchlaufs. Quellensperren und ursprüngliche Preisgültigkeit bleiben erhalten. Native Händler-SKU, feste Packung und HTTP-/Preisdatumsbelege sind Pflicht; fehlende GTIN und konkrete Filiale bleiben unbekannt. Aktuelle Preiszahlen und Scanfortschritte stehen im [öffentlichen Status](https://echtpreis-api.onrender.com/v1/published-prices/status); frühere fehlgeschlagene Detailproben werden nicht als neue Preise importiert.
- **Open Prices:** zusätzliche reale Produkt-/Marktbelege bleiben als solche erhalten. Sie sind kein vollständiger Händler-Normalpreisfeed.

Priorität hat der tatsächlich lesbare Berliner Vollsortiment-Shop und dessen native Produkt-/Preisdienste. Mitarbeiterzugänge und Kontaktanfragen werden nicht vorausgesetzt. Der vorbereitete Angebotsclient wird nicht als Ersatz für den vollständigen Normalpreisbestand ausgerollt.

Ein ständig laufender Collector braucht außerdem einen verlässlich aktiven Ausführungsort. Der aktuelle kostenlose Render-Webdienst kann bei Inaktivität schlafen; seine Prozess-Timer gewährleisten dann keine tägliche Gesamterfassung. Kostenpflichtige Infrastruktur oder Datenverträge werden erst nach einem konkreten Kosten- und Quellenangebot freigegeben.

Primärquellen: [REWE Abholservice](https://www.rewe.de/service/abholservice/), [REWE Sortiment](https://www.rewe.de/shop/c/kaese-eier-molkerei/), [EDEKA Hilbrecht](https://www.edeka.de/maerkte/800401/), [Öffentlicher Wolt-Shop](https://wolt.com/de/deu/berlin/venue/edeka-hilbrecht), [EDEKA Britzer Damm](https://www.edeka.de/maerkte/409896/), [EDEKA Shops](https://edeka.shop/), [ALDI-Nord-Produktkatalog](https://www.aldi-nord.de/sitemaps/.aldi-nord-sitemap-products.xml), [Render Free](https://render.com/docs/free).
