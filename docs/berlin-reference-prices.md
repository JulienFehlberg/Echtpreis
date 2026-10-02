# Berliner Händlerreferenzen

Die Einkaufslistenansicht prüft generische Milch-, Butter-, Brot- und Eierpositionen zusätzlich mit dem vorhandenen Bedarfsmatcher anhand der nativen Artikelüberschrift. Widersprüchliche Familien (etwa Buttermilchquark bei Butter oder Hafermilch bei Milch) und ausdrücklich widersprechende Eigenschaften werden ausgeschlossen. Fehlende Eigenschaften bleiben offen; eine bewusste konkrete GTIN-/Packungsauswahl hat Vorrang. Die API bleibt eine Artikelsuche: Ein Namenssuchtreffer allein ist keine bestätigte Zuordnung zum Einkaufsbedarf.

`berlin-reference-prices.js` liest vorhandene veröffentlichte Händlerangebote. Eine Berliner Referenz ist der zuletzt belegte Preis eines konkreten Artikels bei einem Händler in einem belegten Berliner Quellenmarkt. Sie ist weder ein statistischer Durchschnitt noch eine Aussage zum Preis jeder Berliner Filiale. Eine einzige belegte Filiale genügt; die Abdeckung aller Filialen ist keine Voraussetzung.

## API

`select(offers, {now, search, gtin, pack, merchant, scopeChannel, limit})` prüft und verdichtet bereits gelesene Angebote ohne Datenbankzugriff. `search(pool, options, inventoryDeps)` liest über `published-retailer-inventory.search` und wendet dieselbe Auswahl an. Das injizierbare dritte Argument hat eine `search(pool, query, services)`-Methode; die authentifizierenden Händlerdienste bleiben intern festgelegt. Die öffentliche Suche benötigt einen Suchtext mit 2–120 Zeichen oder eine gültige GTIN als Zeichenkette. `now` ist ausschließlich eine interne Test-/Dienstuhr. Unbekannte Suchfelder werden abgelehnt.

Optionale Filter sind eine exakt vergleichbare Verkaufspackung, einer der sechs Fokushändler und der ursprüngliche Kaufkanal. `limit` ist eine ganze Zahl zwischen 1 und 200 (Standard 50). Die vorhandene Inventarsuche erhält maximal 200 Zeilen; das Ergebnis ist stets begrenzt und `coverage.complete` stets `false`. Ein Trefferlimit von 200 oder zusätzliche nach der lokalen Auswahl abgeschnittene Referenzen setzt `truncated: true`. Ein kürzeres Ergebnis beweist keine vollständige Katalogabdeckung.

```js
{
  ok: true, city: "Berlin", country: "DE",
  items: [{
    offer: { /* vollständig validiertes ursprüngliches Händlerangebot */ },
    reference: {
      kind: "last-observed", city: "Berlin", country: "DE",
      merchant: "EDEKA", key: "...", identityKind: "native-gtin",
      observedAt: "2026-10-02T12:00:00.000Z",
      sourceMarket: { name: "...", address: "...", postalCode: "...",
        city: "Berlin", country: "DE", sourceId: "...", nativeMarketId: "..." },
      observedMarkets: 1, knownPriceRange: { min: 1.99, max: 1.99 },
      observedMarketPrices: [{sourceMarket: {/* ... */}, observedAt: "...",
        price: 1.99, deposit: null, currency: "EUR"}]
    }
  }],
  bounded: true, truncated: false, physicalStorePrices: false,
  coverage: {complete: false, allStoresRequired: false,
    coverageUnit: "retailer-product", queryOnly: true,
    retailers: [{merchant: "EDEKA", referenceRows: 1, observedMarkets: 1,
      scopeChannels: ["online"], supportedSources: ["Wolt EDEKA Berlin"], missing: false}],
    missingRetailers: [/* Händler ohne Treffer in dieser Suche */]}
}
```

`reference.key` ist ein stabiler, undurchsichtiger Gruppenschlüssel, keine kanonische Produkt-ID. `sourceMarket.nativeStoreId` bleibt bei REWE die native Shop-UUID und wird niemals als UUID aus der internen `stores`-Tabelle ausgegeben. `knownPriceRange` und `observedMarketPrices` enthalten je Quellenmarkt ausschließlich dessen neuesten belegten Preis derselben Identität, Packung, Kanal- und Preisbedingung. Ältere Preise desselben Marktes erzeugen keine scheinbare Filialvarianz. Der derzeit geschlossene Quellenumfang besitzt jeweils nur einen geprüften Berliner Markt pro unterstütztem Händler.

## Auswahl und Quellenumfang

Eine Identität ist entweder eine direkt vorhandene gültige GTIN mit exakter Verkaufspackung oder eine bestätigte native Artikel-ID mit Quellennamespace und exakter Verkaufspackung. Namen dienen der Suche und Anzeige, nicht der Herstellung einer Produktidentität. Unterschiedliche Packungsanzahlen, Kaufkanäle und belegte Aktions-/unbekannte Preisarten bleiben getrennt. Native Namen, Marke und Beschreibung erhalten die genaue Artikel-/Variantenanzeige.

Zunächst gewinnt die neueste Beobachtung einer nativen Artikel-ID. Ein früherer GTIN-, Packungs- oder Aktionszustand dieser Artikel-ID wird danach nicht erneut als Referenz ausgewählt. Eine fehlende GTIN wird niemals aus einem früheren Capture ergänzt. Eine aktuell ausdrücklich nicht verfügbare native Artikel-ID liefert keine ältere verfügbare Referenz. Gleichzeitige widersprüchliche aktuelle Artikel- oder Preisbelege werden zurückgehalten; die Auswahl weicht weder auf den billigeren noch auf einen älteren Preis aus.

Initial werden ausschließlich die bestehenden vollständigen Angebotsvalidatoren für **Wolt EDEKA Hilbrecht in Berlin (online/Lieferkanal)** und **REWE Hallesches Ufer in Berlin (PICKUP)** verwendet. Die sechs Fokushändler sind PENNY, EDEKA, Lidl, ALDI, Kaufland und REWE. Diese Prioritäten belegen allein noch keine Berliner Quelle. Nationale ALDI-Sortimentsveröffentlichungen ohne belegten Berliner Markt sowie dm, nahkauf, HIT und unbekannte Quellen bleiben außerhalb dieser Referenzauswahl. Die Übersicht kennzeichnet fehlende Händler und Treffer; sie fordert keine vollständige Filialliste.

## Beleg und Preisbedeutung

Es gelten die vorhandenen Prüfungen für originale Quellen-URLs und Capture-Hashes, native Markt-/Artikel-IDs, exakte Berliner Shopdaten, GTIN-Prüfziffer, feste Verkaufspackungen, Centpreise, Pfand und Kaufkanal. `observedAt` kommt ausschließlich aus `capturedAt`, niemals aus einem Aktualisierungsdatum, älteren Ankündigungsdatum oder der Uhr dieses Requests. Captures dürfen höchstens 24 Stunden alt sein. Der originale Ablaufzeitpunkt muss noch gültig sein und darf weder das bestehende 24-Stunden-Limit noch eine frühere native REWE-Gültigkeitsgrenze überschreiten. Ein kürzerer Originalablauf bleibt unverändert.

Ein unbekannter Pfandbetrag bleibt `null`; ohne bekannten Pfand wird kein Kassen-Gesamtpreis hergestellt. Wolt- und REWE-Anzeigen behalten ihre unterschiedliche native Pfanddarstellung. Warenpreis, angezeigter Preis und bekannter zahlbarer Packungspreis bleiben eigene Angebotsfelder. Gebühren sind nicht enthalten. Ein nicht als Normalpreis belegtes Angebot bleibt `priceType: "unknown"`; nachgewiesene Aktionen bleiben Aktionen. Nicht unterstützte Mitglieds-, Gutschein-, Mengen- oder personalisierte Bedingungen werden nicht zu öffentlichen Referenzen umgedeutet.

Die Referenz ist ein zusätzlicher Anzeigevertrag. `truthEligible: false`, der ursprüngliche Kaufkanal und die kanonischen bzw. physischen Preisverträge ändern sich nicht. Dieses Modul schreibt keine neuen Preisbeobachtungen, Quellenbelege, Produkt- oder Filialidentitäten und führt keine Händlerabrufe aus. Die fokussierten Tests verwenden ausschließlich synthetische Angebote in den bestehenden geschlossenen Native-Verträgen.
