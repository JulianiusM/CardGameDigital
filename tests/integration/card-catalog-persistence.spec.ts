import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataSource } from "typeorm";
import { afterEach, describe, expect, it } from "vitest";
import { CardCatalogVersionEntity } from "../../src/modules/database/entities/card/CardCatalogVersionEntity";
import { CardEntity } from "../../src/modules/database/entities/card/CardEntity";
import { CardLocalizationEntity } from "../../src/modules/database/entities/card/CardLocalizationEntity";
import { LocaleEntity } from "../../src/modules/database/entities/card/LocaleEntity";
import { dataSourceOptions } from "../../src/modules/database/dataSource";
import { resolveSettings } from "../../src/modules/settings";
import { TypeOrmCardRepository } from "../../src/packages/persistence";
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
        second.questionCategories[0].localizations.push({
            locale: "fr-FR",
            label: "Quotidien",
            description: null,
        });
        second.questionCategories[0].localizations[1].label = "Daily life";
        second.cards[0].operationalFlags = ["REQUIRES_PRIVATE_SPACE"];
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
        ).toEqual([{ flag: "REQUIRES_PRIVATE_SPACE" }]);
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

    it("uses exact database Card locales and excludes missing localizations", async () => {
        const db = await database();
        const input = cardCatalog();
        input.cards[0].localizations = [{ locale: "de-DE", text: "Nur Deutsch" }];
        input.questionCategories[0].localizations = [
            { locale: "de-DE", label: "Alltag", description: null },
        ];
        await applyCardCatalogSnapshot(db, catalogArtifact(input));
        const cards = new TypeOrmCardRepository(db.getRepository(CardEntity));
        expect(await cards.isLocaleActive("en-GB")).toBe(true);
        expect(await cards.listActive({ locale: "en-GB", missingTranslation: "EXCLUDE" })).toEqual(
            [],
        );
        expect(
            await cards.listActive({
                locale: "en-GB",
                missingTranslation: "FALLBACK",
                fallbackLocale: "de-DE",
            }),
        ).toHaveLength(1);
    });

    it("soft-retires missing Cards, reactivates their UUID, and never downgrades", async () => {
        const db = await database();
        const first = cardCatalog();
        await applyCardCatalogSnapshot(db, catalogArtifact(first));
        await applyCardCatalogSnapshot(
            db,
            catalogArtifact(cardCatalog({ sequence: 2, catalogVersion: "test-2", cards: [] })),
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
