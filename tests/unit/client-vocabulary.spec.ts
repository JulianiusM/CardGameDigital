import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { de } from "../../apps/web/src/locales/de";
import { en } from "../../apps/web/src/locales/en";
import {
    CLIENT_VOCABULARY,
    CLIENT_VOCABULARY_LOCALES,
    type ClientVocabularyKey,
} from "../../packages/localization/clientVocabulary";

const WEB_PATHS = {
    MODE_NEVER: ["modes.never.1"],
    DECREASE: ["common.decrease"],
    INCREASE: ["common.increase"],
    START_GAME: ["common.startGame", "room.start"],
    ROUND_LABEL: ["common.round"],
    TRUTH: ["common.truth"],
    DARE: ["common.dare", "cardManagement.cardTypeNames.DARE"],
    READY_NEXT_CARD: ["common.ready"],
    SAVE: ["common.save", "account.save"],
    CANCEL: ["common.cancel"],
    DELETE: ["common.delete"],
    END_GAME: ["common.end"],
    CARD_INTENSITY: ["common.cardIntensityLabel", "cardManagement.intensity"],
    NEW_GAME: ["couch.newGame", "menu.newGame", "end.newGame"],
    ROOM_CODE: ["room.code", "setup.roomCode"],
    CARD_LANGUAGE: ["room.cardLanguage"],
    MAX_INTENSITY: ["room.maximumIntensity"],
    START_INTENSITY: ["room.startingIntensity"],
    ROOM_SETTINGS_CHANGED: ["room.settingsChanged"],
    HELP: ["menu.help", "account.help", "help.title"],
    MODE_LABEL: ["setup.mode", "setup.stepLabels.mode"],
    PROFILE_LABEL: ["setup.profile", "setup.stepLabels.profile"],
    GROUP_LABEL: ["setup.group", "setup.stepLabels.group", "cardManagement.group"],
    BACK: ["setup.back"],
    GROUP_NAME: ["setup.groupName"],
    SETTINGS: ["settings.title"],
    GAME: ["settings.game"],
    VOTED_STATUS: ["neverHaveIEver.voted"],
    ADD_RULE: ["cardManagement.addRule"],
    RULE_NAME: ["cardManagement.ruleName"],
    ENABLED: ["cardManagement.enabled"],
    MOVE_UP: ["cardManagement.moveUp"],
    MOVE_DOWN: ["cardManagement.moveDown"],
    SENSITIVITY: ["cardManagement.sensitivity"],
    ACTIVE: ["cardManagement.active"],
    YES_NO_POSSIBLE: ["cardManagement.yesNoAnswerPossible"],
    AVAILABILITY: ["cardManagement.availability"],
    ALWAYS_ELIGIBLE: ["cardManagement.alwaysEligible"],
    REPEAT_COOLDOWN: ["cardManagement.repeatCooldown"],
    WEIGHT: ["cardManagement.weight"],
    INCLUDE: ["cardManagement.availabilityDirectives.INCLUDE"],
    EXCLUDE: ["cardManagement.availabilityDirectives.EXCLUDE"],
    SENSITIVITY_GENERAL: ["cardManagement.sensitivityNames.GENERAL"],
    SENSITIVITY_PERSONAL: ["cardManagement.sensitivityNames.PERSONAL"],
    SENSITIVITY_INTIMATE: ["cardManagement.sensitivityNames.INTIMATE"],
    SENSITIVITY_EXPLICIT: ["cardManagement.sensitivityNames.EXPLICIT"],
    FLAG_PHYSICAL_CONTACT: ["boundaries.flags.REQUIRES_PHYSICAL_CONTACT"],
    FLAG_NUDITY: ["boundaries.flags.REQUIRES_NUDITY"],
    FLAG_ALCOHOL: ["boundaries.flags.INVOLVES_ALCOHOL"],
} as const satisfies Record<ClientVocabularyKey, readonly string[]>;

type KodiCatalog = {
    messages: {
        constant: string;
        id: number;
        sharedKey?: ClientVocabularyKey;
        source?: string;
        translations?: Record<string, string>;
    }[];
};

function valueAt(input: unknown, path: string): unknown {
    let value = input;
    for (const segment of path.split(".")) {
        if ((typeof value !== "object" || value === null) && !Array.isArray(value)) {
            return undefined;
        }
        value = Reflect.get(value, segment);
    }
    return value;
}

function occurrences(source: string, value: string): number {
    return source.split(value).length - 1;
}

function poEntries(relativePath: string): Map<number, { source: string; translation: string }> {
    const content = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
    const entries = new Map<number, { source: string; translation: string }>();
    const pattern =
        /^msgctxt "#(\d+)"\r?\nmsgid ("(?:\\.|[^"\\])*")\r?\nmsgstr ("(?:\\.|[^"\\])*")$/gm;
    for (const match of content.matchAll(pattern)) {
        entries.set(Number(match[1]), {
            source: JSON.parse(match[2]) as string,
            translation: JSON.parse(match[3]) as string,
        });
    }
    return entries;
}

describe("shared client vocabulary", () => {
    it("consumes all 49 bilingual values once without retaining Kodi literals", () => {
        const catalog = JSON.parse(
            fs.readFileSync(
                new URL("../../packages/localization/kodiCatalog.json", import.meta.url),
                "utf8",
            ),
        ) as KodiCatalog;
        const kodiByConstant = new Map(
            catalog.messages.map((message) => [message.constant, message]),
        );
        const sharedMessages = catalog.messages.filter(
            (message) => message.sharedKey !== undefined,
        );
        const english = poEntries(
            "../../apps/kodi/resources/language/resource.language.en_gb/strings.po",
        );
        const german = poEntries(
            "../../apps/kodi/resources/language/resource.language.de_de/strings.po",
        );

        expect(Object.keys(CLIENT_VOCABULARY).sort()).toEqual(Object.keys(WEB_PATHS).sort());
        expect(Object.keys(CLIENT_VOCABULARY)).toHaveLength(49);
        expect(sharedMessages).toHaveLength(49);
        expect(sharedMessages.map((message) => message.sharedKey).sort()).toEqual(
            Object.keys(CLIENT_VOCABULARY).sort(),
        );
        for (const [key, translations] of Object.entries(CLIENT_VOCABULARY)) {
            const kodi = kodiByConstant.get(key);
            expect(kodi, key).toBeDefined();
            expect(kodi?.sharedKey, key).toBe(key);
            expect(kodi).not.toHaveProperty("source");
            expect(kodi).not.toHaveProperty("translations");
            expect(Object.keys(translations).sort()).toEqual([...CLIENT_VOCABULARY_LOCALES].sort());
            expect(english.get(kodi?.id ?? -1), `${key} generated en-GB`).toEqual({
                source: translations["en-GB"],
                translation: translations["en-GB"],
            });
            expect(german.get(kodi?.id ?? -1), `${key} generated de-DE`).toEqual({
                source: translations["en-GB"],
                translation: translations["de-DE"],
            });
        }
    });

    it("uses the shared values at exactly the 62 audited web paths", () => {
        const catalogs = { "en-GB": en, "de-DE": de } as const;
        const sourceByLocale = {
            "en-GB": fs.readFileSync(
                new URL("../../apps/web/src/locales/en.ts", import.meta.url),
                "utf8",
            ),
            "de-DE": fs.readFileSync(
                new URL("../../apps/web/src/locales/de.ts", import.meta.url),
                "utf8",
            ),
        } as const;
        expect(Object.values(WEB_PATHS).flat()).toHaveLength(62);

        for (const [key, paths] of Object.entries(WEB_PATHS) as [
            ClientVocabularyKey,
            readonly string[],
        ][]) {
            for (const locale of ["en-GB", "de-DE"] as const) {
                for (const path of paths) {
                    expect(valueAt(catalogs[locale], path), `${locale} ${path}`).toBe(
                        CLIENT_VOCABULARY[key][locale],
                    );
                }
                expect(
                    occurrences(sourceByLocale[locale], `CLIENT_VOCABULARY.${key}["${locale}"]`),
                    `${locale} ${key} reference count`,
                ).toBe(paths.length);
            }
        }
    });

    it("keeps context-specific Back and Active leaves local", () => {
        expect(WEB_PATHS.BACK).not.toContain("common.previous");
        expect(WEB_PATHS.ACTIVE).not.toContain("account.active");
        expect(en.common.previous).toBe("Back");
        expect(de.common.previous).toBe("Zurück");
        expect(en.account.active).toBe("Active");
        expect(de.account.active).toBe("Aktiv");
    });
});
