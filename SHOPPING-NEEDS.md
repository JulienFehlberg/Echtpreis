# Einkaufsbedarf mit belegten Produkteigenschaften

`POST /v1/shopping-need` findet konkrete aktuelle Produkte für einen ausdrücklich beschriebenen Bedarf. Die erste Fassung unterstützt die Familien `milk`, `bread` und `eggs`. Alle Ergebnisse brauchen weiterhin eine bewusste Auswahl der genauen GTIN und Verkaufspackung. Die Engine wählt auch bei einem einzelnen Treffer kein Produkt automatisch.

```json
{
  "search": "H-Milch 1,5%",
  "constraints": {"family": "milk", "processing": "uht", "fatPercent": 1.5},
  "pack": "1 l",
  "scopeChannel": "physical-store",
  "limit": 20
}
```

Die Anfrage ist eine Leseabfrage des vorhandenen aktuellen Bestands. Sie startet keine Händlerabfrage, legt keinen Preis an und benötigt keinen Nutzerbon. Zusätzliche erlaubte Felder sind `merchant`, `pack`, `scopeChannel` und `limit` (1–20). Unbekannte Felder, Zeitüberschreibungen und ein Refresh-Auftrag werden abgewiesen. `scopeChannel` unterstützt `physical-store`, `online` und `pickup`; Verkaufskanäle und Filialen bleiben getrennt. Ohne Kanalfilter können mehrere Kanäle ausgewiesen werden.

Unter `constraints` ist `family` erforderlich. Weitere ausdrückliche Angaben sind:

| Familie | Optional belegbare Anforderungen |
| --- | --- |
| `milk` | `processing`: `uht` oder `fresh`; `fatPercent`: Zahl von 0 bis 10; `lactose`: `free` oder `contains`; `flavour`: `plain` |
| `bread` | `grain`: `wholegrain`, `rye` oder `wheat`; `sliced`: Boolean |
| `eggs` | `size`: `S`, `M`, `L` oder `XL`; `husbandry`: `barn`, `free-range` oder `organic`; `raw`: Boolean |

Eindeutige Eigenschaften im Suchtext werden ebenfalls berücksichtigt. Widersprüche zwischen Suchtext und Anforderungen sowie nicht darstellbare Kombinationen werden abgewiesen. Ein bloßes „Milch“, „Brot“ oder „Eier“ setzt weder Fettgehalt, Haltbarkeit, Scheiben, Eiergröße, Haltungsform noch eine Packung voraus. Die derzeitige Familiengrenze unterscheidet Trinkmilch von Milchreis, Buttermilch und Milchdrinks, Brot von Toast und Backmischungen sowie Hühnereier von Schokoladen-/Nudelprodukten. Weitere Familien und differenziertere Anforderungen sind noch offen.

Die erste Fassung erkennt ausdrücklich „Milch frisch“, „Frische Weidemilch“ und „Gewichtsklasse M“. Nicht unterstützte Verarbeitung wie ESL oder bloßes „pasteurisiert“, qualitative Fettwünsche wie „fettarm“ oder „Vollmilch“ sowie Prozentbereiche werden als Suchanforderung abgewiesen. Für eine genaue Fettanforderung ist eine konkrete Zahl mit dem allgemeinen Suchwort „Milch“ erforderlich; aus Fettadjektiven wird kein Prozentwert abgeleitet. Negationen bleiben negativ. Ein Vollkornmehl-Anteil in der Zutatenliste bestätigt kein Vollkornbrot. Eine native Beschreibung, die sich ausdrücklich als Haferdrink oder Milchmischgetränk bezeichnet, widerspricht der Trinkmilchfamilie; Rezeptvorschläge und Zutatenverweise ersetzen die Produktidentität nicht. Diese konservativen Regeln sind kein allgemeines Sprachverständnis für beliebige Wünsche.

Jedes Quellenangebot wird zuerst durch die vorhandenen Herkunfts-, GTIN-, Verkaufs­packungs-, Länder-, Filial-, Capture-, Ablauf- und Quarantäneprüfungen zugelassen. Danach bewertet die Bedarfsschicht die nativen Produkttexte. Bei HIT stammt der Name aus der erneut geprüften Originalkarte; bei den freigegebenen Wolt-/REWE-Quellen können ihre gespeicherten nativen Beschreibungen ergänzt werden. Kanonische Gruppennamen und Markenwissen ersetzen keine Quellenangabe.

`needAssessment` führt die Bewertung für jede tatsächlich ausgegebene Preisquelle getrennt:

- `confirmed`: die angefragten semantischen Eigenschaften sind im nativen Text belegt.
- `unconfirmed`: mindestens eine verlangte Angabe fehlt oder die Variante bleibt offen; `missing` benennt diese Angaben.
- `contradicted`: der native Text widerspricht dem Bedarf. Dieses Angebot wird aus der Bedarfsauswahl ausgeschlossen.

`confirmed` bezeichnet ausschließlich die hier angefragten Texteigenschaften. Es bestätigt keine manuelle Belegprüfung, Regalverfügbarkeit oder einen zahlbaren Endbetrag. Warenpreis, Pfand, Liefergebühren, Originalbelege und Zeitpunkte bleiben unverändert. Unbekanntes Pfand bleibt offen. Angebote unterschiedlicher GTINs werden nicht zu Preiszellen desselben Produkts zusammengelegt.

Die semantische Prüfung erfolgt vor dem endgültigen Ergebnislimit; belegte Eigenschaften werden vor offenen Varianten angezeigt. Die bestehende Quellensuche bleibt auf jeweils 200 Kandidaten begrenzt, die Antwort auf 20 Produktidentitäten und insgesamt 200 Preisbelege. `discoveryTruncated` weist Begrenzungen aus. `needCoverage.complete` bleibt `false`: fehlende Treffer belegen keine Abwesenheit und eine Kandidatenliste bestätigt kein vollständiges Sortiment oder einen günstigsten Gesamtwarenkorb.

Die allgemeine Produktsuche und bereits ausgewählte genaue GTIN-/Packungsabfragen behalten ihre bestehende Funktion. Diese zusätzliche Bedarfsschicht ist für die nächste Anbindung der Einkaufslisten vorbereitet; die App-Oberfläche verwendet sie noch nicht automatisch.

Offline-Tests prüfen fehlende und widersprüchliche Varianten, negierte Eigenschaften, native Beschreibungstexte, Produktauswahl, Grenzen und unveränderte Quellenevidenz. Die bestehende PostgreSQL-18-Integration prüft die Bedarfssuche und den echten HTTP-Endpunkt an realen Datenbank-Joins mit ausdrücklich lokalen Testbelegen; sie ruft keine Händler auf.
