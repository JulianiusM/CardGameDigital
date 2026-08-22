import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataSource } from "typeorm";
import { afterEach, describe, expect, it } from "vitest";
import { applyCardCatalog } from "../../src/packages/application/applyCardCatalog";
import { CARD_TYPES, DARE_TYPES, QUESTION_CATEGORIES } from "../../src/packages/game-core";
import { TypeOrmCardRepository } from "../../src/packages/persistence";
import { CardEntity } from "../../src/modules/database/entities/card/CardEntity";
import { CardSourceEntity } from "../../src/modules/database/entities/card/CardSourceEntity";
import { CardTranslationEntity } from "../../src/modules/database/entities/card/CardTranslationEntity";
import { RawCardImportEntity } from "../../src/modules/database/entities/card/RawCardImportEntity";
import { dataSourceOptions } from "../../src/modules/database/dataSource";
import { resolveSettings } from "../../src/modules/settings";
import { normalizeCards } from "../../src/tooling/card-import/normalize";

let source: DataSource | undefined;
let directory: string | undefined;
afterEach(async () => {
    if (source?.isInitialized) await source.destroy();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

describe("normalized catalog persistence", () => {
    it("applies a validated catalog transactionally and queries independent taxonomies", async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-catalog-"));
        source = new DataSource(
            dataSourceOptions(
                resolveSettings({ DB_FILE: path.join(directory, "catalog.sqlite") }, "/dev/null"),
            ),
        );
        await source.initialize();
        await source.runMigrations({ transaction: "all" });
        const common = {
            Origin: "Spiel",
            OriginCategory: null,
            Intensity: 1,
            AlwaysEligible: false,
            RepeatableInSession: false,
            RepeatCooldown: 0,
            Weight: 1,
            Active: true,
            OperationalFlags: [],
        };
        const catalog = normalizeCards(
            [
                {
                    ...common,
                    ID: 1,
                    CardText: "Ja oder nein?",
                    Type: "Fragen",
                    YesNoAnswerPossible: true,
                    Category: "Alltag",
                    DareType: null,
                },
                {
                    ...common,
                    ID: 2,
                    CardText: "Küsse jemanden",
                    Type: "Pflicht",
                    YesNoAnswerPossible: false,
                    Category: "Beziehung",
                    DareType: "Kuss",
                },
                {
                    ...common,
                    ID: 3,
                    CardText: "Meta",
                    Type: "Gespräch",
                    YesNoAnswerPossible: false,
                    Category: null,
                    DareType: null,
                },
            ],
            "fixture",
            "catalog-1",
            new Date("2026-08-21T00:00:00Z"),
        );

        await applyCardCatalog(source, catalog);
        const repository = new TypeOrmCardRepository(source.getRepository(CardEntity));
        const questions = await repository.findEligibleCandidates(
            {
                cardType: CARD_TYPES.QUESTION,
                questionCategoryIds: [QUESTION_CATEGORIES.EVERYDAY],
                yesNoAnswerPossible: true,
            },
            { locale: "de-DE", missingTranslation: "EXCLUDE" },
        );
        const dares = await repository.findEligibleCandidates(
            {
                cardType: CARD_TYPES.DARE,
                dareTypeIds: [DARE_TYPES.KISS],
            },
            { locale: "de-DE", missingTranslation: "EXCLUDE" },
        );

        expect(questions).toHaveLength(1);
        expect(dares).toHaveLength(1);
        expect(dares[0].dareAffinityCategoryId).toBe(QUESTION_CATEGORIES.RELATIONSHIP);
        expect(await source.getRepository(RawCardImportEntity).count()).toBe(3);
        expect(await source.query("SELECT COUNT(*) AS count FROM question_categories")).toEqual([
            { count: 12 },
        ]);
        expect(await source.query("SELECT COUNT(*) AS count FROM dare_types")).toEqual([
            { count: 13 },
        ]);
    });

    it("keeps source identity stable, stales adaptations, and retires missing cards", async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-reconcile-"));
        source = new DataSource(
            dataSourceOptions(
                resolveSettings({ DB_FILE: path.join(directory, "catalog.sqlite") }, "/dev/null"),
            ),
        );
        await source.initialize();
        await source.runMigrations({ transaction: "all" });
        const raw = {
            ID: "1427",
            CardText: "Was ist dein größter Wunsch?",
            Type: "Fragen",
            Origin: "Access",
            OriginCategory: null,
            YesNoAnswerPossible: false,
            Category: "Alltag",
            DareType: null,
            Intensity: 2,
            AlwaysEligible: false,
            RepeatableInSession: false,
            RepeatCooldown: 0,
            Weight: 1,
            Active: true,
            OperationalFlags: [],
            SourceRevision: 7,
        };
        await applyCardCatalog(source, normalizeCards([raw], "legacy-access-v1", "catalog-7"));
        const mapping = await source.getRepository(CardSourceEntity).findOneByOrFail({
            sourceNamespace: "legacy-access-v1",
            sourceId: "1427",
        });
        await source.getRepository(CardTranslationEntity).save({
            cardId: mapping.cardId,
            locale: "en-GB",
            text: "What is your greatest wish?",
            status: "PUBLISHED",
            revision: 1,
            sourceRevision: 7,
            contentHash: "a".repeat(64),
            updatedAt: new Date(),
        });

        await applyCardCatalog(
            source,
            normalizeCards(
                [{ ...raw, CardText: "Was ist momentan dein größter Wunsch?", SourceRevision: 8 }],
                "legacy-access-v1",
                "catalog-8",
            ),
        );
        const mappingAfterEdit = await source.getRepository(CardSourceEntity).findOneByOrFail({
            sourceNamespace: "legacy-access-v1",
            sourceId: "1427",
        });
        expect(mappingAfterEdit.cardId).toBe(mapping.cardId);
        expect(
            await source.getRepository(CardTranslationEntity).findOneByOrFail({
                cardId: mapping.cardId,
                locale: "en-GB",
            }),
        ).toMatchObject({ status: "STALE", sourceRevision: 7 });
        expect(
            await new TypeOrmCardRepository(source.getRepository(CardEntity)).listActive({
                locale: "en-GB",
                missingTranslation: "EXCLUDE",
            }),
        ).toHaveLength(0);

        await applyCardCatalog(source, normalizeCards([], "legacy-access-v1", "catalog-9"));
        expect(
            await source.getRepository(CardEntity).findOneByOrFail({ id: mapping.cardId }),
        ).toMatchObject({
            active: false,
        });
        expect(
            await source.getRepository(CardTranslationEntity).countBy({ cardId: mapping.cardId }),
        ).toBe(2);
    });

    it("refuses a partial catalog with validation errors by default", async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-catalog-invalid-"));
        source = new DataSource(
            dataSourceOptions(
                resolveSettings({ DB_FILE: path.join(directory, "catalog.sqlite") }, "/dev/null"),
            ),
        );
        await source.initialize();
        await source.runMigrations({ transaction: "all" });
        const catalog = normalizeCards(
            [
                {
                    ID: 1,
                    CardText: "Broken",
                    Type: "Fragen",
                    Origin: "x",
                    YesNoAnswerPossible: false,
                    Category: "unknown",
                },
            ],
            "fixture",
            "bad-1",
        );
        await expect(applyCardCatalog(source, catalog)).rejects.toThrow("Catalog contains");
        expect(await source.getRepository(CardEntity).count()).toBe(0);
    });
});
