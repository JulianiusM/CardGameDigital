import fs from "node:fs";
import * as dotenv from "dotenv";
import mysql from "mysql2/promise";

export type MariaTestProfile = {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
};

export function loadMariaTestProfile(
    file: string,
    prefix: "TEST" | "E2E",
): MariaTestProfile | null {
    const values: Record<string, string | undefined> = {
        ...(fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {}),
    };
    for (const suffix of ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
        const key = `${prefix}_${suffix}`;
        if (process.env[key] !== undefined) values[key] = process.env[key];
    }
    const database = values[`${prefix}_DB_NAME`]?.trim();
    const user = values[`${prefix}_DB_USER`]?.trim();
    const password = values[`${prefix}_DB_PASSWORD`];
    if (!database || !user || password === undefined) return null;
    assertDisposableDatabaseName(database);
    return {
        host: values[`${prefix}_DB_HOST`]?.trim() || "127.0.0.1",
        port: Number(values[`${prefix}_DB_PORT`] ?? 3306),
        user,
        password,
        database,
    };
}

export async function resetMariaTestDatabase(profile: MariaTestProfile): Promise<void> {
    assertDisposableDatabaseName(profile.database);
    const connection = await mysql.createConnection({
        host: profile.host,
        port: profile.port,
        user: profile.user,
        password: profile.password,
    });
    try {
        const database = `\`${profile.database}\``;
        await connection.query(`DROP DATABASE IF EXISTS ${database}`);
        await connection.query(
            `CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        );
    } finally {
        await connection.end();
    }
}

export async function dropMariaTestDatabase(profile: MariaTestProfile): Promise<void> {
    assertDisposableDatabaseName(profile.database);
    const connection = await mysql.createConnection({
        host: profile.host,
        port: profile.port,
        user: profile.user,
        password: profile.password,
    });
    try {
        await connection.query(`DROP DATABASE IF EXISTS \`${profile.database}\``);
    } finally {
        await connection.end();
    }
}

function assertDisposableDatabaseName(database: string): void {
    if (!/^[a-zA-Z0-9_]+$/.test(database) || !/(?:test|e2e)/i.test(database)) {
        throw new Error(
            `Refusing destructive MariaDB reset for non-test database name '${database}'`,
        );
    }
}
