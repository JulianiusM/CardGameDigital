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
        const domain = contents(filesBelow("packages/game-core", /\.ts$/));
        expect(domain).not.toMatch(/from ["'](?:express|typeorm|ws|svelte|openid-client)/);
        expect(domain).not.toMatch(/modules\/(?:database|email|oidc|settings|websocket)/);
    });

    it("keeps application use cases independent from server and persistence frameworks", () => {
        const application = contents(filesBelow("packages/application", /\.ts$/));
        expect(application).not.toMatch(/from ["'](?:express|typeorm|ws|openid-client)/);
        expect(application).not.toMatch(/apps\/server|modules\/(?:database|email|oidc|settings)/);
        expect(application).not.toMatch(/packages\/persistence|\.\.\/persistence/);
    });

    it("keeps persistence mapping independent from the server composition root", () => {
        const persistence = contents(filesBelow("packages/persistence", /\.ts$/));
        expect(persistence).not.toMatch(/apps\/server|apps\\server/);
        expect(persistence).not.toMatch(/modules\/database\/entities/);
    });

    it("uses one WebSocket server adapter", () => {
        const server = contents(filesBelow("apps/server/src", /\.ts$/));
        expect(server.match(/new WebSocketServer\s*\(/g) ?? []).toHaveLength(1);
    });

    it("has no legacy brand or remote runtime assets in shipped sources", () => {
        const runtime = contents([
            ...filesBelow("apps/web", /\.(?:ts|svelte|css|html)$/),
            ...filesBelow("apps/server/src", /\.ts$/),
        ]);
        expect(runtime).not.toMatch(/Surveyor/i);
        expect(fs.existsSync("src/views")).toBe(false);
        expect(runtime).not.toMatch(/https?:\/\/(?:cdn\.|cdnjs\.|fonts\.)/i);
    });

    it("uses one application taxonomy and top-level package boundary", () => {
        expect(filesBelow("src", /\.(?:ts|json)$/)).toHaveLength(0);
        expect(filesBelow("clients", /\.(?:py|ts|json|xml)$/)).toHaveLength(0);
        expect(fs.existsSync("apps/server/src/server.ts")).toBe(true);
        expect(fs.existsSync("apps/web/src/main.ts")).toBe(true);
        expect(fs.existsSync("apps/kodi/addon.xml")).toBe(true);
        expect(fs.existsSync("packages/game-core/index.ts")).toBe(true);
    });

    it("keeps browser protocol DTOs behind the canonical protocol package", () => {
        const multiplayer = fs.readFileSync("apps/web/src/multiplayer.ts", "utf8");
        expect(multiplayer).not.toMatch(/export type Role = ["']/);
        expect(multiplayer).not.toMatch(/supportedProtocolVersions:\s*\[2\]/);
        expect(multiplayer).not.toMatch(/applicationVersion:\s*["']/);
        expect(multiplayer).toContain('from "../../../packages/protocol"');
    });

    it("keeps AccountSession and game Session terminology distinct", () => {
        expect(fs.existsSync("packages/persistence/entities/session/AccountSession.ts")).toBe(true);
        expect(fs.existsSync("packages/persistence/entities/game/GameSessionEntity.ts")).toBe(true);
        expect(fs.existsSync("packages/persistence/entities/user/DataSpace.ts")).toBe(true);
    });
});
