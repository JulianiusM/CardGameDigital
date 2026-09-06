import type { ServerMessageCatalog } from "../catalog";

export const de = {
    messages: {
        "request.internal": "Interner Serverfehler",
        "request.invalid": "Ungültige Eingabe.",
        "request.tooLarge":
            "Diese Anfrage ist zu groß. Verkleinere die Datei oder die Einstellungen und versuche es erneut.",
        "cardPolicy.invalidImport":
            "Diese Datei ist keine unterstützte Kartenrichtlinie. Wähle einen v2-Export mit höchstens 250 Regeln und 50.000 Kartenausnahmen.",
        "cardPolicy.unknownCard":
            "Diese Richtlinie verweist auf Karten, die hier fehlen. Verwende einen Export für den installierten Katalog.",
        "request.notFound": "Nicht gefunden.",
        "account.localDisabled": "Lokale Anmeldung ist deaktiviert.",
        "account.oidcDisabled": "OIDC ist deaktiviert.",
        "account.usernameTaken": "Dieser Benutzername ist bereits vergeben.",
        "account.emailTaken": "Diese E-Mail-Adresse wird bereits verwendet.",
        "account.invalidCredentials": "Benutzername oder Passwort ist falsch.",
        "account.notActivated": "Das Konto wurde noch nicht aktiviert.",
        "account.invalidActivation": "Der Aktivierungslink ist ungültig oder abgelaufen.",
        "account.invalidReset": "Der Link ist ungültig oder abgelaufen.",
        "account.usernameMismatch": "Der Benutzername stimmt nicht überein.",
        "account.dataSpaceNotFound": "DataSpace nicht gefunden.",
        "account.lastDataSpace": "Ein Konto muss mindestens einen DataSpace behalten.",
        "account.noDataSpace": "Kein DataSpace ausgewählt.",
        "account.authenticationRequired": "Anmeldung erforderlich.",
        "account.sessionNotFound": "Sitzung nicht gefunden.",
        "account.sessionExpired": "Die Sitzung ist abgelaufen.",
        "account.invalidOidcSession": "Die Anmeldesitzung ist ungültig oder abgelaufen.",
        "account.localDataSpaceUnavailable": "Der lokale DataSpace ist nicht verfügbar.",
        "account.dataSpaceForbidden": "Der DataSpace gehört nicht zu diesem Konto.",
        "request.invalidOrigin": "Ungültige Anfragequelle.",
        "request.rateExceeded": "Zu viele Anfragen. Bitte versuche es später erneut.",
        "help.notFound": "Hilfeseite nicht gefunden.",
        "help.title": "Hilfe",
        "room.invalidRequest": "Ungültige Raumanfrage.",
        "room.notFound": "Raum nicht gefunden.",
        "room.full": "Der Raum ist voll.",
        "room.bootstrapUnsupported": "Das Öffnen eines reinen Anzeigeraums ist nicht verfügbar.",
        "room.idempotencyRequired": "Für diese Anfrage ist ein Idempotenzschlüssel erforderlich.",
        "room.idempotencyInvalid": "Der Idempotenzschlüssel ist ungültig.",
        "room.idempotencyReused":
            "Dieser Idempotenzschlüssel wurde bereits für eine andere Anfrage verwendet.",
        "room.idempotencyInProgress":
            "Der Raum wird noch geöffnet. Bitte versuche es gleich erneut.",
        "room.idempotencyGone":
            "Die gespeicherte Antwort für diese Raumeröffnung ist nicht mehr verfügbar.",
        "couch.invalidRequest": "Ungültige Anfrage.",
        "realtime.originNotAllowed": "Diese Anfragequelle ist nicht erlaubt.",
        "realtime.handshakeRequired": "Die Verbindung wurde nicht rechtzeitig bestätigt.",
        "realtime.rateExceeded": "Zu viele Echtzeitbefehle.",
        "realtime.protocolUnsupported": "Keine unterstützte Protokollversion.",
        "realtime.credentialNotFound": "Raum oder Zugangsdaten wurden nicht gefunden.",
        "realtime.invalidMessage": "Ungültige Nachricht.",
        "room.joinNotCommitted": "Der Raumbeitritt konnte nicht gespeichert werden.",
        "room.devicePlayersLocked": "Lokale Personen sind nach Spielstart gesperrt.",
        "room.hostOnlyTransfer": "Nur der Host kann die Host-Aufgabe übertragen.",
        "room.boundariesLocked": "Grenzen sind nach Spielstart gesperrt.",
        "room.enrollmentRequired":
            "Speichere deine privaten Grenzen, bevor du in dieses Spiel einsteigst.",
        "room.settingsLocked": "Raumeinstellungen sind nach Spielstart gesperrt.",
        "room.sessionAlreadyStarted": "Das Spiel wurde bereits gestartet.",
        "room.unknownProfile": "Unbekanntes Spielprofil.",
        "room.adultConfirmationRequired": "Explizite Inhalte erfordern eine Bestätigung.",
        "room.minimumPlayers": "Mindestens zwei Personen werden benötigt.",
        "room.sessionNotStarted": "Das Spiel wurde noch nicht gestartet.",
        "room.sessionNotEnded": "Beende das aktuelle Spiel, bevor du ein neues startest.",
        "room.activePlayerOnly": "Nur die aktive Person darf auswählen.",
        "room.activePlayerOrHostOnly": "Nur die aktive Person oder der Host darf fortfahren.",
        "room.cannotVoteForOther": "Eine Abstimmung für andere Personen ist nicht erlaubt.",
        "room.notAuthorized": "Nicht berechtigt.",
        "game.staleRevision": "Der Spielstand hat sich geändert.",
        "game.invalidState": "Diese Aktion ist im aktuellen Spielzustand nicht möglich.",
        "cardPolicy.revisionConflict":
            "Diese Richtlinie wurde geändert. Lade die Richtlinie neu und prüfe den aktuellen Stand, bevor du erneut speicherst.",
        "cardPolicy.ruleNotFound":
            "Diese Regel ist nicht mehr verfügbar. Lade die Richtlinie neu und wähle eine andere Regel.",
        "cardPolicy.resultSetChanged":
            "Die passenden Karten haben sich geändert. Lade die Richtlinie neu, prüfe die Kartenliste und bestätige die Sammeländerung erneut.",
        "cardPolicy.invalidRuleOrder":
            "Die Reihenfolge muss jede Regel genau einmal enthalten. Lade die Richtlinie vor dem Umsortieren neu.",
        "cardPolicy.notFound":
            "Diese Kartenausnahme ist nicht mehr verfügbar. Lade die Richtlinie vor dem erneuten Bearbeiten neu.",
        "card.notFound":
            "Diese Karte ist nicht verfügbar. Lade die Kartenliste neu und wähle eine andere Karte.",
        "group.notFound":
            "Diese Gruppe ist im aktuellen Datenraum nicht mehr verfügbar. Wähle einen anderen Geltungsbereich oder prüfe dein Konto.",
        "cardPolicy.capacityExceeded":
            "Eine Richtlinie kann höchstens 250 Regeln und 50.000 Kartenausnahmen enthalten.",
        "game.catalogCapacityExceeded":
            "Dieser Katalog ist zu groß, um ein Spiel zu starten. Verkleinere den installierten Katalog oder seine Texte.",
        "game.sessionCapacityExceeded":
            "Der Server hat seine Spielkapazität erreicht. Versuche es gleich erneut oder beende ein ungenutztes Spiel.",
        "game.cardPoolExhausted": "Keine Karte erfüllt alle aktiven Regeln.",
        "catalog.localeUnavailable": "Diese Kartensprache ist nicht verfügbar.",
        "game.sessionNotFound": "Das Couch-Spiel wurde nicht gefunden.",
        "game.adultConfirmationRequired": "Explizite Inhalte erfordern eine Bestätigung.",
        "game.playersRequired": "Mindestens eine Person wird benötigt.",
        "game.minimumPlayers": "Mindestens zwei Personen werden benötigt.",
        "game.playerIdsUnique": "Personen-IDs müssen eindeutig sein.",
        "game.unknownPlayer": "Unbekannte Person.",
        "game.alreadyVoted": "Diese Person hat bereits abgestimmt.",
        "profile.acquaintances.name": "Bekannte & Kolleg:innen",
        "profile.acquaintances.description": "Lockere, unverfängliche Inhalte für neue Gruppen.",
        "profile.childFriendly.name": "Kinderfreundlich",
        "profile.childFriendly.description":
            "Verspielte, nicht sexuelle Karten, wenn Kinder mitspielen.",
        "profile.friends.name": "Gute Freunde",
        "profile.friends.description": "Persönliche, verspielte Inhalte für Freunde.",
        "profile.closeFriends.name": "Enge Freunde",
        "profile.closeFriends.description": "Intime, vertrauensvolle Inhalte für enge Gruppen.",
        "profile.spicy.name": "Spicy",
        "profile.spicy.description":
            "Explizite Inhalte für einwilligende Erwachsene; zusätzliche Freigabe erforderlich.",
        "profile.custom.name": "Custom",
        "profile.custom.description": "Neutral starten und alle Optionen selbst festlegen.",
    },
    email: {
        signature: "Dein Multiplayer Party Card Game Team",
        activation: {
            subject: "Konto aktivieren",
            body: "Willkommen!\n\nAktiviere dein Konto innerhalb einer Stunde:\n{link}\n\n{signature}",
        },
        passwordReset: {
            subject: "Passwort zurücksetzen",
            body: "Lege innerhalb einer Stunde ein neues Passwort fest:\n{link}\n\n{signature}",
        },
        accountDeleted: {
            subject: "Konto gelöscht",
            body: "Das Konto {username} und seine gespeicherten Spieldaten wurden gelöscht.\n\n{signature}",
        },
    },
} satisfies ServerMessageCatalog;
