import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function filesBelow(directory: string, extension: RegExp): string[] {
    const files: string[] = [];
    if (!fs.existsSync(directory)) return files;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...filesBelow(file, extension));
        } else if (extension.test(file)) {
            files.push(file);
        }
    }

    return files;
}

function contents(files: string[]): string {
    return files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
}

describe("core release architecture", () => {
    it("keeps game-core independent from frameworks and infrastructure", () => {
        const domain = contents(filesBelow("src/packages/game-core", /\.ts$/));
        expect(domain).not.toMatch(/from ["'](?:express|typeorm|ws|svelte|openid-client)/);
        expect(domain).not.toMatch(/modules\/(?:database|email|oidc|settings|websocket)/);
    });

    it("uses one WebSocket server adapter", () => {
        const server = contents(filesBelow("src", /\.ts$/));
        expect(server.match(/new WebSocketServer\s*\(/g) ?? []).toHaveLength(1);
    });

    it("has no legacy brand or remote runtime assets in shipped sources", () => {
        const runtime = contents([
            ...filesBelow("apps/web", /\.(?:ts|svelte|css|html)$/),
            ...filesBelow("src/views", /\.pug$/),
            ...filesBelow("src/public/js", /\.ts$/),
        ]);
        expect(runtime).not.toMatch(/Surveyor/i);
        expect(fs.existsSync("src/views")).toBe(false);
        expect(runtime).not.toMatch(/https?:\/\/(?:cdn\.|cdnjs\.|fonts\.)/i);
    });

    it("keeps AccountSession and game Session terminology distinct", () => {
        expect(fs.existsSync("src/modules/database/entities/session/AccountSession.ts")).toBe(true);
        expect(fs.existsSync("src/modules/database/entities/game/GameSessionEntity.ts")).toBe(true);
        expect(fs.existsSync("src/modules/database/entities/user/DataSpace.ts")).toBe(true);
    });
});
