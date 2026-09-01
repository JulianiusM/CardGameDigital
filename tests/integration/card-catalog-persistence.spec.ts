import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataSource } from "typeorm";
import { afterEach, describe, expect, it } from "vitest";
import { CardCatalogVersionEntity } from "../../src/modules/database/entities/card/CardCatalogVersionEntity";
import { CardEntity } from "../../src/modules/database/entities/card/CardEntity";
import { CardLocalizationEntity } from "../../src/modules/database/entities/card/CardLocalizationEntity";
import { LocaleEntity } from "../../src/modules/database/entities/card/LocaleEntity";
import { QuestionCategoryEntity } from "../../src/modules/database/entities/card/QuestionCategoryEntity";
import { DataSpaceGameSettingsEntity } from "../../src/modules/database/entities/game/DataSpaceGameSettingsEntity";
import { GroupEntity } from "../../src/modules/database/entities/game/GroupEntity";
import { DataSpace } from "../../src/modules/database/entities/user/DataSpace";
import { dataSourceOptions } from "../../src/modules/database/dataSource";
import { resolveSettings } from "../../src/modules/settings";
import { TypeOrmCardPolicyRepository, TypeOrmCardRepository } from "../../src/packages/persistence";
import { applyCardCatalogSnapshot } from "../../src/packages/persistence/applyCardCatalogSnapshot";
import { cardCatalog, catalogArtifact } from "../support/cardCatalog";

let source: DataSource | undefined;
let directory: string | undefined;

async function database(): Promise<DataSource> {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-catalog-"));
    source = new DataSource(
        dataSourceOptions(
            resolveSettings({ DB_FILE: path.join(directory, "catalog.sqlite") }, "/dev/null"),
        ),
    );
    await source.initialize();
    await source.runMigrations({ transaction: "all" });
    return source;
}

afterEach(async () => {
    if (source?.isInitialized) await source.destroy();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    source = undefined;
    directory = undefined;
});

describe("bundled Card catalog FULL reconciliation", () => {
    it("populates Cards, locales, taxonomy labels and exact localizations", async () => {
        const db = await database();
        await expect(applyCardCatalogSnapshot(db, catalogArtifact(cardCatalog()))).resolves.toBe(
            "APPLIED",
        );
        expect(await db.getRepository(CardEntity).count()).toBe(1);
        expect(await db.getRepository(CardLocalizationEntity).count()).toBe(2);
        expect(
            await db.getRepository(LocaleEntity).findOneByOrFail({ isDefault: true }),
        ).toMatchObject({ id: "de-DE", displayName: "Deutsch", active: true });
        expect(
            await db.query("SELECT label FROM question_category_translations WHERE locale = ?", [
                "en-GB",
            ]),
        ).toEqual([{ label: "Everyday" }]);
    });

    it("keeps the complete filtered Card-search total across cursor pages", async () => {
        const db = await database();
        const input = cardCatalog();
        const sourceCard = input.cards[0];
        input.cards = Array.from({ length: 5 }, (_, index) => ({
            ...structuredClone(sourceCard),
            id: `10000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
            localizations: sourceCard.localizations.map((localization) => ({
                ...localization,
                text: `${localization.text} search match ${index + 1}`,
            })),
        }));
        await applyCardCatalogSnapshot(db, catalogArtifact(input));

        const repository = new TypeOrmCardPolicyRepository(db);
        const search = { locale: "en-GB", query: "search match", limit: 2 };
        const firstPage = await repository.searchCards(search);
        expect(firstPage.cards).toHaveLength(2);
        expect(firstPage.total).toBe(5);
        expect(firstPage.nextCursor).toBeTypeOf("string");

        const nextPage = await repository.searchCards({
            ...search,
            cursor: firstPage.nextCursor!,
        });
        expect(nextPage.cards).toHaveLength(2);
        expect(nextPage.total).toBe(firstPage.total);
        expect(nextPage.cards.map(({ id }) => id)).not.toEqual(firstPage.cards.map(({ id }) => id));

        const previousPage = await repository.searchCards(search);
        expect(previousPage.total).toBe(firstPage.total);
        expect(previousPage.cards.map(({ id }) => id)).toEqual(firstPage.cards.map(({ id }) => id));
    });

    it("is idempotent and enforces immutable sequence bytes", async () => {
        const db = await database();
        const input = cardCatalog();
        const artifact = catalogArtifact(input);
        await applyCardCatalogSnapshot(db, artifact);
        await expect(applyCardCatalogSnapshot(db, artifact)).resolves.toBe("UNCHANGED");
        expect(await db.getRepository(CardCatalogVersionEntity).count()).toBe(1);
        await expect(
            applyCardCatalogSnapshot(db, catalogArtifact({ ...input, catalogVersion: "changed" })),
        ).rejects.toThrow("different bytes");
        await expect(
            applyCardCatalogSnapshot(db, catalogArtifact({ ...input, sequence: 2 })),
        ).rejects.toThrow("version 'test-1' was reused");
    });

    it("continues sequence ordering across the immutable v1 to v2 cutover", async () => {
        const db = await database();
        const versions = db.getRepository(CardCatalogVersionEntity);
        const appliedAt = new Date("2026-08-01T00:00:00.000Z");
        await versions.insert({
            catalogId: "core",
            sequence: 7,
            contract: "game-card-catalog/v1",
            catalogVersion: "2026.08.01-1",
            artifactDigest: "a".repeat(64),
            generatedAt: appliedAt,
            appliedAt,
            defaultLocale: "de-DE",
            cardCount: 1,
            localeCount: 1,
        });

        await expect(
            applyCardCatalogSnapshot(
                db,
                catalogArtifact(cardCatalog({ sequence: 8, catalogVersion: "2026.09.01-1" })),
            ),
        ).resolves.toBe("APPLIED");
        expect(
            (await versions.find({ order: { sequence: "ASC" } })).map(({ sequence, contract }) => ({
                sequence,
                contract,
            })),
        ).toEqual([
            { sequence: 7, contract: "game-card-catalog/v1" },
            { sequence: 8, contract: "game-card-catalog/v2" },
        ]);
    });

    it("replaces a higher-sequence development fixture with the first producer release", async () => {
        const db = await database();
        const versions = db.getRepository(CardCatalogVersionEntity);
        const appliedAt = new Date("2026-08-01T00:00:00.000Z");
        await versions.insert({
            catalogId: "development",
            sequence: 1,
            contract: "game-card-catalog/v1",
            catalogVersion: "development-fixture-1",
            artifactDigest: "a".repeat(64),
            generatedAt: appliedAt,
            appliedAt,
            defaultLocale: "de-DE",
            cardCount: 4,
            localeCount: 2,
        });
        const fixture = cardCatalog({
            sequence: 20,
            catalogVersion: "development-fixture-20",
        });
        const release = cardCatalog({
            sequence: 1,
            catalogVersion: "2026.08.25-1",
        });

        await expect(applyCardCatalogSnapshot(db, catalogArtifact(fixture))).resolves.toBe(
            "APPLIED",
        );
        await expect(applyCardCatalogSnapshot(db, catalogArtifact(release))).resolves.toBe(
            "APPLIED",
        );

        expect(
            await versions.find({
                order: { sequence: "ASC" },
            }),
        ).toMatchObject([
            {
                catalogId: "core",
                sequence: 1,
                catalogVersion: "2026.08.25-1",
            },
        ]);
        await expect(applyCardCatalogSnapshot(db, catalogArtifact(release))).resolves.toBe(
            "UNCHANGED",
        );
        await expect(applyCardCatalogSnapshot(db, catalogArtifact(fixture))).resolves.toBe(
            "NEWER_INSTALLED",
        );
    });

    it("updates text without changing UUID and soft-disables/re-enables localizations", async () => {
        const db = await database();
        const first = cardCatalog();
        first.cards[0].operationalFlags = ["INVOLVES_ALCOHOL"];
        await applyCardCatalogSnapshot(db, catalogArtifact(first));
        const second = cardCatalog({ sequence: 2, catalogVersion: "test-2" });
        second.cards[0].localizations = [
            { locale: "de-DE", text: "Geänderter Text" },
            { locale: "fr-FR", text: "Une question" },
        ];
        second.locales.push({ id: "fr-FR", nativeName: "Français", active: true });
        second.taxonomy.questionCategories[0].localizations.push({
            locale: "fr-FR",
            label: "Quotidien",
            description: null,
        });
        second.taxonomy.questionCategories[0].localizations[1].label = "Daily life";
        second.cards[0].operationalFlags = ["REQUIRES_PHYSICAL_CONTACT"];
        await applyCardCatalogSnapshot(db, catalogArtifact(second));
        expect(
            await db.getRepository(CardEntity).findOneByOrFail({ id: first.cards[0].id }),
        ).toMatchObject({ id: first.cards[0].id });
        expect(
            await db.getRepository(CardLocalizationEntity).findOneByOrFail({
                cardId: first.cards[0].id,
                locale: "en-GB",
            }),
        ).toMatchObject({ active: false, text: "A question" });
        expect(
            await db.getRepository(CardLocalizationEntity).findOneByOrFail({
                cardId: first.cards[0].id,
                locale: "fr-FR",
            }),
        ).toMatchObject({ active: true, text: "Une question" });
        expect(
            await db.query("SELECT flag FROM card_operational_flags WHERE card_id = ?", [
                first.cards[0].id,
            ]),
        ).toEqual([{ flag: "REQUIRES_PHYSICAL_CONTACT" }]);
        expect(
            await db.query(
                "SELECT label FROM question_category_translations WHERE category_id = ? AND locale = ?",
                ["CAT_EVERYDAY", "en-GB"],
            ),
        ).toEqual([{ label: "Daily life" }]);

        const third = cardCatalog({ sequence: 3, catalogVersion: "test-3" });
        await applyCardCatalogSnapshot(db, catalogArtifact(third));
        expect(
            await db.getRepository(CardLocalizationEntity).findOneByOrFail({
                cardId: first.cards[0].id,
                locale: "en-GB",
            }),
        ).toMatchObject({ active: true, text: "A question" });
        expect(await db.getRepository(LocaleEntity).findOneByOrFail({ id: "fr-FR" })).toMatchObject(
            { active: false, isDefault: false },
        );
    });

    it("removes saved Card-language choices that the incoming catalog no longer offers", async () => {
        const db = await database();
        await applyCardCatalogSnapshot(db, catalogArtifact(cardCatalog()));
        const dataSpace = await db
            .getRepository(DataSpace)
            .save({ name: "Catalog locale", defaultForOwner: true });
        await db.getRepository(DataSpaceGameSettingsEntity).save({
            dataSpaceId: dataSpace.id,
            preferredProfileId: "PROFILE_FRIENDS",
            startingIntensity: 1,
            maximumIntensity: 3,
            maximumSocialSensitivity: "PERSONAL",
            intensityProgressionUnit: "CARDS",
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
            randomQuestionRatio: 0.6,
            letsTalkMetaInterval: 5,
            defaultGroupId: null,
            customConfigurationJson: null,
            cardLanguageSettingsJson: JSON.stringify({
                cardLocale: "en-GB",
                cardFallbackEnabled: true,
                cardFallbackLocales: ["de-DE"],
            }),
            updatedAt: new Date(),
        });
        const group = await db.getRepository(GroupEntity).save({
            id: "10000000-0000-4000-8000-000000000020",
            dataSpaceId: dataSpace.id,
            name: "Catalog locale group",
            membersJson: "[]",
            createdAt: new Date(),
            updatedAt: new Date(),
            historyResetAt: null,
            preferredProfileId: "PROFILE_FRIENDS",
            customConfigurationJson: null,
            cardLanguageSettingsJson: JSON.stringify({
                cardLocale: "de-DE",
                cardFallbackEnabled: true,
                cardFallbackLocales: ["en-GB"],
            }),
        });

        const next = cardCatalog({ sequence: 2, catalogVersion: "test-2" });
        next.locales = next.locales.filter(({ id }) => id === "de-DE");
        next.cards[0].localizations = next.cards[0].localizations.filter(
            ({ locale }) => locale === "de-DE",
        );
        next.taxonomy.questionCategories[0].localizations =
            next.taxonomy.questionCategories[0].localizations.filter(
                ({ locale }) => locale === "de-DE",
            );
        next.taxonomy.dareTypes[0].localizations = next.taxonomy.dareTypes[0].localizations.filter(
            ({ locale }) => locale === "de-DE",
        );
        await applyCardCatalogSnapshot(db, catalogArtifact(next));

        expect(
            await db.getRepository(DataSpaceGameSettingsEntity).findOneByOrFail({
                dataSpaceId: dataSpace.id,
            }),
        ).toMatchObject({ cardLanguageSettingsJson: null });
        expect(
            JSON.parse(
                (await db.getRepository(GroupEntity).findOneByOrFail({ id: group.id }))
                    .cardLanguageSettingsJson!,
            ),
        ).toEqual({
            cardLocale: "de-DE",
            cardFallbackEnabled: false,
            cardFallbackLocales: [],
        });
    });

    it("starts a fresh Group history epoch only when the catalog lineage changes", async () => {
        const db = await database();
        await applyCardCatalogSnapshot(
            db,
            catalogArtifact(
                cardCatalog({
                    sequence: 20,
                    catalogVersion: "development-fixture-20",
                }),
            ),
        );
        const dataSpace = await db
            .getRepository(DataSpace)
            .save({ name: "Catalog history", defaultForOwner: true });
        const group = await db.getRepository(GroupEntity).save({
            id: "10000000-0000-4000-8000-000000000030",
            dataSpaceId: dataSpace.id,
            name: "Catalog history group",
            membersJson: "[]",
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            updatedAt: new Date("2026-08-01T00:00:00.000Z"),
            historyResetAt: null,
            preferredProfileId: "PROFILE_FRIENDS",
            customConfigurationJson: null,
            cardLanguageSettingsJson: null,
        });
        const beforeReplacement = Date.now();
        await expect(
            applyCardCatalogSnapshot(
                db,
                catalogArtifact(
                    cardCatalog({
                        sequence: 1,
                        catalogVersion: "2026.08.25-1",
                    }),
                ),
            ),
        ).resolves.toBe("APPLIED");

        const rebased = await db.getRepository(GroupEntity).findOneByOrFail({ id: group.id });
        expect(rebased.historyResetAt?.getTime()).toBeGreaterThanOrEqual(beforeReplacement);

        const currentGroup = await db.getRepository(GroupEntity).save({
            ...group,
            id: "10000000-0000-4000-8000-000000000031",
            name: "Current catalog group",
            createdAt: new Date(),
            updatedAt: new Date(),
            historyResetAt: null,
        });
        await expect(
            applyCardCatalogSnapshot(
                db,
                catalogArtifact(cardCatalog({ sequence: 2, catalogVersion: "2026.08.26-1" })),
            ),
        ).resolves.toBe("APPLIED");
        await expect(
            db.getRepository(GroupEntity).findOneByOrFail({ id: currentGroup.id }),
        ).resolves.toMatchObject({ historyResetAt: null });
    });

    it("persists effective taxonomy defaults and recalculates inherited Card baselines", async () => {
        const db = await database();
        const categories = db.getRepository(QuestionCategoryEntity);
        const cards = db.getRepository(CardEntity);
        const first = cardCatalog();
        await applyCardCatalogSnapshot(db, catalogArtifact(first));

        expect(await categories.findOneByOrFail({ id: "CAT_EVERYDAY" })).toMatchObject({
            defaultSocialSensitivity: "PERSONAL",
            defaultMinimumPlayerCount: 2,
            defaultMaximumPlayerCount: null,
        });
        expect(await cards.findOneByOrFail({ id: first.cards[0].id })).toMatchObject({
            socialSensitivity: "PERSONAL",
            minimumPlayerCount: 2,
            maximumPlayerCount: null,
        });

        const second = cardCatalog({ sequence: 2, catalogVersion: "test-2" });
        second.taxonomy.questionCategories[0].defaultSocialSensitivity = "DEEP_PERSONAL";
        second.taxonomy.questionCategories[0].defaultMinimumPlayerCount = 3;
        second.taxonomy.questionCategories[0].defaultMaximumPlayerCount = 7;
        second.cards[0].socialSensitivity = "EXPLICIT";
        second.cards[0].minimumPlayerCount = 4;
        second.cards[0].maximumPlayerCount = null;
        await applyCardCatalogSnapshot(db, catalogArtifact(second));

        expect(await categories.findOneByOrFail({ id: "CAT_EVERYDAY" })).toMatchObject({
            defaultSocialSensitivity: "DEEP_PERSONAL",
            defaultMinimumPlayerCount: 3,
            defaultMaximumPlayerCount: 7,
        });
        expect(await cards.findOneByOrFail({ id: second.cards[0].id })).toMatchObject({
            socialSensitivity: "EXPLICIT",
            minimumPlayerCount: 4,
            maximumPlayerCount: null,
        });

        const third = cardCatalog({ sequence: 3, catalogVersion: "test-3" });
        third.taxonomy.questionCategories[0].defaultSocialSensitivity = "INTIMATE";
        third.taxonomy.questionCategories[0].defaultMinimumPlayerCount = 5;
        third.taxonomy.questionCategories[0].defaultMaximumPlayerCount = 6;
        await applyCardCatalogSnapshot(db, catalogArtifact(third));

        expect(await cards.findOneByOrFail({ id: third.cards[0].id })).toMatchObject({
            socialSensitivity: "INTIMATE",
            minimumPlayerCount: 5,
            maximumPlayerCount: 6,
        });
    });

    it("uses exact database Card locales and excludes missing localizations", async () => {
        const db = await database();
        const input = cardCatalog();
        input.locales.push({ id: "fr-FR", nativeName: "Français", active: true });
        input.cards[0].localizations = [
            { locale: "de-DE", text: "Nur Deutsch" },
            { locale: "fr-FR", text: "Seulement français" },
        ];
        input.taxonomy.questionCategories[0].localizations = [
            { locale: "de-DE", label: "Alltag", description: null },
            { locale: "fr-FR", label: "Quotidien", description: null },
        ];
        input.taxonomy.dareTypes[0].localizations.push({
            locale: "fr-FR",
            label: "Drôle",
            description: null,
        });
        await applyCardCatalogSnapshot(db, catalogArtifact(input));
        const cards = new TypeOrmCardRepository(db.getRepository(CardEntity));
        expect(await cards.isLocaleActive("en-GB")).toBe(true);
        expect(await cards.listActive({ locale: "en-GB", missingTranslation: "EXCLUDE" })).toEqual(
            [],
        );
        expect(
            (
                await cards.listActive({
                    locale: "en-GB",
                    missingTranslation: "FALLBACK",
                    fallbackLocales: ["fr-FR", "de-DE"],
                })
            )[0].cardText,
        ).toBe("Seulement français");
    });

    it("soft-retires missing Cards, reactivates their UUID, and never downgrades", async () => {
        const db = await database();
        const first = cardCatalog();
        const retained = structuredClone(first.cards[0]);
        retained.id = "10000000-0000-4000-8000-000000000002";
        retained.localizations = [
            { locale: "de-DE", text: "Eine zweite Frage" },
            { locale: "en-GB", text: "A second question" },
        ];
        first.cards.push(retained);
        await applyCardCatalogSnapshot(db, catalogArtifact(first));
        await applyCardCatalogSnapshot(
            db,
            catalogArtifact(
                cardCatalog({
                    sequence: 2,
                    catalogVersion: "test-2",
                    cards: [retained],
                }),
            ),
        );
        expect(
            await db.getRepository(CardEntity).findOneByOrFail({ id: first.cards[0].id }),
        ).toMatchObject({ active: false });
        expect(
            await db.getRepository(CardLocalizationEntity).countBy({ cardId: first.cards[0].id }),
        ).toBe(2);
        await applyCardCatalogSnapshot(
            db,
            catalogArtifact(cardCatalog({ sequence: 3, catalogVersion: "test-3" })),
        );
        expect(
            await db.getRepository(CardEntity).findOneByOrFail({ id: first.cards[0].id }),
        ).toMatchObject({ active: true });
        await expect(
            applyCardCatalogSnapshot(
                db,
                catalogArtifact(cardCatalog({ sequence: 2, catalogVersion: "old" })),
            ),
        ).resolves.toBe("NEWER_INSTALLED");
    });

    it("rolls back every mutation when reconciliation fails halfway", async () => {
        const db = await database();
        await applyCardCatalogSnapshot(db, catalogArtifact(cardCatalog()));
        const broken = catalogArtifact(cardCatalog({ sequence: 2, catalogVersion: "test-2" }));
        broken.catalog.locales[0].nativeName = "Mutated before failure";
        (broken.catalog.cards[0] as { cardType: string | null }).cardType = null;
        await expect(applyCardCatalogSnapshot(db, broken)).rejects.toThrow();
        expect(await db.getRepository(LocaleEntity).findOneByOrFail({ id: "de-DE" })).toMatchObject(
            { displayName: "Deutsch" },
        );
        expect(await db.getRepository(CardCatalogVersionEntity).count()).toBe(1);
    });
});
