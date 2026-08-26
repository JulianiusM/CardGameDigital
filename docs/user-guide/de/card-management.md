# Kartenverwaltung

Die Kartenverwaltung ist optional. Solange jede Auswahl auf **Erben** bleibt, bestimmen
Herstellerkatalog, gewähltes Profil und normaler Spielaufbau wie bisher, welche Karten
erscheinen. Für eine schnelle Runde ist das der beste Standard.

## Geltungsbereich wählen

Öffne auf einer lokalen Installation die **Kartenverwaltung** im Hauptmenü. Auf einer
öffentlichen Instanz meldest du dich an und öffnest im Konto den Tab
**Kartenverwaltung**. Der aktuelle DataSpace bildet die Grundlage für alle darin
gespeicherten Gruppen. **DataSpace / Gruppe wählen** zeigt zwei klar benannte Ebenen:
Du kannst zum gemeinsamen DataSpace-Standard zurückkehren oder die begrenzte
Gruppenliste durchsuchen und eine Gruppe mit eigenen geerbten Ausnahmen wählen.

Der eigenständige lokale Arbeitsbereich nutzt dieselbe äußere Kartenform wie Hilfe und
Konto. Im Konto verhält er sich wie die anderen Tabs: Die Kontoüberschrift bleibt
stehen, während eine kompakte Tab-Erklärung die Richtlinien einführt. Wechsel, Export
und Import verwenden dieselben gestalteten Schaltflächen ohne Zeilenumbruch.

Änderungen gelten für künftige Spiele. Ein laufendes Spiel behält die Richtlinie, mit der
es gestartet wurde. Im Schritt Anpassen lässt sich außerdem der Bereich **Dieses Spiel**
öffnen. Diese Auswahl gilt nur für das vorbereitete Spiel und verändert keine
gespeicherte Richtlinie.

## Kinderfreundlich wählen, wenn Kinder mitspielen

**Kinderfreundlich** ist ein normales Schnellstartprofil. Es aktiviert Fragen zu
Alltag, Kindheit, Persönlichkeit, Szenarien, Freundschaft, Beziehung und Körper; lässt
nur alberne, gewöhnliche Kontakt- und allgemeine Pflichten zu; sperrt Drittpersonen-,
Rauschmittel-, Auszieh- und Nacktheitsanforderungen; und startet mit **Tief persönlich**
und maximaler Intensität 3. Unter **Erlebnis anpassen** lässt sich anschließend jeder
Wert ändern—das Profil sperrt oder versteckt keine Einstellung.

## Mit Bereichsstandards beginnen

**Bereichsstandards** sind der einfachste Weg für eine allgemeine Änderung.
Verfügbarkeit und Verlauf sind vom **Überschreiben der Karteneigenschaften** getrennt.
Je nach Eigenschaft kann eine Auswahl erben, den Katalogwert verwenden oder einen
eigenen Wert festlegen. Ein eigener Wert ersetzt den relativen Wert jeder passenden
Karte; er ist keine erlaubte Obergrenze.

Geordnete Werte verwenden eine gemeinsame Skala von links nach rechts. Die soziale
Sensibilität reicht von **Allgemein** bis **Explizit**, die Kartenintensität von **1** bis
**5**. Beim Wechsel zu **Wert überschreiben** stellt der Editor den zuletzt für diesen Eintrag
gewählten Wert wieder her. Gibt es noch keinen, beginnt er am wenigsten
einschränkenden Ende der Sensibilitätsskala (**Explizit**). Eine neue eigene
Kartenintensität beginnt dagegen bei **1**, damit eine niedrige Startintensität nicht
versehentlich alle passenden Karten aus dem Startpool entfernt. Hohe Ersatzwerte werden
mit einem ausdrücklichen Hinweis erklärt. Die Personenzahl nutzt dieselbe Auswahl
Erben/Katalogwert/Wert überschreiben wie alle anderen Einträge; Minimum und optionales Maximum
erscheinen erst bei Bedarf.

Die normale Spieleinstellung **Maximale soziale Sensibilität** ist immer eine Skala von
Allgemein bis Explizit und gehört zum gewählten Profil beziehungsweise zur
Spielkonfiguration. Themen-, Pflicht- und Merkmalsgrenzen werden über die normalen
Einstellungen unter Erlebnis anpassen oder über ausdrückliche Kartenrichtlinien
geändert; es gibt keine zusätzliche Situationsebene, die damit abgeglichen werden muss.

Einrichtung, Erlebnis anpassen, Couch-Personenauswahl und Raumlobby zeigen vor dem Start
die Anzahl geeigneter Karten. Die große Zahl umfasst die vollständige eingestellte
Intensitätsentwicklung; eine kleinere Zeile nennt die zu Beginn verfügbaren Karten. Der
Server berücksichtigt Sprache, Modus, Profil, Sensibilität, geerbte Kartenrichtlinie,
Gruppenverlauf und Personenzahl. Private Grenzen können die Anzahl beim Start weiter
reduzieren und werden durch diese Vorschau niemals offengelegt.

## Bedingte Regel anlegen

Nutze eine Regel, wenn ein stabiler Typ, eine Taxonomie, Sensibilität, ein Merkmal oder
ein Katalogbereich gleich behandelt werden soll. Neue Regeln sind zuerst deaktiviert.
Vergib einen klaren Namen, wähle strukturierte Bedingungen und das Ergebnis und klicke
dann bei Bedarf auf **Treffer vorschauen**. Die Vorschau zählt den vollständigen
Katalog, zeigt aber nur wenige Beispiele und verändert oder speichert nichts. Sie ist
eine optionale Prüfung und keine Voraussetzung zum Speichern. Neue Regeln bleiben bis
zur bewussten Aktivierung deaktiviert. Kartenformulierungen werden nie als
Regelbedingung gespeichert.

Regeln wirken in der angezeigten Reihenfolge. Mit den Pfeilaktionen verschiebst du die
ausgewählte Regel. Suche und begrenzte Seiten halten auch viele Regeln übersichtlich.

## Eine Karte ändern

**Kartenausnahmen** durchsucht den Katalog auf dem Server. Unter **Bedingungen** findest
du Taxonomie- und Merkmalsfilter; anschließend blätterst du mit gleich breiten Zurück-
und Weiter-Schaltflächen durch begrenzte Ergebnisse. In der breiten zweispaltigen
Ansicht wächst der Bereich mit der Seite, statt eine zweite Scrollleiste einzublenden.
Bei einer ausgewählten Karte siehst du die vollständige kanonische UUID und für jede
verwaltete Eigenschaft Katalogwert, wirksamen Wert, lokale Entscheidung und
verantwortliche Quelle. Lass Felder geerbt, solange die Karte keine echte Ausnahme
braucht.

Eine Ausnahme für alle Suchtreffer verlangt eine Bestätigung in der Seite. Der Server
prüft die Anzahl erneut und speichert stabile Karten-IDs, nicht den Suchbegriff. Wird
eine Ausnahme entfernt, erbt die Karte wieder normal.

## Import und Export

**Bereich exportieren** lädt nur die Richtlinie des gewählten DataSpace oder der Gruppe
herunter. **Bereich importieren** prüft die Datei und fragt nach, bevor dieser Bereich
ersetzt wird. Der Import ändert weder Herstellerkatalog noch Besitz-IDs. Behandle
exportierte Richtlinien als Konfigurationsdaten und prüfe vor dem Import ihre Herkunft.
