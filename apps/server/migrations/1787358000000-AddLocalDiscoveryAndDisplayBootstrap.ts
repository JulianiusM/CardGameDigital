import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from "typeorm";

export class AddLocalDiscoveryAndDisplayBootstrap1787358000000 implements MigrationInterface {
    name = "AddLocalDiscoveryAndDisplayBootstrap1787358000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "installation_metadata",
                columns: [
                    { name: "id", type: "int", isPrimary: true },
                    { name: "server_id", type: "varchar", length: "36", isUnique: true },
                    { name: "created_at", type: "datetime" },
                    { name: "identity_schema_version", type: "int", default: 1 },
                ],
            }),
        );

        const roomColumns = [
            new TableColumn({
                name: "bootstrap_mode",
                type: "varchar",
                length: "32",
                default: "'CREATOR_HOST'",
            }),
            new TableColumn({ name: "first_host_assigned_at", type: "datetime", isNullable: true }),
            new TableColumn({ name: "activation_deadline", type: "datetime", isNullable: true }),
            new TableColumn({ name: "activated_at", type: "datetime", isNullable: true }),
            new TableColumn({
                name: "creator_participant_id",
                type: "varchar",
                length: "36",
                isNullable: true,
            }),
        ];
        if (queryRunner.connection.options.type === "better-sqlite3") {
            await queryRunner.query(
                "ALTER TABLE rooms ADD COLUMN bootstrap_mode varchar(32) NOT NULL DEFAULT 'CREATOR_HOST'",
            );
            await queryRunner.query("ALTER TABLE rooms ADD COLUMN first_host_assigned_at datetime");
            await queryRunner.query("ALTER TABLE rooms ADD COLUMN activation_deadline datetime");
            await queryRunner.query("ALTER TABLE rooms ADD COLUMN activated_at datetime");
            await queryRunner.query(
                "ALTER TABLE rooms ADD COLUMN creator_participant_id varchar(36)",
            );
        } else {
            await queryRunner.addColumns("rooms", roomColumns);
        }
        await queryRunner.query(
            `UPDATE rooms
             SET first_host_assigned_at = created_at,
                 activation_deadline = expires_at,
                 activated_at = created_at,
                 creator_participant_id = (
                     SELECT participant.id
                     FROM room_participants participant
                     WHERE participant.room_id = rooms.id
                     ORDER BY participant.created_at ASC, participant.id ASC
                     LIMIT 1
                 )`,
        );

        const participantColumns = [
            new TableColumn({
                name: "active_host_room_id",
                type: "varchar",
                length: "36",
                isNullable: true,
            }),
            new TableColumn({ name: "first_connected_at", type: "datetime", isNullable: true }),
            new TableColumn({ name: "last_connected_at", type: "datetime", isNullable: true }),
            new TableColumn({ name: "reconnect_deadline", type: "datetime", isNullable: true }),
            new TableColumn({ name: "activation_expires_at", type: "datetime", isNullable: true }),
            new TableColumn({ name: "revoked_at", type: "datetime", isNullable: true }),
        ];
        if (queryRunner.connection.options.type === "better-sqlite3") {
            await queryRunner.query(
                "ALTER TABLE room_participants ADD COLUMN active_host_room_id varchar(36)",
            );
            await queryRunner.query(
                "ALTER TABLE room_participants ADD COLUMN first_connected_at datetime",
            );
            await queryRunner.query(
                "ALTER TABLE room_participants ADD COLUMN last_connected_at datetime",
            );
            await queryRunner.query(
                "ALTER TABLE room_participants ADD COLUMN reconnect_deadline datetime",
            );
            await queryRunner.query(
                "ALTER TABLE room_participants ADD COLUMN activation_expires_at datetime",
            );
            await queryRunner.query("ALTER TABLE room_participants ADD COLUMN revoked_at datetime");
        } else {
            await queryRunner.addColumns("room_participants", participantColumns);
        }
        await queryRunner.query(
            `UPDATE room_participants
             SET role = 'PLAYER', active_host_room_id = NULL
             WHERE id IN (
                 SELECT ranked.id
                 FROM (
                     SELECT id,
                            ROW_NUMBER() OVER (
                                PARTITION BY room_id
                                ORDER BY created_at ASC, id ASC
                            ) AS host_rank
                     FROM room_participants
                     WHERE role = 'HOST' AND connection_status <> 'LEFT'
                 ) ranked
                 WHERE ranked.host_rank > 1
             )`,
        );
        await queryRunner.query(
            `UPDATE room_participants
             SET first_connected_at = created_at,
                 last_connected_at = last_seen_at,
                 activation_expires_at = created_at,
                 active_host_room_id = CASE
                     WHEN role = 'HOST' AND connection_status <> 'LEFT' THEN room_id
                     ELSE NULL
                 END`,
        );
        await queryRunner.createIndex(
            "room_participants",
            new TableIndex({
                name: "UQ_room_participant_active_host",
                columnNames: ["active_host_room_id"],
                isUnique: true,
            }),
        );
        await queryRunner.createIndex(
            "room_participants",
            new TableIndex({
                name: "IDX_room_participant_host_fallback",
                columnNames: ["room_id", "role", "connection_status", "created_at", "id"],
            }),
        );
        await queryRunner.createIndex(
            "room_participants",
            new TableIndex({
                name: "IDX_room_participant_reconnect_due",
                columnNames: ["connection_status", "reconnect_deadline"],
            }),
        );
        await queryRunner.createIndex(
            "room_participants",
            new TableIndex({
                name: "IDX_room_participant_activation_due",
                columnNames: ["first_connected_at", "activation_expires_at"],
            }),
        );

        await queryRunner.createTable(
            new Table({
                name: "room_create_idempotency",
                columns: [
                    { name: "id", type: "varchar", length: "36", isPrimary: true },
                    { name: "principal_scope_digest", type: "varchar", length: "64" },
                    { name: "route_key", type: "varchar", length: "80" },
                    { name: "key_digest", type: "varchar", length: "64" },
                    { name: "lookup_key_id", type: "varchar", length: "64", isNullable: true },
                    { name: "request_fingerprint", type: "varchar", length: "64" },
                    { name: "state", type: "varchar", length: "20" },
                    { name: "status_code", type: "int", isNullable: true },
                    { name: "response_schema_version", type: "int", isNullable: true },
                    { name: "response_key_id", type: "varchar", length: "64", isNullable: true },
                    { name: "response_ciphertext", type: "text", isNullable: true },
                    { name: "resource_type", type: "varchar", length: "16", isNullable: true },
                    { name: "resource_id", type: "varchar", length: "36", isNullable: true },
                    {
                        name: "creator_participant_id",
                        type: "varchar",
                        length: "36",
                        isNullable: true,
                    },
                    { name: "created_at", type: "datetime" },
                    { name: "updated_at", type: "datetime" },
                    { name: "tombstone_expires_at", type: "datetime", isNullable: true },
                ],
            }),
        );
        await queryRunner.createIndex(
            "room_create_idempotency",
            new TableIndex({
                name: "UQ_room_create_idempotency_scope_key",
                columnNames: ["principal_scope_digest", "route_key", "key_digest"],
                isUnique: true,
            }),
        );
        await queryRunner.createIndex(
            "room_create_idempotency",
            new TableIndex({
                name: "IDX_room_create_idempotency_tombstone",
                columnNames: ["state", "tombstone_expires_at"],
            }),
        );
        await queryRunner.createIndex(
            "room_create_idempotency",
            new TableIndex({
                name: "IDX_room_create_idempotency_creator",
                columnNames: ["creator_participant_id"],
            }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("room_create_idempotency");
        for (const index of [
            "IDX_room_participant_activation_due",
            "IDX_room_participant_reconnect_due",
            "IDX_room_participant_host_fallback",
            "UQ_room_participant_active_host",
        ]) {
            await queryRunner.dropIndex("room_participants", index);
        }
        for (const column of [
            "revoked_at",
            "activation_expires_at",
            "reconnect_deadline",
            "last_connected_at",
            "first_connected_at",
            "active_host_room_id",
        ]) {
            await queryRunner.dropColumn("room_participants", column);
        }
        for (const column of [
            "creator_participant_id",
            "activated_at",
            "activation_deadline",
            "first_host_assigned_at",
            "bootstrap_mode",
        ]) {
            await queryRunner.dropColumn("rooms", column);
        }
        await queryRunner.dropTable("installation_metadata");
    }
}
