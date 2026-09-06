import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { roomSnapshotEncoder } from "../../apps/server/src/modules/roomSnapshotEncoding";
import { roomSnapshotEnvelopeSchema } from "../../packages/protocol";

describe("shared Room snapshot encoding", () => {
    it("keeps v4 fields and viewer controls intact across UTF-8 fragments", () => {
        const fixture = JSON.parse(
            fs.readFileSync("apps/kodi/resources/data/fixtures/ordinary-room.json", "utf8"),
        );
        const common = fixture.payload;
        common.session = {
            id: common.roomId,
            startedAt: Date.now(),
            revision: 0,
            mode: "CLASSIC_TRUTH_OR_DARE",
            state: "WAITING_FOR_PLAYER",
            roundNumber: 1,
            activePlayer: null,
            players: [],
            currentCard: null,
            cardsShown: 0,
            remainingCardCount: 0,
            voteResult: { yes: 0, no: 0, total: 0 },
            neverHaveIEverVoting: null,
            hasVoted: false,
            controllablePlayers: [],
            viewer: null,
            availableActions: [],
        };
        const encode = roomSnapshotEncoder(common, "reply");
        const first = encode(common);
        const display = {
            ...common,
            boundaryConfigured: false,
            session: {
                ...common.session,
                viewer: {
                    participantId: common.participants[0].id,
                    role: "DISPLAY",
                    displayName: "界".repeat(40),
                },
                availableActions: [],
                controllablePlayers: [],
                hasVoted: false,
            },
        };
        const second = encode(display);
        expect(second[0]).toBe(first[0]);
        for (const [fragments, snapshot] of [
            [first, common],
            [second, display],
        ] as const) {
            const decoded = JSON.parse(Buffer.concat(fragments).toString("utf8"));
            expect(roomSnapshotEnvelopeSchema.parse(decoded).payload).toEqual(snapshot);
            expect(decoded.requestId).toBe("reply");
        }
        const lobby = { ...common, session: null };
        expect(
            JSON.parse(Buffer.concat(roomSnapshotEncoder(lobby, null)(lobby)).toString("utf8"))
                .payload,
        ).toEqual(lobby);
    });
});
