# Einkaufsbedarf mit belegten Produkteigenschaften

`POST /v1/shopping-need` findet konkrete aktuelle Produkte für einen ausdrücklich beschriebenen Bedarf. Unterstützt werden die Familien `milk`, `bread`, `eggs` und `butter`. Alle Ergebnisse brauchen weiterhin eine bewusste Auswahl der genauen GTIN und Verkaufspackung. Die Engine wählt auch bei einem einzelnen Treffer kein Produkt automatisch.

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
| `butter` | `salt`: `unsalted` oder `salted` |

Eindeutige Eigenschaften im Suchtext werden ebenfalls berücksichtigt. Widersprüche zwischen Suchtext und Anforderungen sowie nicht darstellbare Kombinationen werden abgewiesen. Ein bloßes „Milch“, „Brot“, „Eier“ oder „Butter“ setzt weder Fettgehalt, Haltbarkeit, Scheiben, Eiergröße, Haltungsform, Salz noch eine Packung voraus. Die derzeitige Familiengrenze unterscheidet Trinkmilch von Milchreis, Buttermilch und Milchdrinks, Brot von Toast und Backmischungen sowie Hühnereier von Schokoladen-/Nudelprodukten. Weitere Familien und differenziertere Anforderungen sind noch offen.

Butter berücksichtigt wörtliche native Namen wie Butter, Weidebutter, Rahmbutter und Markenbutter. Ausdrücklich benannte Butter-Rapsöl-Mischungen, Streichfett, Margarine, Pflanzen-/Nussbutter, Schmalz, Ghee, Kräuter-/Knoblauch-/aromatisierte Butter, Buttertoast und andere Fertiggerichte gehören nicht zur gewöhnlichen Butterauswahl. „Streichzart“, eine Marke oder ein Fettanteil beweisen keine Zutatenzusammensetzung. Die Bestätigung der Butterfamilie bestätigt daher keine reine Zusammensetzung. Anforderungen wie „Butter pur“, „82 % Fett“, „salzarm“, „laktosefrei“ oder „ohne Zusätze“ werden abgewiesen, solange diese Eigenschaften nicht unterstützt werden.

Gesalzen und ungesalzen brauchen einen ausdrücklichen nativen Beleg. Eine fehlende Salzangabe bleibt `unconfirmed`, wenn Salz angefragt wurde. „Ohne Meersalz“ belegt nicht „ungesalzen“. Negationen und widersprüchliche Angaben bleiben erhalten. Rezept- und Servierhinweise wie „Ideal zu Brot mit Meersalz“ bestätigen keinen Salzgehalt der Butter. Eine ausdrücklich einleitende Selbstbeschreibung wie „Die Butter ist gesalzen“ kann den Salzgehalt belegen; eine Zutaten- oder Rezeptliste ersetzt diese Produktangabe nicht. Die exakte Verkaufspackung bleibt zusätzlich erforderlich: 250 g und 2 × 125 g werden nicht ausgetauscht.

Die erste Fassung erkennt ausdrücklich „Milch frisch“, „Frische Weidemilch“ und „Gewichtsklasse M“. Nicht unterstützte Verarbeitung wie ESL oder bloßes „pasteurisiert“, qualitative Fettwünsche wie „fettarm“ oder „Vollmilch“ sowie Prozentbereiche werden als Suchanforderung abgewiesen. Für eine genaue Fettanforderung ist eine konkrete Zahl mit dem allgemeinen Suchwort „Milch“ erforderlich; aus Fettadjektiven wird kein Prozentwert abgeleitet. Negationen bleiben negativ. Ein Vollkornmehl-Anteil in der Zutatenliste bestätigt kein Vollkornbrot. Eine native Beschreibung, die sich ausdrücklich als Haferdrink oder Milchmischgetränk bezeichnet, widerspricht der Trinkmilchfamilie; Rezeptvorschläge und Zutatenverweise ersetzen die Produktidentität nicht. Diese konservativen Regeln sind kein allgemeines Sprachverständnis für beliebige Wünsche.

Ausdrücklich als Milchnahrung, Anfangsmilch, Folgemilch oder Säuglingsmilch bezeichnete Produkte werden ebenfalls von der gewöhnlichen Trinkmilchauswahl ausgeschlossen. Herstellerwissen ersetzt diese wörtlichen Quellenangaben nicht; andere unbekannte Varianten bleiben mit den fehlenden Angaben offen.

Jedes Quellenangebot wird zuerst durch die vorhandenen Herkunfts-, GTIN-, Verkaufs­packungs-, Länder-, Filial-, Capture-, Ablauf- und Quarantäneprüfungen zugelassen. Danach bewertet die Bedarfsschicht die nativen Produkttexte. Bei HIT stammt der Name aus der erneut geprüften Originalkarte; bei den freigegebenen Wolt-/REWE-Quellen können ihre gespeicherten nativen Beschreibungen ergänzt werden. Kanonische Gruppennamen und Markenwissen ersetzen keine Quellenangabe.

`needAssessment` führt die Bewertung für jede tatsächlich ausgegebene Preisquelle getrennt:

- `confirmed`: die angefragten semantischen Eigenschaften sind im nativen Text belegt.
- `unconfirmed`: mindestens eine verlangte Angabe fehlt oder die Variante bleibt offen; `missing` benennt diese Angaben.
- `contradicted`: der native Text widerspricht dem Bedarf. Dieses Angebot wird aus der Bedarfsauswahl ausgeschlossen.

`confirmed` bezeichnet ausschließlich die hier angefragten Texteigenschaften. Es bestätigt keine manuelle Belegprüfung, Regalverfügbarkeit oder einen zahlbaren Endbetrag. Warenpreis, Pfand, Liefergebühren, Originalbelege und Zeitpunkte bleiben unverändert. Unbekanntes Pfand bleibt offen. Angebote unterschiedlicher GTINs werden nicht zu Preiszellen desselben Produkts zusammengelegt.

Die semantische Prüfung erfolgt vor dem endgültigen Ergebnislimit; belegte Eigenschaften werden vor offenen Varianten angezeigt. Die bestehende Quellensuche bleibt auf jeweils 200 Kandidaten begrenzt, die Antwort auf 20 Produktidentitäten und insgesamt 200 Preisbelege. `discoveryTruncated` weist Begrenzungen aus. `needCoverage.complete` bleibt `false`: fehlende Treffer belegen keine Abwesenheit und eine Kandidatenliste bestätigt kein vollständiges Sortiment oder einen günstigsten Gesamtwarenkorb.

In der Einkaufslisten-Auswahl bleibt „Alle Produkte“ die allgemeine Suche. Unter „Bedarf eingrenzen“ können Nutzer ausdrücklich Milch, Brot, Eier oder Butter und optionale Eigenschaften wählen. Leere Felder setzen keine Anforderungen; Salz bleibt ohne Auswahl offen, Scheiben und Zubereitung haben jeweils „Keine Vorgabe“, Ja und Nein. Ein leerer Fettgehalt wird nicht als 0 behandelt. Suchtext, Verkaufspackung und Preisart gelten zusätzlich. Ein nicht unterstützter oder widersprüchlicher Bedarf zeigt eine verständliche Fehlermeldung und wird nicht still als allgemeine Suche wiederholt.

Die App verwendet denselben reinen Matcher und bewertet für jede zugelassene native Preisquelle die angefragten Eigenschaften erneut. Jede Bewertung ist genau an Quelle, Kanal, SKU, Filiale bzw. Venue/Markt, GTIN und textuelle Verkaufspackung gebunden. Doppelte, fehlende oder abweichende Zuordnungen werden verworfen. Nach Ablauf- und Kanalprüfung wird der Produktstatus aus den verbleibenden Angeboten neu berechnet: eine abgelaufene bestätigte Quelle bestätigt keine andere Quelle. „Gewünschte Eigenschaften belegt“ und „Noch offen“ erscheinen je Preisquelle. Sie ändern keinen Warenpreis, Pfand oder Endbetrag.

Änderungen an Familie, Eigenschaften, Suchtext oder Filtern brechen ältere Suchen ab und machen ihre Auswahl ungültig. Das gilt bei der Auswahl auch für programmatisch geänderte Werte ohne Eingabeereignis. Vor jedem bewussten Klick werden Originaldaten und Ablauf erneut geprüft. Nur die gewählte GTIN und Verkaufspackung werden gespeichert; semantische Bewertungen, Preisquellen und Originalbelege bleiben außerhalb des gespeicherten Einkaufslisten-Produkts. Die allgemeine Produktsuche und bereits ausgewählte genaue GTIN-/Packungsabfragen behalten ihre bestehende Funktion.

Offline-Tests prüfen fehlende und widersprüchliche Varianten, negierte Eigenschaften, native Beschreibungstexte, Produktauswahl, Grenzen und unveränderte Quellenevidenz. Die bestehende PostgreSQL-18-Integration prüft die Bedarfssuche und den echten HTTP-Endpunkt an realen Datenbank-Joins mit ausdrücklich lokalen Testbelegen; sie ruft keine Händler auf.
