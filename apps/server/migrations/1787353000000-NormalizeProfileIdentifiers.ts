import { MigrationInterface, QueryRunner } from "typeorm";

const PROFILE_ID_REPLACEMENTS: Readonly<Record<string, string>> = {
    PROFILE_COLLEAGUES: "PROFILE_ACQUAINTANCES",
    PROFILE_BEST_FRIENDS: "PROFILE_CLOSE_FRIENDS",
    PROFILE_COUPLES: "PROFILE_CLOSE_FRIENDS",
    PROFILE_COUPLES_SPICY: "PROFILE_SPICY",
};

function canonicalProfileId(profileId: unknown): unknown {
    if (typeof profileId !== "string") return profileId;
    return PROFILE_ID_REPLACEMENTS[profileId] ?? profileId;
}

function parseStoredObject(raw: unknown): Record<string, unknown> | undefined {
    if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return undefined;
        }
        return parsed as Record<string, unknown>;
    } catch {
        // Historical sessions can contain an incomplete JSON snapshot after an interrupted write.
        // Profile normalization must preserve such rows rather than blocking every server startup.
        return undefined;
    }
}

async function normalizeColumn(
    queryRunner: QueryRunner,
    table: string,
    idColumn: string,
    jsonColumn: string,
    selectProfileId: (value: Record<string, unknown>) => unknown,
    assignProfileId: (value: Record<string, unknown>, profileId: unknown) => void,
): Promise<void> {
    const rows = (await queryRunner.query(
        `SELECT ${idColumn}, ${jsonColumn} FROM ${table}`,
    )) as Array<Record<string, unknown>>;
    for (const row of rows) {
        const value = parseStoredObject(row[jsonColumn]);
        if (!value) continue;
        const current = selectProfileId(value);
        const canonical = canonicalProfileId(current);
        if (canonical === current) continue;
        assignProfileId(value, canonical);
        await queryRunner.query(`UPDATE ${table} SET ${jsonColumn} = ? WHERE ${idColumn} = ?`, [
            JSON.stringify(value),
            row[idColumn],
        ]);
    }
}

/**
 * Canonicalizes identifiers removed when the built-in profile set was consolidated.
 * This is a persisted-data migration, not a runtime compatibility alias.
 */
export class NormalizeProfileIdentifiers1787353000000 implements MigrationInterface {
    name = "NormalizeProfileIdentifiers1787353000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        for (const [legacy, canonical] of Object.entries(PROFILE_ID_REPLACEMENTS)) {
            await queryRunner.query(
                "UPDATE data_space_game_settings SET preferred_profile_id = ? WHERE preferred_profile_id = ?",
                [canonical, legacy],
            );
            await queryRunner.query(
                "UPDATE game_groups SET preferred_profile_id = ? WHERE preferred_profile_id = ?",
                [canonical, legacy],
            );
        }

        await normalizeColumn(
            queryRunner,
            "rooms",
            "id",
            "game_settings_json",
            (value) => value.profileId,
            (value, profileId) => {
                value.profileId = profileId;
            },
        );
        const runtimeProfileId = (value: Record<string, unknown>) =>
            (value.profile as Record<string, unknown> | undefined)?.id;
        const assignRuntimeProfileId = (value: Record<string, unknown>, profileId: unknown) => {
            const profile = value.profile as Record<string, unknown> | undefined;
            if (profile) profile.id = profileId;
        };
        await normalizeColumn(
            queryRunner,
            "game_sessions",
            "id",
            "runtime_state_json",
            runtimeProfileId,
            assignRuntimeProfileId,
        );
        await normalizeColumn(
            queryRunner,
            "couch_game_sessions",
            "id",
            "runtime_state_json",
            runtimeProfileId,
            assignRuntimeProfileId,
        );
    }

    async down(): Promise<void> {
        // Several removed IDs intentionally converge on one canonical profile. Reversing the
        // normalization would corrupt profiles that were already stored under the canonical ID.
    }
}
