import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
    CARD_TYPES,
    DARE_TYPES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    SOCIAL_SENSITIVITIES,
} from "../../packages/game-core";
import { sessionCardPolicySchema } from "../../packages/protocol/cardPolicy";
import { roomSnapshotSchema } from "../../packages/protocol/snapshots";
import {
    MAX_HTTP_JSON_BYTES,
    MAX_POLICY_IMPORT_BYTES,
    MAX_WEBSOCKET_MESSAGE_BYTES,
} from "../../packages/protocol/limits";

const id = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const directives = {
    availability: "INCLUDE",
    alwaysEligible: "ENABLE",
    repeatableInSession: "ENABLE",
    repeatCooldown: { mode: "SET", value: Number.MAX_SAFE_INTEGER },
    intensity: { mode: "SET", value: 5 },
    weight: { mode: "SET", value: 1.7976931348623157e308 },
    socialSensitivity: { mode: "SET", value: "EXPLICIT" },
    playerCount: {
        mode: "SET",
        value: { minimum: Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    },
};
const rule = {
    id: id(1),
    name: "\u0001".repeat(100),
    enabled: true,
    order: Number.MAX_SAFE_INTEGER,
    predicate: {
        cardTypes: Object.values(CARD_TYPES),
        questionCategoryIds: Object.values(QUESTION_CATEGORIES),
        dareTypeIds: Object.values(DARE_TYPES),
        dareAffinityCategoryIds: Object.values(QUESTION_CATEGORIES),
        socialSensitivities: Object.values(SOCIAL_SENSITIVITIES),
        operationalFlagsAll: Object.values(OPERATIONAL_FLAGS),
        operationalFlagsAny: Object.values(OPERATIONAL_FLAGS),
        operationalFlagsNone: Object.values(OPERATIONAL_FLAGS),
        yesNoAnswerPossible: true,
        minimumIntensity: 1,
        maximumIntensity: 5,
        alwaysEligible: true,
        repeatableInSession: true,
        minimumRepeatCooldown: Number.MAX_SAFE_INTEGER,
        maximumRepeatCooldown: Number.MAX_SAFE_INTEGER,
        minimumWeight: 1.7976931348623157e308,
        maximumWeight: 1.7976931348623157e308,
        minimumPlayerCountAtLeast: Number.MAX_SAFE_INTEGER,
        maximumPlayerCountAtMost: Number.MAX_SAFE_INTEGER,
        lifecycle: "RETIRED",
    },
    directives,
};

describe("coordinated runtime byte budgets", () => {
    it("carries maximum Session policy, roster and voting projections without catalog data", () => {
        const envelope = JSON.parse(
            fs.readFileSync("apps/kodi/resources/data/fixtures/ordinary-room.json", "utf8"),
        );
        const players = Array.from({ length: 1000 }, (_, i) => ({
            id: id(i + 1),
            name: "\u0001".repeat(40),
        }));
        const policy = sessionCardPolicySchema.parse({
            scopeDefault: directives,
            conditionalRules: Array.from({ length: 250 }, (_, i) => ({ ...rule, id: id(i + 1) })),
            exactCards: Array.from({ length: 1000 }, (_, i) => ({ cardId: id(i + 1), directives })),
        });
        const progress = players.map(({ id, name }) => ({
            playerId: id,
            displayName: name,
            status: "VOTED",
        }));
        const snapshot = roomSnapshotSchema.parse({
            ...envelope.payload,
            capacity: { maximumPlayers: 1000, maximumParticipants: 1000 },
            participants: players.map((player) => ({
                id: player.id,
                roomId: envelope.payload.roomId,
                displayName: player.name,
                role: "PLAYER",
                devicePlayers: [],
                connectionStatus: "CONNECTED",
            })),
            settings: {
                ...envelope.payload.settings,
                cardPolicy: policy,
                cardFallbackLocales: Array.from(
                    { length: 100 },
                    (_, i) => `en-${String(i).padStart(3, "0")}-${"a".repeat(28)}`,
                ),
            },
            session: {
                id: id(1001),
                startedAt: Number.MAX_SAFE_INTEGER,
                mode: "NEVER_HAVE_I_EVER",
                revision: Number.MAX_SAFE_INTEGER,
                state: "SHOWING_RESULTS",
                roundNumber: Number.MAX_SAFE_INTEGER,
                activePlayer: players[0],
                players,
                currentCard: {
                    id: id(1002),
                    cardText: "A" + "\u0001".repeat(3998) + "A",
                    cardType: "QUESTION",
                    cardIntensity: 5,
                    intensity: 5,
                    questionCategoryId: "CAT_EVERYDAY",
                    dareTypeId: null,
                },
                cardsShown: Number.MAX_SAFE_INTEGER,
                remainingCardCount: Number.MAX_SAFE_INTEGER,
                voteResult: { yes: 1000, no: 0, total: 1000 },
                neverHaveIEverVoting: {
                    revealMode: "NAMED_ANSWERS",
                    progress,
                    result: {
                        yes: 1000,
                        no: 0,
                        total: 1000,
                        namedAnswers: progress.map((player) => ({
                            playerId: player.playerId,
                            displayName: player.displayName,
                            vote: "YES",
                        })),
                    },
                },
                hasVoted: true,
                controllablePlayers: players
                    .slice(0, 20)
                    .map((player) => ({ ...player, hasVoted: true })),
                viewer: null,
                availableActions: [],
            },
        });
        const bytes = Buffer.byteLength(JSON.stringify({ ...envelope, payload: snapshot }));
        expect(bytes).toBeLessThan(MAX_WEBSOCKET_MESSAGE_BYTES);
        expect(bytes).toBeLessThan(MAX_HTTP_JSON_BYTES);
        // Allowance for logical players represented as additional device-player rows.
        expect(bytes + Buffer.byteLength(JSON.stringify(players))).toBeLessThan(
            MAX_WEBSOCKET_MESSAGE_BYTES,
        );
    });

    it("fits maximum persistent policy imports by arithmetic without building 50,000 entries", () => {
        const entry = JSON.stringify({ cardId: id(1), directives });
        const worstBytes =
            50_000 * (Buffer.byteLength(entry) + 1) +
            250 * (Buffer.byteLength(JSON.stringify(rule)) + 1) +
            4096;
        expect(worstBytes).toBeLessThan(MAX_POLICY_IMPORT_BYTES);
    });
});
