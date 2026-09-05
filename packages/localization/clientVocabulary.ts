export const CLIENT_VOCABULARY_LOCALES = ["en-GB", "de-DE"] as const;
export type ClientVocabularyLocale = (typeof CLIENT_VOCABULARY_LOCALES)[number];

type BilingualClientTerm = Readonly<Record<ClientVocabularyLocale, string>>;

/** Product vocabulary shared by browser and native clients, keyed by the Kodi constant. */
export const CLIENT_VOCABULARY = {
    MODE_NEVER: { "en-GB": "Never Have I Ever", "de-DE": "Ich hab noch nie" },
    DECREASE: { "en-GB": "Decrease", "de-DE": "Verringern" },
    INCREASE: { "en-GB": "Increase", "de-DE": "Erhöhen" },
    START_GAME: { "en-GB": "Start game", "de-DE": "Spiel starten" },
    ROUND_LABEL: { "en-GB": "Round", "de-DE": "Runde" },
    TRUTH: { "en-GB": "Truth", "de-DE": "Wahrheit" },
    DARE: { "en-GB": "Dare", "de-DE": "Pflicht" },
    READY_NEXT_CARD: {
        "en-GB": "Ready for the next card?",
        "de-DE": "Bereit für die nächste Karte?",
    },
    SAVE: { "en-GB": "Save", "de-DE": "Speichern" },
    CANCEL: { "en-GB": "Cancel", "de-DE": "Abbrechen" },
    DELETE: { "en-GB": "Delete", "de-DE": "Löschen" },
    END_GAME: { "en-GB": "End game", "de-DE": "Spiel beenden" },
    CARD_INTENSITY: { "en-GB": "Card intensity", "de-DE": "Kartenintensität" },
    NEW_GAME: { "en-GB": "New game", "de-DE": "Neues Spiel" },
    ROOM_CODE: { "en-GB": "Room code", "de-DE": "Raumcode" },
    CARD_LANGUAGE: { "en-GB": "Card language", "de-DE": "Kartensprache" },
    MAX_INTENSITY: { "en-GB": "Maximum intensity", "de-DE": "Maximale Intensität" },
    START_INTENSITY: { "en-GB": "Starting intensity", "de-DE": "Startintensität" },
    ROOM_SETTINGS_CHANGED: {
        "en-GB": "The Host changed the game settings.",
        "de-DE": "Der Host hat die Spieleinstellungen geändert.",
    },
    HELP: { "en-GB": "Help", "de-DE": "Hilfe" },
    MODE_LABEL: { "en-GB": "Mode", "de-DE": "Modus" },
    PROFILE_LABEL: { "en-GB": "Profile", "de-DE": "Profil" },
    GROUP_LABEL: { "en-GB": "Group", "de-DE": "Gruppe" },
    BACK: { "en-GB": "Back", "de-DE": "Zurück" },
    GROUP_NAME: { "en-GB": "Group name", "de-DE": "Gruppenname" },
    SETTINGS: { "en-GB": "Settings", "de-DE": "Einstellungen" },
    GAME: { "en-GB": "Game", "de-DE": "Spiel" },
    VOTED_STATUS: { "en-GB": "Voted", "de-DE": "Abgestimmt" },
    ADD_RULE: { "en-GB": "Add rule", "de-DE": "Regel hinzufügen" },
    RULE_NAME: { "en-GB": "Rule name", "de-DE": "Regelname" },
    ENABLED: { "en-GB": "Enabled", "de-DE": "Aktiv" },
    MOVE_UP: { "en-GB": "Move up", "de-DE": "Nach oben" },
    MOVE_DOWN: { "en-GB": "Move down", "de-DE": "Nach unten" },
    SENSITIVITY: { "en-GB": "Social sensitivity", "de-DE": "Soziale Sensibilität" },
    ACTIVE: { "en-GB": "Active", "de-DE": "Aktiv" },
    YES_NO_POSSIBLE: {
        "en-GB": "Yes/no answer possible",
        "de-DE": "Ja/Nein-Antwort möglich",
    },
    AVAILABILITY: { "en-GB": "Availability", "de-DE": "Verfügbarkeit" },
    ALWAYS_ELIGIBLE: {
        "en-GB": "Ignore Group history",
        "de-DE": "Gruppenverlauf ignorieren",
    },
    REPEAT_COOLDOWN: {
        "en-GB": "Repeat cooldown",
        "de-DE": "Wiederholungsabstand",
    },
    WEIGHT: { "en-GB": "Selection weight", "de-DE": "Auswahlgewicht" },
    INCLUDE: { "en-GB": "Include", "de-DE": "Einschließen" },
    EXCLUDE: { "en-GB": "Exclude", "de-DE": "Ausschließen" },
    SENSITIVITY_GENERAL: { "en-GB": "General", "de-DE": "Allgemein" },
    SENSITIVITY_PERSONAL: { "en-GB": "Personal", "de-DE": "Persönlich" },
    SENSITIVITY_INTIMATE: { "en-GB": "Intimate", "de-DE": "Intim" },
    SENSITIVITY_EXPLICIT: { "en-GB": "Explicit", "de-DE": "Explizit" },
    FLAG_PHYSICAL_CONTACT: { "en-GB": "Physical contact", "de-DE": "Körperkontakt" },
    FLAG_NUDITY: { "en-GB": "Nudity", "de-DE": "Nacktheit" },
    FLAG_ALCOHOL: { "en-GB": "Alcohol", "de-DE": "Alkohol" },
} as const satisfies Readonly<Record<string, BilingualClientTerm>>;

export type ClientVocabularyKey = keyof typeof CLIENT_VOCABULARY;
