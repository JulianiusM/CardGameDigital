import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataSource } from "typeorm";
import { afterEach, describe, expect, it } from "vitest";
import { dataSourceOptions } from "../../src/modules/database/dataSource";
import { migrations } from "../../src/modules/database/__index__";
import { CardCatalogVersionEntity } from "../../src/modules/database/entities/card/CardCatalogVersionEntity";
import { DataSpaceGameSettingsEntity } from "../../src/modules/database/entities/game/DataSpaceGameSettingsEntity";
import { GroupEntity } from "../../src/modules/database/entities/game/GroupEntity";
import { RoomEntity } from "../../src/modules/database/entities/game/RoomEntity";
import { DataSpace } from "../../src/modules/database/entities/user/DataSpace";
import { resolveSettings } from "../../src/modules/settings";
import { hydrateSessionImmutableState } from "../../src/packages/persistence/sessionImmutablePayloadStore";

let source: DataSource | undefined;
let directory: string | undefined;
afterEach(async () => {
    if (source?.isInitialized) await source.destroy();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

describe("SQLite migration path", () => {
    it("migrates an empty database, enables WAL, and persists a DataSpace", async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-game-sqlite-"));
        const dbFile = path.join(directory, "game.sqlite");
        const settings = resolveSettings({ DB_FILE: dbFile }, "/dev/null");
        source = new DataSource(dataSourceOptions(settings));
        await source.initialize();
        await source.runMigrations({ transaction: "all" });
        await source.query("PRAGMA journal_mode = WAL");

        const repository = source.getRepository(DataSpace);
        await repository.save(repository.create({ name: "Local", defaultForOwner: true }));

        expect(await repository.count()).toBe(1);
        expect((await source.query("PRAGMA journal_mode"))[0].journal_mode).toBe("wal");
        expect(
            await source.query(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='data_spaces'",
            ),
        ).toHaveLength(1);
    });

    it("creates only the fresh account ownership schema", async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-game-schema-"));
        const dbFile = path.join(directory, "schema.sqlite");
        source = new DataSource(
            dataSourceOptions(resolveSettings({ DB_FILE: dbFile }, "/dev/null")),
        );
        await source.initialize();
        await source.runMigrations({ transaction: "all" });

        const columns = await source.query("PRAGMA table_info(data_spaces)");
        expect(columns.map(({ name }: { name: string }) => name)).not.toContain("guest_id");
        expect(
            await source.query(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('guests', 'profiles')",
            ),
        ).toHaveLength(0);
        const gameSettingColumns = await source.query(
            "PRAGMA table_info(data_space_game_settings)",
        );
        expect(gameSettingColumns.map(({ name }: { name: string }) => name)).toEqual(
            expect.arrayContaining([
                "starting_intensity",
                "maximum_intensity",
                "intensity_progression_unit",
                "intensity_progression_interval",
                "intensity_progression_increment",
            ]),
        );
    });

    it("canonicalizes profile IDs stored before the six-profile consolidation", async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-game-profile-migration-"));
        const settings = resolveSettings(
            { DB_FILE: path.join(directory, "profiles.sqlite") },
            "/dev/null",
        );
        const options = dataSourceOptions(settings);
        const normalizationIndex = migrations.findIndex(
            ({ name }) => name === "NormalizeProfileIdentifiers1787353000000",
        );
        expect(normalizationIndex).toBeGreaterThan(0);
        source = new DataSource({
            ...options,
            migrations: migrations.slice(0, normalizationIndex),
        });
        await source.initialize();
        await source.runMigrations({ transaction: "all" });

        const dataSpace = await source
            .getRepository(DataSpace)
            .save({ name: "Profile migration", defaultForOwner: true });
        const group = await source.getRepository(GroupEntity).save({
            id: "10000000-0000-4000-8000-000000000010",
            dataSpaceId: dataSpace.id,
            name: "Legacy group",
            membersJson: "[]",
            createdAt: new Date(),
            updatedAt: new Date(),
            historyResetAt: null,
            preferredProfileId: "PROFILE_COUPLES",
            customConfigurationJson: null,
            cardLanguageSettingsJson: null,
        });
        await source.getRepository(DataSpaceGameSettingsEntity).save({
            dataSpaceId: dataSpace.id,
            preferredProfileId: "PROFILE_BEST_FRIENDS",
            startingIntensity: 1,
            maximumIntensity: 3,
            maximumSocialSensitivity: "PERSONAL",
            intensityProgressionUnit: "CARDS",
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
            randomQuestionRatio: 0.6,
            letsTalkMetaInterval: 5,
            defaultGroupId: group.id,
            customConfigurationJson: null,
            cardLanguageSettingsJson: null,
            updatedAt: new Date(),
        });
        const now = new Date();
        const validRoomId = "10000000-0000-4000-8000-000000000020";
        const invalidRoomId = "10000000-0000-4000-8000-000000000021";
        await source.getRepository(RoomEntity).save([
            {
                id: validRoomId,
                code: "PRFL0001",
                dataSpaceId: null,
                groupId: null,
                settingsRevision: 0,
                gameSettingsJson: JSON.stringify({ profileId: "PROFILE_COLLEAGUES" }),
                settingsUpdatedByParticipantId: null,
                currentSessionId: null,
                createdAt: now,
                expiresAt: new Date(now.getTime() + 60_000),
                closedAt: null,
            },
            {
                id: invalidRoomId,
                code: "PRFL0002",
                dataSpaceId: null,
                groupId: null,
                settingsRevision: 0,
                gameSettingsJson: "",
                settingsUpdatedByParticipantId: null,
                currentSessionId: null,
                createdAt: now,
                expiresAt: new Date(now.getTime() + 60_000),
                closedAt: null,
            },
        ]);
        const invalidRuntimeId = "10000000-0000-4000-8000-000000000022";
        await source.query(
            `INSERT INTO couch_game_sessions
             (id, data_space_id, group_id, mode, revision, runtime_state_version,
              runtime_state_json, started_at, ended_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                invalidRuntimeId,
                null,
                null,
                "TRUTH_OR_DARE",
                0,
                4,
                '{"profile":',
                now.toISOString(),
                now.toISOString(),
            ],
        );
        await source.destroy();

        source = new DataSource({
            ...options,
            migrations: [migrations[normalizationIndex]],
        });
        await source.initialize();
        await source.runMigrations({ transaction: "all" });

        await expect(
            source.getRepository(DataSpaceGameSettingsEntity).findOneByOrFail({
                dataSpaceId: dataSpace.id,
            }),
        ).resolves.toMatchObject({ preferredProfileId: "PROFILE_CLOSE_FRIENDS" });
        await expect(
            source.getRepository(GroupEntity).findOneByOrFail({ id: group.id }),
        ).resolves.toMatchObject({ preferredProfileId: "PROFILE_CLOSE_FRIENDS" });
        await expect(
            source.getRepository(RoomEntity).findOneByOrFail({ id: validRoomId }),
        ).resolves.toMatchObject({
            gameSettingsJson: JSON.stringify({ profileId: "PROFILE_ACQUAINTANCES" }),
        });
        await expect(
            source.getRepository(RoomEntity).findOneByOrFail({ id: invalidRoomId }),
        ).resolves.toMatchObject({ gameSettingsJson: "" });
        const [invalidRuntime] = await source.query(
            "SELECT runtime_state_json FROM couch_game_sessions WHERE id = ?",
            [invalidRuntimeId],
        );
        expect(invalidRuntime.runtime_state_json).toBe('{"profile":');
    });

    it("removes truncated Sessions while preserving valid runtime JSON beyond TEXT size", async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-game-runtime-storage-"));
        const options = dataSourceOptions(
            resolveSettings({ DB_FILE: path.join(directory, "runtime.sqlite") }, "/dev/null"),
        );
        const expansionIndex = migrations.findIndex(
            ({ name }) => name === "ExpandSessionRuntimeStorage1787354000000",
        );
        expect(expansionIndex).toBeGreaterThan(0);
        source = new DataSource({ ...options, migrations: migrations.slice(0, expansionIndex) });
        await source.initialize();
        await source.runMigrations({ transaction: "all" });

        const now = new Date();
        const roomId = "20000000-0000-4000-8000-000000000001";
        const corruptRoomSessionId = "20000000-0000-4000-8000-000000000002";
        const corruptCouchSessionId = "20000000-0000-4000-8000-000000000003";
        const largeCouchSessionId = "20000000-0000-4000-8000-000000000004";
        await source.getRepository(RoomEntity).save({
            id: roomId,
            code: "JSON0001",
            dataSpaceId: null,
            groupId: null,
            settingsRevision: 0,
            gameSettingsJson: JSON.stringify({ profileId: "PROFILE_FRIENDS" }),
            settingsUpdatedByParticipantId: null,
            currentSessionId: null,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 60_000),
            closedAt: null,
        });
        await source.query(
            `INSERT INTO game_sessions
             (id, room_id, group_id, mode, revision, runtime_state_version,
              runtime_state_json, started_at, ended_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                corruptRoomSessionId,
                roomId,
                null,
                "RANDOM_TRUTH_OR_DARE",
                0,
                4,
                '{"version":4',
                now.toISOString(),
                null,
            ],
        );
        await source
            .getRepository(RoomEntity)
            .update({ id: roomId }, { currentSessionId: corruptRoomSessionId });
        for (const [id, runtimeStateJson] of [
            [corruptCouchSessionId, ""],
            [largeCouchSessionId, JSON.stringify({ padding: "x".repeat(70_000) })],
        ]) {
            await source.query(
                `INSERT INTO couch_game_sessions
                 (id, data_space_id, group_id, mode, revision, runtime_state_version,
                  runtime_state_json, started_at, ended_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    null,
                    null,
                    "RANDOM_TRUTH_OR_DARE",
                    0,
                    4,
                    runtimeStateJson,
                    now.toISOString(),
                    null,
                ],
            );
        }
        await source.destroy();

        source = new DataSource({ ...options, migrations: [migrations[expansionIndex]] });
        await source.initialize();
        await source.runMigrations({ transaction: "all" });

        await expect(
            source.getRepository(RoomEntity).findOneByOrFail({ id: roomId }),
        ).resolves.toMatchObject({ currentSessionId: null });
        expect(
            await source.query("SELECT id FROM game_sessions WHERE id = ?", [corruptRoomSessionId]),
        ).toHaveLength(0);
        expect(
            await source.query("SELECT id FROM couch_game_sessions WHERE id = ?", [
                corruptCouchSessionId,
            ]),
        ).toHaveLength(0);
        const [largeRuntime] = await source.query(
            "SELECT runtime_state_json FROM couch_game_sessions WHERE id = ?",
            [largeCouchSessionId],
        );
        expect(largeRuntime.runtime_state_json.length).toBeGreaterThan(65_535);
    });

    it("compacts runtime-v4 Card policy snapshots into packet-safe runtime v5", async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-game-runtime-compact-"));
        const options = dataSourceOptions(
            resolveSettings({ DB_FILE: path.join(directory, "compact.sqlite") }, "/dev/null"),
        );
        const compactIndex = migrations.findIndex(
            ({ name }) => name === "CompactSessionCardPolicy1787356000000",
        );
        expect(compactIndex).toBeGreaterThan(0);
        source = new DataSource({ ...options, migrations: migrations.slice(0, compactIndex) });
        await source.initialize();
        await source.runMigrations({ transaction: "all" });

        const id = "25000000-0000-4000-8000-000000000001";
        const legacyCards = Object.fromEntries(
            Array.from({ length: 1_940 }, (_, index) => [
                `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
                {
                    policyAvailable: true,
                    alwaysEligible: index % 2 === 0,
                    repeatableInSession: false,
                    repeatCooldown: 0,
                    intensity: (index % 5) + 1,
                    weight: 1,
                    socialSensitivity: "GENERAL",
                    minimumPlayerCount: 2,
                    maximumPlayerCount: null,
                    provenance: {
                        availability: "Catalog",
                        alwaysEligible: "DataSpace Scope Default",
                    },
                },
            ]),
        );
        const legacyRuntime = JSON.stringify({
            version: 4,
            groupHistoryCardIds: Object.keys(legacyCards),
            compiledCardPolicy: {
                catalog: {
                    catalogId: "core",
                    sequence: 6,
                    catalogVersion: "2026.08.25-1",
                    contract: "game-card-catalog/v2",
                    artifactDigest: "a".repeat(64),
                },
                policyRevisions: { dataSpace: 1, group: 0 },
                cards: legacyCards,
            },
        });
        await source.query(
            `INSERT INTO couch_game_sessions
             (id, data_space_id, group_id, mode, revision, runtime_state_version,
              runtime_state_json, started_at, ended_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                null,
                null,
                "RANDOM_TRUTH_OR_DARE",
                0,
                4,
                legacyRuntime,
                new Date().toISOString(),
                null,
            ],
        );
        await source.destroy();

        source = new DataSource({ ...options, migrations: [migrations[compactIndex]] });
        await source.initialize();
        await source.runMigrations({ transaction: "all" });

        const [stored] = await source.query(
            `SELECT runtime_state_version, runtime_state_json
             FROM couch_game_sessions WHERE id = ?`,
            [id],
        );
        const runtime = JSON.parse(stored.runtime_state_json);
        expect(stored.runtime_state_version).toBe(5);
        expect(runtime.version).toBe(5);
        expect(runtime.compiledCardPolicy.cards).toHaveLength(1_940);
        expect(runtime.compiledCardPolicy.cards[0]).toEqual([
            "00000000-0000-4000-8000-000000000000",
            3,
            0,
            1,
            1,
            0,
            2,
            null,
        ]);
        expect(stored.runtime_state_json).not.toContain("provenance");
        expect(Buffer.byteLength(stored.runtime_state_json, "utf8")).toBeLessThan(
            Buffer.byteLength(legacyRuntime, "utf8") / 3,
        );

        const externalizationIndex = migrations.findIndex(
            ({ name }) => name === "ExternalizeSessionImmutableState1787357000000",
        );
        expect(externalizationIndex).toBeGreaterThan(compactIndex);
        await source.destroy();
        source = new DataSource({
            ...options,
            migrations: [migrations[externalizationIndex]],
        });
        await source.initialize();
        await source.runMigrations({ transaction: "all" });

        const [externalized] = await source.query(
            `SELECT runtime_state_json, compiled_card_policy_digest, group_history_digest
             FROM couch_game_sessions WHERE id = ?`,
            [id],
        );
        const externalizedRuntime = JSON.parse(externalized.runtime_state_json);
        expect(externalizedRuntime.compiledCardPolicy).toBeNull();
        expect(externalizedRuntime.groupHistoryCardIds).toEqual([]);
        expect(externalized.compiled_card_policy_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(externalized.group_history_digest).toMatch(/^[a-f0-9]{64}$/);
        const chunks = await source.query(
            `SELECT chunk_index, payload_base64
             FROM session_immutable_payload_chunks
             WHERE payload_digest = ? ORDER BY chunk_index`,
            [externalized.compiled_card_policy_digest],
        );
        expect(chunks.length).toBeGreaterThanOrEqual(1);
        expect(
            chunks.every(
                ({ payload_base64 }: { payload_base64: string }) =>
                    Buffer.byteLength(payload_base64, "utf8") <= 32_768,
            ),
        ).toBe(true);
        const hydrated = await hydrateSessionImmutableState(
            source.manager,
            externalized.runtime_state_json,
            {
                compiledCardPolicyDigest: externalized.compiled_card_policy_digest,
                groupHistoryDigest: externalized.group_history_digest,
            },
        );
        expect(hydrated.compiledCardPolicy?.cards).toHaveLength(1_940);
        expect(hydrated.groupHistoryCardIds).toHaveLength(1_940);
    });

    it("rebases Groups that predate the installed Card catalog", async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-game-history-rebase-"));
        const options = dataSourceOptions(
            resolveSettings({ DB_FILE: path.join(directory, "history.sqlite") }, "/dev/null"),
        );
        const rebaseIndex = migrations.findIndex(
            ({ name }) => name === "RebaseGroupHistoryOnCatalog1787355000000",
        );
        expect(rebaseIndex).toBeGreaterThan(0);
        source = new DataSource({ ...options, migrations: migrations.slice(0, rebaseIndex) });
        await source.initialize();
        await source.runMigrations({ transaction: "all" });

        const dataSpace = await source
            .getRepository(DataSpace)
            .save({ name: "History rebase", defaultForOwner: true });
        const groupId = "30000000-0000-4000-8000-000000000001";
        await source.getRepository(GroupEntity).save({
            id: groupId,
            dataSpaceId: dataSpace.id,
            name: "Pre-catalog Group",
            membersJson: "[]",
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            updatedAt: new Date("2026-08-01T00:00:00.000Z"),
            historyResetAt: null,
            preferredProfileId: "PROFILE_FRIENDS",
            customConfigurationJson: null,
            cardLanguageSettingsJson: null,
        });
        const catalogAppliedAt = new Date("2026-08-25T18:46:59.000Z");
        await source.getRepository(CardCatalogVersionEntity).save({
            catalogId: "core",
            sequence: 1,
            contract: "game-card-catalog/v2",
            catalogVersion: "2026.08.25-1",
            artifactDigest: "a".repeat(64),
            generatedAt: catalogAppliedAt,
            appliedAt: catalogAppliedAt,
            defaultLocale: "de-DE",
            cardCount: 1_940,
            localeCount: 2,
        });
        await source.destroy();

        source = new DataSource({ ...options, migrations: [migrations[rebaseIndex]] });
        await source.initialize();
        await source.runMigrations({ transaction: "all" });

        const rebased = await source.getRepository(GroupEntity).findOneByOrFail({ id: groupId });
        expect(rebased.historyResetAt?.getTime()).toBe(catalogAppliedAt.getTime());
    });
});
