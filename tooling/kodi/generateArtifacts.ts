import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { format, resolveConfig } from "prettier";
import { z, type ZodType } from "zod";
import {
    cardLifecycleSchema,
    cardReplacementReasonSchema,
    cardReplacedEnvelopeSchema,
    clientCapabilitySchema,
    clientHelloEnvelopeSchema,
    clientPingEnvelopeSchema,
    clientRoleSchema,
    MAX_WEBSOCKET_MESSAGE_BYTES,
    MAX_REQUEST_ID_CHARACTERS,
    MAX_ROOM_PARTICIPANTS,
    MAX_ROOM_PLAYERS,
    neverHaveIEverRevealModeSchema,
    neverHaveIEverVoteStatusSchema,
    neverHaveIEverVoteValueSchema,
    participantConnectionStatusSchema,
    participantLeftEnvelopeSchema,
    participantLeftReasonSchema,
    PROTOCOL_VERSION,
    protocolErrorCodeSchema,
    protocolErrorEnvelopeSchema,
    roomCommandEnvelopeSchema,
    roomBootstrapModeSchema,
    roomCreateRequestSchema,
    roomCreateResponseSchema,
    roomGameSettingsSchema,
    roomHostStateSchema,
    roomPresenceEnvelopeSchema,
    roomRoleChangedEnvelopeSchema,
    roomRoleChangeReasonSchema,
    ROOM_CODE_PATTERN_SOURCE,
    ROOM_GAME_SETTING_CONSTRAINTS,
    roomSnapshotEnvelopeSchema,
    roomSnapshotSchema,
    sessionPersistenceSchema,
    serverEnvelopeSchema,
    serverHelloEnvelopeSchema,
    serverPongEnvelopeSchema,
    serverInfoSchema,
    snapshotRequestEnvelopeSchema,
} from "../../packages/protocol";
import { sessionCardPolicySchema } from "../../packages/protocol/cardPolicy";
import {
    AVAILABILITY_DIRECTIVES,
    BOOLEAN_DIRECTIVES,
    CARD_TYPES,
    DARE_TYPE_IDS,
    GAME_MODES,
    INTENSITY_LEVELS,
    INTENSITY_PROGRESSION_UNITS,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORY_IDS,
    SESSION_STATES,
    SCALAR_DIRECTIVE_MODES,
    SOCIAL_SENSITIVITY_ORDER,
} from "../../packages/game-core";
import { defaultRoomGameSettings } from "../../packages/application/roomGameSettings";
import {
    GOLDEN_MISCHIEF_ATMOSPHERES,
    GOLDEN_MISCHIEF_COLORS,
    DARE_VISUAL_FAMILY_BY_TYPE_ID,
    QUESTION_VISUAL_FAMILY_BY_CATEGORY_ID,
} from "../../packages/design-tokens";

const root = process.cwd();
const clientRoot = path.join(root, "apps", "kodi");
const dataRoot = path.join(clientRoot, "resources", "data");
const schemaRoot = path.join(dataRoot, "protocol");
const fixtureRoot = path.join(dataRoot, "fixtures");
const skinRoot = path.join(clientRoot, "resources", "skins", "Default");
const skinDefinitionRoot = path.join(skinRoot, "1080i");
const mediaRoot = path.join(skinRoot, "media");
const addonMediaRoot = path.join(clientRoot, "resources", "media");
const skinWindowTemplate = path.join(
    root,
    "tooling",
    "kodi",
    "templates",
    "script-partycard-tv-main.xml.template",
);
const checkOnly = process.argv.includes("--check");
const drift: string[] = [];
const generatedWrites: Promise<void>[] = [];
const prettierConfig = resolveConfig(path.join(root, ".prettierrc.json"));

async function generatedText(value: unknown): Promise<string> {
    const config = (await prettierConfig) ?? {};
    return format(JSON.stringify(value), { ...config, parser: "json" });
}

function output(relativeOrAbsolute: string, content: string | Buffer): void {
    const target = path.isAbsolute(relativeOrAbsolute)
        ? relativeOrAbsolute
        : path.join(root, relativeOrAbsolute);
    const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;
    const next = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    if (existing?.equals(next)) return;
    if (checkOnly) {
        drift.push(path.relative(root, target).replaceAll(path.sep, "/"));
        return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, next);
}

function outputGenerated(relativeOrAbsolute: string, value: unknown): void {
    generatedWrites.push(
        generatedText(value).then((content) => {
            output(relativeOrAbsolute, content);
        }),
    );
}

function kodiArgb(hexColor: string, alpha = "FF"): string {
    return `${alpha}${hexColor.slice(1)}`.toUpperCase();
}

function renderSkinWindow(): string {
    const values: Readonly<Record<string, string>> = {
        COLOR_ESPRESSO: kodiArgb(GOLDEN_MISCHIEF_COLORS.espresso),
        COLOR_ESPRESSO_ALPHA_99: kodiArgb(GOLDEN_MISCHIEF_COLORS.espresso, "99"),
        COLOR_ESPRESSO_ALPHA_C4: kodiArgb(GOLDEN_MISCHIEF_COLORS.espresso, "C4"),
        COLOR_COCOA: kodiArgb(GOLDEN_MISCHIEF_COLORS.cocoa),
        COLOR_SUNFLOWER: kodiArgb(GOLDEN_MISCHIEF_COLORS.sunflower),
        COLOR_GOLDEN_ORANGE: kodiArgb(GOLDEN_MISCHIEF_COLORS.goldenOrange),
        COLOR_TANGERINE: kodiArgb(GOLDEN_MISCHIEF_COLORS.tangerine),
        COLOR_APRICOT: kodiArgb(GOLDEN_MISCHIEF_COLORS.apricot),
        COLOR_CORAL: kodiArgb(GOLDEN_MISCHIEF_COLORS.coral),
        COLOR_RASPBERRY: kodiArgb(GOLDEN_MISCHIEF_COLORS.raspberry),
        COLOR_BERRY: kodiArgb(GOLDEN_MISCHIEF_COLORS.berry),
        COLOR_RESULT_HONEY: kodiArgb(GOLDEN_MISCHIEF_COLORS.resultHoney),
        COLOR_RESULT_CLAY: kodiArgb(GOLDEN_MISCHIEF_COLORS.resultClay),
        COLOR_WARM_PAPER: kodiArgb(GOLDEN_MISCHIEF_COLORS.warmPaper),
        COLOR_SOFT_CREAM: kodiArgb(GOLDEN_MISCHIEF_COLORS.softCream),
        ATMOSPHERE_CONVERSATION_META_MOTIF: kodiArgb(
            GOLDEN_MISCHIEF_ATMOSPHERES.CONVERSATION_META.motif,
        ),
    };
    let rendered = fs.readFileSync(skinWindowTemplate, "utf8");
    for (const [name, value] of Object.entries(values)) {
        rendered = rendered.replaceAll(`{{${name}}}`, value);
    }
    const unresolved = rendered.match(/\{\{[A-Z0-9_]+\}\}/g);
    if (unresolved !== null) {
        throw new Error(`Unresolved Kodi skin tokens: ${[...new Set(unresolved)].join(", ")}`);
    }
    return rendered;
}

function reconcileGeneratedDirectory(directory: string, expectedNames: ReadonlySet<string>): void {
    if (!fs.existsSync(directory)) return;
    const resolvedDirectory = path.resolve(directory);
    for (const entry of fs.readdirSync(resolvedDirectory, { withFileTypes: true })) {
        if (expectedNames.has(entry.name)) continue;
        const target = path.resolve(resolvedDirectory, entry.name);
        if (path.dirname(target) !== resolvedDirectory)
            throw new Error(`Refusing to reconcile generated path outside ${resolvedDirectory}`);
        if (checkOnly) {
            drift.push(path.relative(root, target).replaceAll(path.sep, "/"));
        } else {
            fs.rmSync(target, { recursive: entry.isDirectory(), force: true });
        }
    }
}

const protocolSchemas: Record<string, ZodType> = {
    "card-replaced": cardReplacedEnvelopeSchema,
    "client-hello": clientHelloEnvelopeSchema,
    "client-ping": clientPingEnvelopeSchema,
    "participant-left": participantLeftEnvelopeSchema,
    "protocol-error": protocolErrorEnvelopeSchema,
    "protocol-error-code": protocolErrorCodeSchema,
    "room-command": roomCommandEnvelopeSchema,
    "room-create-request": roomCreateRequestSchema,
    "room-create-response": roomCreateResponseSchema,
    "room-presence": roomPresenceEnvelopeSchema,
    "room-role-changed": roomRoleChangedEnvelopeSchema,
    "room-settings": roomGameSettingsSchema,
    "room-snapshot": roomSnapshotSchema,
    "room-snapshot-envelope": roomSnapshotEnvelopeSchema,
    "server-envelope": serverEnvelopeSchema,
    "server-hello": serverHelloEnvelopeSchema,
    "server-pong": serverPongEnvelopeSchema,
    "server-info": serverInfoSchema,
    "session-card-policy": sessionCardPolicySchema,
    "snapshot-request": snapshotRequestEnvelopeSchema,
};

for (const [name, schema] of Object.entries(protocolSchemas)) {
    outputGenerated(path.join(schemaRoot, `${name}.schema.json`), z.toJSONSchema(schema));
}

const schemaNames = Object.keys(protocolSchemas).map((name) => `${name}.schema.json`);
const expectedProtocolFiles = new Set(["manifest.json", ...schemaNames]);
outputGenerated(path.join(schemaRoot, "manifest.json"), {
    schemaVersion: 1,
    apiVersion: 1,
    protocolVersion: PROTOCOL_VERSION,
    schemas: schemaNames,
    generatedFrom: "packages/protocol",
});
outputGenerated(path.join(dataRoot, "enums.json"), {
    schemaVersion: 1,
    protocolVersion: PROTOCOL_VERSION,
    constraints: {
        maximumWebSocketMessageBytes: MAX_WEBSOCKET_MESSAGE_BYTES,
        maximumRequestIdCharacters: MAX_REQUEST_ID_CHARACTERS,
        maximumRoomParticipants: MAX_ROOM_PARTICIPANTS,
        maximumRoomPlayers: MAX_ROOM_PLAYERS,
        roomCodePattern: ROOM_CODE_PATTERN_SOURCE,
        roomGameSettings: ROOM_GAME_SETTING_CONSTRAINTS,
    },
    clientRoles: clientRoleSchema.options,
    clientCapabilities: clientCapabilitySchema.options,
    roomBootstrapModes: roomBootstrapModeSchema.options,
    roomHostStates: roomHostStateSchema.options,
    roomRoleChangeReasons: roomRoleChangeReasonSchema.options,
    cardLifecycles: cardLifecycleSchema.options,
    sessionPersistenceModes: sessionPersistenceSchema.options,
    neverHaveIEverVoteStatuses: neverHaveIEverVoteStatusSchema.options,
    neverHaveIEverVoteValues: neverHaveIEverVoteValueSchema.options,
    participantLeftReasons: participantLeftReasonSchema.options,
    cardReplacementReasons: cardReplacementReasonSchema.options,
    participantConnectionStatuses: participantConnectionStatusSchema.options,
    protocolErrorCodes: protocolErrorCodeSchema.options,
    cardTypes: Object.values(CARD_TYPES),
    intensityLevels: INTENSITY_LEVELS,
    gameModes: Object.values(GAME_MODES),
    sessionStates: Object.values(SESSION_STATES),
    intensityProgressionUnits: Object.values(INTENSITY_PROGRESSION_UNITS),
    neverHaveIEverRevealModes: neverHaveIEverRevealModeSchema.options,
    availabilityDirectives: AVAILABILITY_DIRECTIVES,
    booleanDirectives: BOOLEAN_DIRECTIVES,
    scalarDirectiveModes: SCALAR_DIRECTIVE_MODES,
    questionCategoryIds: QUESTION_CATEGORY_IDS,
    dareTypeIds: DARE_TYPE_IDS,
    operationalFlags: Object.values(OPERATIONAL_FLAGS),
    socialSensitivities: SOCIAL_SENSITIVITY_ORDER,
});
outputGenerated(path.join(dataRoot, "design-tokens.json"), {
    schemaVersion: 1,
    colors: GOLDEN_MISCHIEF_COLORS,
    atmospheres: GOLDEN_MISCHIEF_ATMOSPHERES,
    presentation: {
        questionFamilyByCategoryId: QUESTION_VISUAL_FAMILY_BY_CATEGORY_ID,
        dareFamilyByTypeId: DARE_VISUAL_FAMILY_BY_TYPE_ID,
    },
});
output(path.join(skinDefinitionRoot, "script-partycard-tv-main.xml"), renderSkinWindow());

const displayId = "00000000-0000-4000-8000-000000000001";
const hostId = "00000000-0000-4000-8000-000000000002";
const playerId = "00000000-0000-4000-8000-000000000003";
const roomId = "00000000-0000-4000-8000-000000000010";
const settings = { ...defaultRoomGameSettings(), revision: 0, updatedByParticipantId: null };
const display = {
    id: displayId,
    roomId,
    role: "DISPLAY",
    displayName: "Living room TV",
    devicePlayers: [],
    connectionStatus: "CONNECTED",
};
const host = {
    id: hostId,
    roomId,
    role: "HOST",
    displayName: "Alex",
    devicePlayers: [{ id: playerId, name: "Sam" }],
    connectionStatus: "CONNECTED",
};
function snapshotFixture(
    name: string,
    bootstrapMode: "CREATOR_HOST" | "DISPLAY_WAITING_FOR_HOST",
    participants: unknown[],
    hostStatus: {
        state: string;
        participantId: string | null;
        displayName: string | null;
        deadline: number | null;
    },
): void {
    outputGenerated(path.join(fixtureRoot, `${name}.json`), {
        protocol: PROTOCOL_VERSION,
        type: "room.snapshot",
        requestId: "fixture-request",
        revision: null,
        payload: {
            roomId,
            capacity: { maximumParticipants: 100, maximumPlayers: 100 },
            participants,
            bootstrapMode,
            hostStatus,
            boundaryConfigured: false,
            settings,
            session: null,
        },
    });
}
snapshotFixture("ordinary-room", "CREATOR_HOST", [host], {
    state: "CONNECTED",
    participantId: hostId,
    displayName: "Alex",
    deadline: null,
});
snapshotFixture("awaiting-first-host", "DISPLAY_WAITING_FOR_HOST", [display], {
    state: "AWAITING_FIRST_HOST",
    participantId: null,
    displayName: null,
    deadline: 2_000_000_000_000,
});
snapshotFixture(
    "host-reconnecting",
    "DISPLAY_WAITING_FOR_HOST",
    [display, { ...host, connectionStatus: "TEMPORARILY_DISCONNECTED" }],
    {
        state: "RECONNECTING",
        participantId: hostId,
        displayName: "Alex",
        deadline: 2_000_000_000_000,
    },
);
snapshotFixture("awaiting-replacement-host", "DISPLAY_WAITING_FOR_HOST", [display], {
    state: "AWAITING_REPLACEMENT_HOST",
    participantId: null,
    displayName: null,
    deadline: null,
});
snapshotFixture("promoted-host", "DISPLAY_WAITING_FOR_HOST", [display, host], {
    state: "CONNECTED",
    participantId: hostId,
    displayName: "Alex",
    deadline: null,
});
outputGenerated(path.join(fixtureRoot, "room-closed.json"), {
    schemaVersion: 1,
    transportEvent: "ROOM_CLOSED",
    closeCode: 4001,
});
outputGenerated(path.join(fixtureRoot, "server-info.json"), {
    version: 1,
    serverId: "00000000-0000-4000-8000-000000000099",
    displayName: "Party Game",
    deploymentMode: "local",
    publicRuntimeSecurity: "enforced",
    authenticationAvailable: false,
    protocolVersions: [PROTOCOL_VERSION],
    roomCapacity: { maximumParticipants: 100, maximumPlayers: 100 },
    roomAccess: {
        configuredBaseUrl: null,
        availableBaseUrls: ["http://192.168.1.20:3000"],
    },
    capabilities: {
        localNetworkDiscovery: true,
        displayBootstrapRoomCreation: true,
        nativeDeviceAuthorization: false,
    },
    nativeDeviceAuthorization: null,
    localNetworkDiscovery: {
        advertising: true,
        serviceType: "_partycard._tcp.local.",
        txtVersion: 1,
    },
    endpoints: {
        apiBasePath: "/api/v1",
        webSocketPath: "/ws",
        roomJoinPathTemplate: "/play/?room={roomCode}",
    },
});
const roomSnapshotFixtureNames = [
    "ordinary-room.json",
    "awaiting-first-host.json",
    "host-reconnecting.json",
    "awaiting-replacement-host.json",
    "promoted-host.json",
];
const transportFixtureNames = ["room-closed.json"];
const httpFixtureNames = ["server-info.json"];
const expectedFixtureFiles = new Set([
    "manifest.json",
    ...roomSnapshotFixtureNames,
    ...transportFixtureNames,
    ...httpFixtureNames,
]);
outputGenerated(path.join(fixtureRoot, "manifest.json"), {
    schemaVersion: 1,
    protocolVersion: PROTOCOL_VERSION,
    roomSnapshotFixtures: roomSnapshotFixtureNames,
    transportFixtures: transportFixtureNames,
    httpFixtures: httpFixtureNames,
});

let crcTable: number[] | undefined;
function crc32(value: Buffer): number {
    crcTable ??= Array.from({ length: 256 }, (_, index) => {
        let current = index;
        for (let bit = 0; bit < 8; bit += 1)
            current = (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
        return current >>> 0;
    });
    let result = 0xffffffff;
    for (const byte of value) result = crcTable[(result ^ byte) & 0xff] ^ (result >>> 8);
    return (result ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
    const kind = Buffer.from(type, "ascii");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([kind, data])));
    return Buffer.concat([header, kind, data, checksum]);
}
type Pixel = readonly [number, number, number, number];
function png(width: number, height: number, pixel: (x: number, y: number) => Pixel): Buffer {
    const raw = Buffer.alloc((width * 4 + 1) * height);
    let offset = 0;
    for (let y = 0; y < height; y += 1) {
        raw[offset] = 0;
        offset += 1;
        for (let x = 0; x < width; x += 1) {
            const rgba = pixel(x, y);
            for (const channel of rgba) {
                raw[offset] = channel;
                offset += 1;
            }
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from("89504e470d0a1a0a", "hex"),
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}
function rgb(hex: string): [number, number, number] {
    return [
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16),
    ];
}
function clampColorChannel(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}
function blend(left: readonly number[], right: readonly number[], amount: number): Pixel {
    return [
        Math.round(left[0] + (right[0] - left[0]) * amount),
        Math.round(left[1] + (right[1] - left[1]) * amount),
        Math.round(left[2] + (right[2] - left[2]) * amount),
        255,
    ];
}
function roundedTexture(fill: string, border: string): Buffer {
    const size = 72;
    const radius = 18;
    const fillRgb = rgb(fill);
    const borderRgb = rgb(border);
    return png(size, size, (x, y) => {
        const nearestX = Math.max(radius, Math.min(size - radius - 1, x));
        const nearestY = Math.max(radius, Math.min(size - radius - 1, y));
        const distance = Math.hypot(x - nearestX, y - nearestY);
        if (distance > radius) return [0, 0, 0, 0];
        if (distance > radius - 5) return [...borderRgb, 255];
        return [...fillRgb, 255];
    });
}
function segmentDistance(
    x: number,
    y: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
): number {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const amount = Math.max(
        0,
        Math.min(1, ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared),
    );
    return Math.hypot(x - (startX + amount * deltaX), y - (startY + amount * deltaY));
}
const cream = rgb(GOLDEN_MISCHIEF_COLORS.softCream);
const coral = rgb(GOLDEN_MISCHIEF_COLORS.coral);
output(
    path.join(mediaRoot, "partycard-tv-backdrop.png"),
    png(960, 540, (x, y) => {
        const diagonal = Math.min(1, (x / 960) * 0.58 + (y / 540) * 0.42);
        const base = blend(cream, coral, diagonal * 0.68);
        const motif = ((x + y * 3) % 149 < 4 || (x * 2 + y) % 211 < 3) && diagonal > 0.25;
        return motif ? [base[0], base[1], base[2], 235] : base;
    }),
);
output(
    path.join(mediaRoot, "partycard-tv-paper.png"),
    png(96, 96, (x, y) => {
        const variation = ((x * 17 + y * 31) % 7) - 3;
        const paper = rgb(GOLDEN_MISCHIEF_COLORS.warmPaper);
        return [
            clampColorChannel(paper[0] + variation),
            clampColorChannel(paper[1] + variation),
            clampColorChannel(paper[2] + variation),
            255,
        ];
    }),
);
output(
    path.join(mediaRoot, "partycard-tv-panel.png"),
    roundedTexture(GOLDEN_MISCHIEF_COLORS.warmPaper, "#DABF9C"),
);
output(
    path.join(mediaRoot, "partycard-tv-button.png"),
    roundedTexture(GOLDEN_MISCHIEF_COLORS.softCream, "#DABF9C"),
);
output(
    path.join(mediaRoot, "partycard-tv-button-focus.png"),
    roundedTexture(GOLDEN_MISCHIEF_COLORS.sunflower, GOLDEN_MISCHIEF_COLORS.espresso),
);
output(
    path.join(mediaRoot, "partycard-tv-selected.png"),
    roundedTexture(GOLDEN_MISCHIEF_COLORS.softCream, GOLDEN_MISCHIEF_COLORS.raspberry),
);
output(
    path.join(mediaRoot, "partycard-tv-button-danger.png"),
    roundedTexture(GOLDEN_MISCHIEF_COLORS.raspberry, GOLDEN_MISCHIEF_COLORS.espresso),
);
output(
    path.join(mediaRoot, "partycard-tv-result-yes.png"),
    roundedTexture(GOLDEN_MISCHIEF_COLORS.resultHoney, GOLDEN_MISCHIEF_COLORS.espresso),
);
output(
    path.join(mediaRoot, "partycard-tv-result-no.png"),
    roundedTexture(GOLDEN_MISCHIEF_COLORS.resultClay, GOLDEN_MISCHIEF_COLORS.espresso),
);
output(
    path.join(mediaRoot, "partycard-tv-white.png"),
    png(8, 8, () => [255, 255, 255, 255]),
);
output(
    path.join(mediaRoot, "partycard-tv-selected-mark.png"),
    png(48, 48, (x, y) => {
        if (Math.hypot(x - 23.5, y - 23.5) > 21) return [0, 0, 0, 0];
        const check = Math.min(
            segmentDistance(x, y, 12, 25, 20, 33),
            segmentDistance(x, y, 20, 33, 36, 15),
        );
        return check <= 3.2 ? [...cream, 255] : [...coral, 255];
    }),
);
output(
    path.join(mediaRoot, "partycard-tv-dot-on.png"),
    png(28, 28, (x, y) => (Math.hypot(x - 13.5, y - 13.5) <= 11 ? [...coral, 255] : [0, 0, 0, 0])),
);
output(
    path.join(mediaRoot, "partycard-tv-dot-off.png"),
    png(28, 28, (x, y) => {
        const distance = Math.hypot(x - 13.5, y - 13.5);
        const cocoa = rgb(GOLDEN_MISCHIEF_COLORS.cocoa);
        return distance >= 8 && distance <= 11 ? [...cocoa, 190] : [0, 0, 0, 0];
    }),
);

for (const [family, palette] of Object.entries(GOLDEN_MISCHIEF_ATMOSPHERES)) {
    for (let intensity = 1; intensity <= 5; intensity += 1) {
        const strength = (intensity - 1) / 4;
        const paper = rgb(GOLDEN_MISCHIEF_COLORS.warmPaper);
        const espresso = rgb(GOLDEN_MISCHIEF_COLORS.espresso);
        const startBase = rgb(palette.start);
        const endBase = rgb(palette.end);
        const startPaperStrength = intensity === 1 ? 0.58 : 0.8;
        const endPaperStrength = intensity === 1 ? 0.52 : 0.76;
        const start =
            intensity < 3
                ? blend(paper, startBase, startPaperStrength)
                : blend(startBase, espresso, Math.max(0, intensity - 3) * 0.07);
        const end =
            intensity < 3
                ? blend(paper, endBase, endPaperStrength)
                : blend(endBase, espresso, Math.max(0, intensity - 3) * 0.09);
        const motif = rgb(palette.motif);
        const filename = `partycard-tv-atmosphere-${family.toLowerCase().replaceAll("_", "-")}-${intensity}.png`;
        output(
            path.join(mediaRoot, filename),
            png(960, 540, (x, y) => {
                const diagonal = Math.min(1, x / 1180 + y / 940);
                const base = blend(start, end, diagonal);
                const lineA = (x + y * 2 + intensity * 17) % 173 < 3;
                const lineB = (x * 3 - y + 1800) % 257 < 3;
                if ((lineA || lineB) && (x + y) % 7 < 4) {
                    return blend(base, motif, 0.08 + strength * 0.08);
                }
                return base;
            }),
        );
    }
}

const icon = png(512, 512, (x, y) => {
    const background = blend(rgb(GOLDEN_MISCHIEF_COLORS.goldenOrange), coral, (x + y) / 1024);
    const insideCard = x >= 96 && x <= 416 && y >= 72 && y <= 440;
    const cardEdge = insideCard && (x < 112 || x > 400 || y < 88 || y > 424);
    const pip = Math.hypot(x - 256, y - 256) < 62 || Math.hypot(x - 164, y - 150) < 24;
    if (cardEdge) return [...rgb(GOLDEN_MISCHIEF_COLORS.espresso), 255];
    if (insideCard && pip) return [...rgb(GOLDEN_MISCHIEF_COLORS.raspberry), 255];
    if (insideCard) return [...rgb(GOLDEN_MISCHIEF_COLORS.warmPaper), 255];
    return background;
});
output(path.join(addonMediaRoot, "icon.png"), icon);
output(
    path.join(addonMediaRoot, "fanart.png"),
    png(960, 540, (x, y) => {
        const amount = Math.min(1, (x + y) / 1400);
        const base = blend(
            rgb(GOLDEN_MISCHIEF_COLORS.sunflower),
            rgb(GOLDEN_MISCHIEF_COLORS.raspberry),
            amount,
        );
        const card = x > 305 && x < 655 && y > 85 && y < 455;
        const edge = card && (x < 318 || x > 642 || y < 98 || y > 442);
        if (edge) return [...rgb(GOLDEN_MISCHIEF_COLORS.espresso), 255];
        if (card) return [...rgb(GOLDEN_MISCHIEF_COLORS.warmPaper), 255];
        return base;
    }),
);

const expectedSkinMediaFiles = new Set([
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
    ...Object.keys(GOLDEN_MISCHIEF_ATMOSPHERES).flatMap((family) =>
        Array.from(
            { length: 5 },
            (_, index) =>
                `partycard-tv-atmosphere-${family.toLowerCase().replaceAll("_", "-")}-${index + 1}.png`,
        ),
    ),
]);
reconcileGeneratedDirectory(schemaRoot, expectedProtocolFiles);
reconcileGeneratedDirectory(fixtureRoot, expectedFixtureFiles);
reconcileGeneratedDirectory(
    dataRoot,
    new Set(["design-tokens.json", "enums.json", "fixtures", "protocol"]),
);
reconcileGeneratedDirectory(mediaRoot, expectedSkinMediaFiles);
reconcileGeneratedDirectory(skinDefinitionRoot, new Set(["script-partycard-tv-main.xml"]));
reconcileGeneratedDirectory(addonMediaRoot, new Set(["fanart.png", "icon.png"]));

async function finish(): Promise<void> {
    await Promise.all(generatedWrites);
    if (drift.length > 0) {
        const staleArtifacts = drift.map((entry) => `- ${entry}`).join("\n");
        throw new Error(`Generated Kodi artifacts are stale:\n${staleArtifacts}`);
    }
    if (!checkOnly) console.log("Generated Kodi protocol, token, fixture, and media artifacts.");
}

void finish().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
