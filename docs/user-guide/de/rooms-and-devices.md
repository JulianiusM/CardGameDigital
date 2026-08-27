# Räume, Geräte und Spielleitung

## Beitreten

Die Spielleitung teilt den sechsstelligen Raumcode oder den QR-Code. Der Code darf
öffentlich gezeigt werden; der geheime Gerätezugang wird erst beim Beitritt erzeugt und
bleibt auf diesem Gerät. Verschicke keine gespeicherten Zugangslinks oder Browserdaten.

Bei jedem QR-Code stehen zusätzlich die Adressen, über die dieser Raum erreichbar sein
soll. Ein lokaler Server kann bei mehreren Netzwerkschnittstellen mehrere LAN-Adressen
anzeigen; nutze eine Adresse, die das beitretende Gerät erreicht. Virtuelle Adapter und
nicht nutzbare Link-Local-IPv6-Routen werden ausgelassen, pro physischer Schnittstelle
erscheint höchstens eine IPv6-Adresse. IPv6-Adressen stehen in eckigen Klammern, wie es
bei URLs üblich ist. Ein Party Screen zeigt pro Seite so viele Adressen, wie in die
verfügbare Höhe passen, bevor er automatisch weiterwechselt.

Mehrere Geschwistergruppen können gleichzeitig im selben Netz spielen: Jeder Raum hat
einen eigenen Code, Zustand und Befehlskanal. Prüfe vor dem Beitritt den Code, damit du
nicht versehentlich in der anderen Runde landest.
Auf jedem verbundenen Gerät bleibt die aktuelle Personenzahl zusammen mit der
konfigurierten Höchstzahl sichtbar.

## Party Screen zuerst öffnen

Wähle unter **Spiel hosten** im letzten Einrichtungsschritt **TV + Smartphones**. Dieser
Browser wird sofort zum schreibgeschützten Party Screen und zeigt Code und QR-Code an,
während er wartet. Es wird kein versteckter Host erzeugt. Tritt mit einem Smartphone als
Spieler bei: Das erste erfolgreich verbundene Smartphone wird Host und erhält die Start-
und Einstellungssteuerung. Der Party Screen zeigt, wer das Spiel steuert und ob dieser
Host gerade neu verbindet.

Der Eintrag **Nur anzeigen** im Hauptmenü hat weiterhin eine andere Aufgabe: Damit wird
ein zusätzlicher schreibgeschützter Bildschirm per Code an einen bereits bestehenden
Raum angeschlossen.

## Mehrere Personen an einem Gerät

In der Lobby kann jedes Spielergerät lokale Personen hinzufügen. Das ist auch auf einem
Nicht-Host-Gerät möglich. Das Gerät zeigt später nur die Aktionen für die Personen, die
es steuert. Änderungen werden nach der Eingabe automatisch und spätestens vor dem Start
gespeichert; der sichtbare Status bestätigt dies. Danach ist die Liste gesperrt, damit
Stimmen und Rundenreihenfolge eindeutig bleiben.

## Rolle der Spielleitung

Es gibt genau einen Host. Nur dieser darf die Sitzung starten, globale Einstellungen
ändern, die Hostrolle übertragen oder das Spiel beenden. Aktive Spieler dürfen ihre
eigenen vorgesehenen Aktionen ausführen; ein Display bleibt schreibgeschützt.

## Host übergeben oder wiederherstellen

Der Host kann in der Lobby gezielt ein Spielergerät auswählen und die Aufgabe
übertragen. Bei einem unbeabsichtigten Verbindungsabbruch wartet der Server standardmäßig
drei Minuten auf die
Rückkehr. Danach wird ein verbundenes Spielergerät automatisch Host. War niemand
verbunden, erfolgt die Zuweisung beim nächsten geeigneten Beitritt.
Wenn alle Hosts und Spieler den Raum verlassen oder ihre Rückkehrfrist abläuft, hält ein
aktuell verbundenes Display den Code für neu beitretende Spieler offen. Es wird nie Host;
der nächste Spieler übernimmt. Der Raum schließt, sobald auch das Display getrennt ist
und seine Rückkehrfrist abläuft.

Nach einer Wiederverbindung immer den neuen Snapshot abwarten. Nur Schaltflächen, die
der Server danach anbietet, sind aktuell erlaubt.

## Ich hab noch nie auf gemeinsamen Anzeigen

Während der Abstimmung darf der gemeinsame Bildschirm für jede aktuelle Person
**Abgestimmt** oder **Wartet** anzeigen. Die eigentliche Ja/Nein-Antwort bleibt bis zur
Ergebnisanzeige verborgen.

Im Modus **Anonym** werden nur Summen angezeigt. Bei **Antworten offen** werden die
Antworten nach Abschluss der Abstimmung bewusst öffentlich mit den Namen angezeigt.

## Party Screen

Der Party Screen zeigt Karten, aktive Person, Runde und öffentliche Ergebnisse. Nutze
ihn nicht als persönliches Gerät: Private Auswahlmöglichkeiten und Grenzen gehören auf
die Spielergeräte. Ein Display kann nie automatisch Host werden.

Lange Abstimmungs- und Ergebnislisten wechseln auf kleinen Party Screens automatisch
seitenweise und beginnen danach wieder von vorn. Karte, Überschrift und Summen bleiben
dabei sichtbar; niemand muss am Fernseher scrollen.
