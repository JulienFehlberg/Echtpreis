# ECHTPREIS – Store-Readiness

ECHTPREIS wird ab jetzt so entwickelt, dass dieselbe Kernlogik auf Web, iOS und Android genutzt werden kann.

## Grundprinzip

Die Web-App bleibt die kostenlose Testplattform. Geräteabhängige Funktionen werden nicht direkt mit der Geschäftslogik vermischt, sondern über eine Plattform-Schicht angesprochen.

```
UI / Features
  ↓
ECHTPREIS Kernlogik
  ↓
Services (API, Preise, OCR, Speicherung)
  ↓
Platform Runtime
  ├─ Web
  ├─ iOS / Capacitor
  └─ Android / Capacitor
```

## Regeln für neue Entwicklung

1. Keine neuen Server-URLs direkt in Feature-Code schreiben. Endpunkte kommen aus `app/config.js`.
2. Kamera, Standort, externe Links und spätere Push-Funktionen werden über `app/runtime.js` gekapselt.
3. Preisquellen sind austauschbare Datenquellen. Die Einkaufsliste darf nicht davon abhängen, ob der Preis von ECHTPREIS, Open Prices oder später einem anderen Anbieter kommt.
4. Bon-OCR liefert ein neutrales ECHTPREIS-Datenformat. Die Statistik kennt weder Tesseract noch einen späteren Cloud-OCR-Anbieter.
5. Unsichere Daten werden sichtbar als unsicher behandelt und nicht als bestätigte Verfügbarkeit oder Ersparnis gespeichert.
6. Lokale Testfunktionen müssen ohne kostenpflichtige Dienste funktionieren.
7. Produktionsdienste dürfen später ergänzt werden, ohne die UI neu zu bauen.

## Geplanter Store-Weg

- Testphase: GitHub Pages + bestehende API + kostenlose/offene Datenquellen.
- Vor Beta: Web-Code in kleinere Module aufteilen, Capacitor-Projekt hinzufügen, native Kamera/Standort-Schnittstellen anbinden.
- iOS-Test: TestFlight.
- Android-Test: Internal Testing im Play Store.
- Produktion: eigene Domain, produktive Datenbank, Monitoring, Datenschutz-/Store-Metadaten und skalierbare Infrastruktur.

## Kostenstrategie

In der Testphase sollen keine zwingenden laufenden Kosten entstehen. Kostenpflichtige Infrastruktur wird erst eingeführt, wenn ein konkreter Nutzen besteht, z. B. bessere OCR, mehr API-Kapazität oder größere Nutzerzahlen.

## Status Testphase (29.09.2026)

- GitHub-Pages-Testversion: aktiv
- Release-Checks: statische App-Guards, API-Smoke und Receipt-Vision-Tests verpflichtend
- Bon-Gesamtsumme: gedruckte autoritative Summe hat Vorrang vor Einzelpositionsarithmetik
- Bon-Zahlungsdaten: Bar/Karte/Rückgeld werden getrennt von Warenpositionen behandelt
- Receipt-Vision: strukturierte Ausgabe, Plausibilitätsprüfungen und Datenschutzmodus `store: false`
- Automatisierte Testfreigabe: bestanden (Static Guards, API, Receipt Vision und verpflichtender Browser-End-to-End-Smoke)
- Mobile/PWA-Grundlagen: Manifest, Portrait-Standalone-Modus, iOS-Metadaten, Safe-Area-Viewport und Rückkamera-Input vorhanden
- Nächster Freigabeschritt: reale End-to-End-Gerätetests mit den vorhandenen Kaufland-, EDEKA-, ALDI- und PENNY-Belegen
- Testkandidat gilt als technisch freigegeben; verbleibende Freigabe ist bewusst eine reale Geräte-/Belegprüfung, kein weiterer theoretischer Feature-Block
- Reale Ground-Truth-Fixtures werden vom Browser-Smoke geladen und automatisch gegen Händler, Datum, gedruckte Gesamtsumme, Positionen, Mengen, Pfand und – sofern vorhanden – Zahlungsdaten geprüft. Aktuell liegt der vollständig transkribierte EDEKA-Referenzbon vor. Weitere Händler-Fixtures dürfen erst aus den jeweiligen Originalbelegen ergänzt werden, nicht aus erfundenen Daten.

## Noch vor einem Store-Release zwingend

- App-Icons und Splash Screens
- native Kamera- und Standortberechtigungen
- Datenschutzerklärung und Support-Seite
- Löschung/Export personenbezogener Daten
- Store-Metadaten und Screenshots
- Fehler-/Crash-Monitoring
- API-Rate-Limits und Produktionsdatenbank
- echte Geräte-Tests auf iPhone und Android
- Review der verwendeten Drittanbieter und deren Datenschutzbedingungen


## Legal / Trust Gate (29.09.2026)

Dieser Abschnitt ist ein technischer Release-Gate und ersetzt keine individuelle anwaltliche Freigabe.

### Preisvergleich und Händler-Ranking
- Ein Händler darf nur dann als „günstigster“ oder in einer Preis-Rangfolge dargestellt werden, wenn der gesamte verglichene Warenkorb für diesen Händler mit belastbaren, nicht bloß modellierten Referenzpreisen belegt ist.
- Modellierte Markt-Referenzwerte, Marken-Schätzungen und historische Preise dürfen keinen Händler zum Gewinner oder Verlierer machen.
- Reine Referenzwert-Vergleiche werden neutral und ohne Preis-Rangfolge dargestellt.
- Spar-Aussagen nach Bon-Scan setzen eine ausreichende Abdeckung mit aktuellen, nicht bloß historischen/Richtwert-Preisen voraus.
- Vergleichbare Produkte müssen denselben Bedarf/Zweck erfüllen; Marken-/Packungsabweichungen und Mengenannahmen sind sichtbar zu kennzeichnen.
- Datenquelle, Aktualität, Abdeckung und Schätzstatus müssen am Vergleich nachvollziehbar bleiben.
- Die Hauptparameter der Rangfolge und ihre Gewichtung müssen für Nutzer unmittelbar leicht zugänglich erklärt werden.
- Händler dürfen nicht abgewertet oder mit unbelegten Tatsachenbehauptungen beschrieben werden.

### Preiswahrheit
- Gedruckte Bon-Gesamtsumme ist für den konkreten Einkauf die autoritative Quelle.
- Referenzpreise sind keine Behauptung eines aktuellen Filialpreises oder einer Verfügbarkeit.
- Grund-/Mengeneinheiten müssen bei mengenbezogenen Vergleichen konsistent normalisiert werden.
- „Du hättest X € gespart“ darf nicht aus Modellschätzungen abgeleitet werden.

### Datenschutz / Anbieterpflichten – Release-Blocker
Vor öffentlichem kommerziellem Release müssen mindestens abgeschlossen sein:
- finale Datenschutzerklärung auf Basis der tatsächlich produktiv eingesetzten Datenflüsse und Auftragsverarbeiter;
- vollständige Anbieterkennzeichnung/Impressum mit realem Betreiber, ladungsfähiger Anschrift und Kontaktangaben;
- dokumentierte Rechtsgrundlagen, Löschfristen, Betroffenenrechte und Auftragsverarbeitung für alle produktiven Dienste;
- funktionierender Export und Löschweg für personenbezogene Serverdaten, soweit solche Daten produktiv verarbeitet werden;
- Prüfung der Store-Datenschutzangaben und Einwilligungs-/Berechtigungsdialoge;
- anwaltlicher Release-Review insbesondere zu UWG/vergleichender Werbung, Datenschutz, Marken-/Logonutzung, AGB/Abonnement/Widerruf und Preisangaben.

### Harte Freigaberegel
Kein öffentlicher kommerzieller Release darf allein aufgrund automatisierter Tests als „rechtlich freigegeben“ bezeichnet werden. Die technische Test-Suite verhindert bekannte riskante Vergleichsmuster; die finale rechtliche Freigabe muss anhand des dann tatsächlichen Produkts, Betreibers, Geschäftsmodells, Datenflusses und Vertriebswegs erfolgen.
