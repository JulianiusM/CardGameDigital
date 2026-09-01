import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    PROTOCOL_VERSION,
    roomSnapshotEnvelopeSchema,
    serverInfoSchema,
} from "../../src/packages/protocol";
import {
    GOLDEN_MISCHIEF_ATMOSPHERES,
    GOLDEN_MISCHIEF_COLORS,
} from "../../src/packages/design-tokens";

const dataRoot = path.resolve("clients/kodi/resources/data");
const readJson = (relative: string) =>
    JSON.parse(fs.readFileSync(path.join(dataRoot, relative), "utf8")) as unknown;

describe("Kodi generated client contracts", () => {
    it("parses every shared Room snapshot fixture with the TypeScript source schema", () => {
        const manifest = readJson("fixtures/manifest.json") as {
            protocolVersion: number;
            roomSnapshotFixtures: string[];
        };
        expect(manifest.protocolVersion).toBe(PROTOCOL_VERSION);
        for (const fixture of manifest.roomSnapshotFixtures) {
            expect(() =>
                roomSnapshotEnvelopeSchema.parse(readJson(`fixtures/${fixture}`)),
            ).not.toThrow();
        }
    });

    it("keeps HTTP discovery identity out of multicast and in server-info", () => {
        const info = serverInfoSchema.parse(readJson("fixtures/server-info.json"));
        expect(info.serverId).toMatch(/^[0-9a-f-]{36}$/);
        const mdnsSource = fs.readFileSync("src/modules/localDiscovery.ts", "utf8");
        expect(mdnsSource).not.toMatch(/\bsid=/);
        expect(mdnsSource).not.toContain("serverId");
    });

    it("generates native colors from the shared Golden Mischief token package", () => {
        const generated = readJson("design-tokens.json") as {
            colors: Record<string, string>;
            atmospheres: Record<string, { start: string; end: string; motif: string }>;
        };
        expect(generated.colors).toEqual(GOLDEN_MISCHIEF_COLORS);
        expect(generated.atmospheres).toEqual(GOLDEN_MISCHIEF_ATMOSPHERES);
        const browserCss = fs.readFileSync("apps/web/src/style.css", "utf8").toLowerCase();
        for (const color of Object.values(GOLDEN_MISCHIEF_COLORS)) {
            expect(browserCss).toContain(color.toLowerCase());
        }
        const kodiWindow = fs.readFileSync(
            "clients/kodi/resources/skins/Default/1080i/script-partycard-tv-main.xml",
            "utf8",
        );
        for (const family of Object.keys(GOLDEN_MISCHIEF_ATMOSPHERES)) {
            const basename = family.toLowerCase().replaceAll("_", "-");
            for (let level = 1; level <= 5; level += 1) {
                expect(
                    fs.existsSync(
                        `clients/kodi/resources/skins/Default/media/partycard-tv-atmosphere-${basename}-${level}.png`,
                    ),
                ).toBe(true);
            }
        }
        expect(kodiWindow).toContain("<left>72</left>");
        expect(kodiWindow).toContain("<width>1776</width>");
        expect(kodiWindow).toContain("partycard-tv-result-yes.png");
        expect(kodiWindow).toContain("partycard-tv-result-no.png");
        expect(kodiWindow).toContain("Window.Property(AtmosphereTexture)");
        expect(kodiWindow).not.toContain("<include>");
    });

    it("ships no Card catalog, gameplay engine, service, or credential fixture", () => {
        const files = fs
            .readdirSync("clients/kodi", { recursive: true, encoding: "utf8" })
            .map((entry) => entry.replaceAll("\\", "/"));
        expect(files.some((entry) => /card-catalog/i.test(entry))).toBe(false);
        const manifest = fs.readFileSync("clients/kodi/addon.xml", "utf8");
        expect(manifest).toContain(
            '<extension point="xbmc.python.pluginsource" library="game.py">',
        );
        expect(manifest).toContain("<provides>game</provides>");
        expect(manifest).toContain('<extension point="xbmc.python.script" library="addon.py">');
        expect(manifest).toContain("<provides>executable</provides>");
        expect(manifest.indexOf("xbmc.python.pluginsource")).toBeLessThan(
            manifest.indexOf("xbmc.python.script"),
        );
        expect(manifest.indexOf("xbmc.python.script")).toBeLessThan(
            manifest.indexOf("xbmc.addon.metadata"),
        );
        expect(fs.existsSync("clients/kodi/game.py")).toBe(true);
        expect(manifest).not.toContain("xbmc.service");
        const fixtures = fs
            .readdirSync("clients/kodi/resources/data/fixtures")
            .map((name) => fs.readFileSync(`clients/kodi/resources/data/fixtures/${name}`, "utf8"))
            .join("\n");
        expect(fixtures).not.toContain("participantCredential");
        expect(fixtures).not.toContain("cardText");
    });

    it("publishes a complete native Kodi settings surface", () => {
        const settings = fs.readFileSync("clients/kodi/resources/settings.xml", "utf8");
        expect(settings).toContain('<section id="script.partycard.tv">');
        for (const setting of [
            "preferred_server_url",
            "discovery_enabled",
            "locale",
            "display_name",
            "auto_page_seconds",
        ]) {
            expect(settings).toContain(`id="${setting}"`);
        }
        for (const unsupportedSetting of [
            "large_text",
            "reduced_motion",
            "weak_hardware",
            "sound_effects",
        ]) {
            expect(settings).not.toContain(`id="${unsupportedSetting}"`);
        }
    });

    it("shows a localized shell before cold-start application imports finish", () => {
        const windowXml = fs.readFileSync(
            "clients/kodi/resources/skins/Default/1080i/script-partycard-tv-main.xml",
            "utf8",
        );
        expect(windowXml).toContain('<defaultcontrol always="true">49</defaultcontrol>');
        expect(windowXml).toContain("$ADDON[script.partycard.tv 32001]");
        expect(windowXml).toContain("Window.Property(ClientReady)");

        const runtime = fs.readFileSync("clients/kodi/resources/lib/kodi_runtime.py", "utf8");
        expect(runtime.indexOf("window.show()")).toBeGreaterThan(-1);
        expect(runtime.indexOf("window.show()")).toBeLessThan(
            runtime.indexOf("Application = _load_with_abort"),
        );
    });

    it("keeps collections, actions, pagination, and Help navigation structurally distinct", () => {
        const windowXml = fs.readFileSync(
            "clients/kodi/resources/skins/Default/1080i/script-partycard-tv-main.xml",
            "utf8",
        );
        expect(windowXml).toContain('<control type="panel" id="53">');
        expect(windowXml).toContain('<control type="list" id="54">');
        expect(windowXml).toContain('<control type="list" id="56">');
        expect(windowXml).toContain('<control type="button" id="92">');
        expect(windowXml).toContain('<control type="button" id="93">');
        expect(windowXml).toContain("Window.Property(PageStatus)");
        expect(windowXml).toContain("Window.Property(JoinRoomLabel)");
    });
});
