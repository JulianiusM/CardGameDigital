import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    cardLifecycleSchema,
    cardReplacementReasonSchema,
    clientCapabilitySchema,
    clientRoleSchema,
    MAX_WEBSOCKET_MESSAGE_BYTES,
    neverHaveIEverRevealModeSchema,
    neverHaveIEverVoteStatusSchema,
    neverHaveIEverVoteValueSchema,
    participantConnectionStatusSchema,
    participantLeftReasonSchema,
    PROTOCOL_VERSION,
    protocolErrorCodeSchema,
    roomBootstrapModeSchema,
    roomHostStateSchema,
    roomRoleChangeReasonSchema,
    roomSnapshotEnvelopeSchema,
    sessionPersistenceSchema,
    serverInfoSchema,
} from "../../packages/protocol";
import {
    GOLDEN_MISCHIEF_ATMOSPHERES,
    GOLDEN_MISCHIEF_COLORS,
    GOLDEN_MISCHIEF_WEB_COLOR_TOKENS,
    GOLDEN_MISCHIEF_WEB_RGB_TOKENS,
} from "../../packages/design-tokens";

const dataRoot = path.resolve("apps/kodi/resources/data");
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

    it("generates the native protocol vocabulary and limits from TypeScript contracts", () => {
        const generated = readJson("enums.json") as {
            protocolVersion: number;
            constraints: { maximumWebSocketMessageBytes: number };
            clientRoles: string[];
            clientCapabilities: string[];
            roomBootstrapModes: string[];
            roomHostStates: string[];
            roomRoleChangeReasons: string[];
            cardLifecycles: string[];
            sessionPersistenceModes: string[];
            neverHaveIEverVoteStatuses: string[];
            neverHaveIEverVoteValues: string[];
            participantLeftReasons: string[];
            cardReplacementReasons: string[];
            participantConnectionStatuses: string[];
            neverHaveIEverRevealModes: string[];
            protocolErrorCodes: string[];
        };
        expect(generated.protocolVersion).toBe(PROTOCOL_VERSION);
        expect(generated.constraints.maximumWebSocketMessageBytes).toBe(
            MAX_WEBSOCKET_MESSAGE_BYTES,
        );
        expect(generated.clientRoles).toEqual(clientRoleSchema.options);
        expect(generated.clientCapabilities).toEqual(clientCapabilitySchema.options);
        expect(generated.roomBootstrapModes).toEqual(roomBootstrapModeSchema.options);
        expect(generated.roomHostStates).toEqual(roomHostStateSchema.options);
        expect(generated.roomRoleChangeReasons).toEqual(roomRoleChangeReasonSchema.options);
        expect(generated.cardLifecycles).toEqual(cardLifecycleSchema.options);
        expect(generated.sessionPersistenceModes).toEqual(sessionPersistenceSchema.options);
        expect(generated.neverHaveIEverVoteStatuses).toEqual(
            neverHaveIEverVoteStatusSchema.options,
        );
        expect(generated.neverHaveIEverVoteValues).toEqual(neverHaveIEverVoteValueSchema.options);
        expect(generated.participantLeftReasons).toEqual(participantLeftReasonSchema.options);
        expect(generated.cardReplacementReasons).toEqual(cardReplacementReasonSchema.options);
        expect(generated.participantConnectionStatuses).toEqual(
            participantConnectionStatusSchema.options,
        );
        expect(generated.neverHaveIEverRevealModes).toEqual(neverHaveIEverRevealModeSchema.options);
        expect(generated.protocolErrorCodes).toEqual(protocolErrorCodeSchema.options);

        const validator = fs.readFileSync("apps/kodi/resources/lib/protocol/validation.py", "utf8");
        expect(validator).not.toMatch(/PROTOCOL_VERSION\s*=\s*2/);
        expect(validator).not.toContain('"CLASSIC_TRUTH_OR_DARE",');
        expect(validator).not.toContain('"PROTOCOL_VERSION_UNSUPPORTED",');
    });

    it("keeps every generated Kodi directory equal to its declared output set", () => {
        const protocolManifest = readJson("protocol/manifest.json") as { schemas: string[] };
        expect(fs.readdirSync(path.join(dataRoot, "protocol")).sort()).toEqual(
            ["manifest.json", ...protocolManifest.schemas].sort(),
        );

        const fixtureManifest = readJson("fixtures/manifest.json") as {
            roomSnapshotFixtures: string[];
            transportFixtures: string[];
            httpFixtures: string[];
        };
        expect(fs.readdirSync(path.join(dataRoot, "fixtures")).sort()).toEqual(
            [
                "manifest.json",
                ...fixtureManifest.roomSnapshotFixtures,
                ...fixtureManifest.transportFixtures,
                ...fixtureManifest.httpFixtures,
            ].sort(),
        );

        const design = readJson("design-tokens.json") as { atmospheres: Record<string, unknown> };
        const atmosphereFiles = Object.keys(design.atmospheres).flatMap((family) =>
            Array.from(
                { length: 5 },
                (_, index) =>
                    `partycard-tv-atmosphere-${family.toLowerCase().replaceAll("_", "-")}-${index + 1}.png`,
            ),
        );
        const fixedSkinMedia = [
            "partycard-tv-backdrop.png",
            "partycard-tv-paper.png",
            "partycard-tv-panel.png",
            "partycard-tv-button.png",
            "partycard-tv-button-focus.png",
            "partycard-tv-selected.png",
            "partycard-tv-button-danger.png",
            "partycard-tv-result-yes.png",
            "partycard-tv-result-no.png",
            "partycard-tv-white.png",
            "partycard-tv-selected-mark.png",
            "partycard-tv-dot-on.png",
            "partycard-tv-dot-off.png",
        ];
        expect(fs.readdirSync("apps/kodi/resources/skins/Default/media").sort()).toEqual(
            [...fixedSkinMedia, ...atmosphereFiles].sort(),
        );
        expect(fs.readdirSync("apps/kodi/resources/media").sort()).toEqual([
            "fanart.png",
            "icon.png",
        ]);
    });

    it("keeps HTTP discovery identity out of multicast and in server-info", () => {
        const info = serverInfoSchema.parse(readJson("fixtures/server-info.json"));
        expect(info.serverId).toMatch(/^[0-9a-f-]{36}$/);
        const mdnsSource = fs.readFileSync("apps/server/src/modules/localDiscovery.ts", "utf8");
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
        const browserCss = fs
            .readFileSync("apps/web/src/generated/golden-mischief.css", "utf8")
            .toLowerCase();
        for (const [property, color] of Object.entries(GOLDEN_MISCHIEF_WEB_COLOR_TOKENS)) {
            expect(browserCss).toContain(`${property}: ${color.toLowerCase()}`);
        }
        for (const [property, channels] of Object.entries(GOLDEN_MISCHIEF_WEB_RGB_TOKENS)) {
            expect(browserCss).toContain(`${property}: ${channels}`);
        }
        const browserPresentationSource = fs
            .readdirSync("apps/web/src", { recursive: true, encoding: "utf8" })
            .filter((entry) => /\.(?:css|svelte)$/.test(entry) && !entry.startsWith("generated"))
            .map((entry) => fs.readFileSync(path.join("apps/web/src", entry), "utf8"))
            .join("\n");
        for (const channels of Object.values(GOLDEN_MISCHIEF_WEB_RGB_TOKENS)) {
            expect(browserPresentationSource).not.toContain(`rgb(${channels} /`);
        }
        expect(fs.readFileSync("apps/web/src/style.css", "utf8")).toContain(
            '@import "./generated/golden-mischief.css"',
        );
        const kodiWindow = fs.readFileSync(
            "apps/kodi/resources/skins/Default/1080i/script-partycard-tv-main.xml",
            "utf8",
        );
        const kodiWindowTemplate = fs.readFileSync(
            "tooling/kodi/templates/script-partycard-tv-main.xml.template",
            "utf8",
        );
        expect(kodiWindowTemplate).toContain("{{COLOR_ESPRESSO}}");
        expect(kodiWindowTemplate).toContain("{{COLOR_RASPBERRY}}");
        expect(kodiWindowTemplate).toContain("{{ATMOSPHERE_CONVERSATION_META_MOTIF}}");
        expect(kodiWindowTemplate).not.toContain("FF3B2416");
        expect(kodiWindowTemplate).not.toContain("FFE84769");
        expect(kodiWindow).toContain(`FF${GOLDEN_MISCHIEF_COLORS.espresso.slice(1)}`);
        expect(kodiWindow).toContain(`FF${GOLDEN_MISCHIEF_COLORS.raspberry.slice(1)}`);
        expect(
            fs.readFileSync("apps/kodi/resources/lib/screens/main_window.py", "utf8"),
        ).not.toContain("FFE84769");
        for (const family of Object.keys(GOLDEN_MISCHIEF_ATMOSPHERES)) {
            const basename = family.toLowerCase().replaceAll("_", "-");
            for (let level = 1; level <= 5; level += 1) {
                expect(
                    fs.existsSync(
                        `apps/kodi/resources/skins/Default/media/partycard-tv-atmosphere-${basename}-${level}.png`,
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
            .readdirSync("apps/kodi", { recursive: true, encoding: "utf8" })
            .map((entry) => entry.replaceAll("\\", "/"));
        expect(files.some((entry) => /card-catalog/i.test(entry))).toBe(false);
        const manifest = fs.readFileSync("apps/kodi/addon.xml", "utf8");
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
        expect(fs.existsSync("apps/kodi/game.py")).toBe(true);
        expect(manifest).not.toContain("xbmc.service");
        const fixtures = fs
            .readdirSync("apps/kodi/resources/data/fixtures")
            .map((name) => fs.readFileSync(`apps/kodi/resources/data/fixtures/${name}`, "utf8"))
            .join("\n");
        expect(fixtures).not.toContain("participantCredential");
        expect(fixtures).not.toContain("cardText");
    });

    it("publishes a complete native Kodi settings surface", () => {
        const settings = fs.readFileSync("apps/kodi/resources/settings.xml", "utf8");
        const catalog = JSON.parse(
            fs.readFileSync("packages/localization/kodiCatalog.json", "utf8"),
        ) as {
            nativeSettings: {
                sectionId: string;
                categories: Array<{ settings: Array<{ id: string }> }>;
            };
        };
        expect(settings).toContain(`<section id="${catalog.nativeSettings.sectionId}">`);
        const expectedSettings = catalog.nativeSettings.categories.flatMap((category) =>
            category.settings.map((setting) => setting.id),
        );
        for (const setting of expectedSettings) {
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
            "apps/kodi/resources/skins/Default/1080i/script-partycard-tv-main.xml",
            "utf8",
        );
        expect(windowXml).toContain('<defaultcontrol always="true">49</defaultcontrol>');
        expect(windowXml).toContain("$ADDON[script.partycard.tv 32001]");
        expect(windowXml).toContain("Window.Property(ClientReady)");

        const runtime = fs.readFileSync("apps/kodi/resources/lib/kodi_runtime.py", "utf8");
        expect(runtime.indexOf("window.show()")).toBeGreaterThan(-1);
        expect(runtime.indexOf("window.show()")).toBeLessThan(
            runtime.indexOf("Application = _load_with_abort"),
        );
    });

    it("keeps collections, actions, pagination, and Help navigation structurally distinct", () => {
        const windowXml = fs.readFileSync(
            "apps/kodi/resources/skins/Default/1080i/script-partycard-tv-main.xml",
            "utf8",
        );
        expect(windowXml).toContain('<control type="panel" id="53">');
        expect(windowXml).toContain('<control type="fixedlist" id="54">');
        expect(windowXml).toContain('<control type="list" id="56">');
        expect(windowXml).toContain('<control type="button" id="92">');
        expect(windowXml).toContain('<control type="button" id="93">');
        expect(windowXml).toContain("Window.Property(PageStatus)");
        expect(windowXml).toContain("Window.Property(JoinRoomLabel)");
    });
});
