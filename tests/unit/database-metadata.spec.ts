import { DataSource, type DataSourceOptions } from "typeorm";
import { describe, expect, it } from "vitest";
import { entities } from "../../apps/server/src/modules/database/__index__";

class MetadataDataSource extends DataSource {
    async validateEntityMetadata(): Promise<void> {
        await this.buildMetadatas();
    }
}

function metadataOptions(type: "better-sqlite3" | "mariadb" | "mysql"): DataSourceOptions {
    if (type === "better-sqlite3") {
        return { type, database: ":memory:", entities };
    }
    return {
        type,
        host: "127.0.0.1",
        username: "metadata-only",
        database: "metadata-only",
        entities,
    };
}

describe("database entity metadata", () => {
    it.each(["better-sqlite3", "mariadb", "mysql"] as const)(
        "is valid for the %s driver without opening a connection",
        async (type) => {
            const source = new MetadataDataSource(metadataOptions(type));

            await expect(source.validateEntityMetadata()).resolves.toBeUndefined();
            for (const entity of source.entityMetadatas) {
                for (const column of entity.columns) {
                    if (
                        /^(?:tiny|medium|long)?(?:text|blob)$|^(?:json|simple-json|geometry)$/.test(
                            String(column.type),
                        )
                    ) {
                        expect(
                            column.default,
                            `${entity.tableName}.${column.databaseName}`,
                        ).toBeUndefined();
                    }
                }
            }
        },
    );
});
