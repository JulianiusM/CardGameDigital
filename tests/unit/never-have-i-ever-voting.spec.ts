import { describe, expect, it } from "vitest";
import { projectNeverHaveIEverVoting } from "../../packages/application/neverHaveIEverVoting";
import {
    GAME_MODES,
    GameSession,
    NEVER_HAVE_I_EVER_REVEAL_MODES,
    SequenceRandomSource,
} from "../../packages/game-core";
import { card, profile } from "../support/game";

function votingSession(revealMode: "ANONYMOUS_AGGREGATE" | "NAMED_ANSWERS") {
    const session = new GameSession(
        {
            id: `never-${revealMode}`,
            mode: GAME_MODES.NEVER_HAVE_I_EVER,
            players: [
                { id: "anna", name: "Anna" },
                { id: "ben", name: "Ben" },
            ],
            profile: profile(),
            cardLocale: "en-GB",
            neverHaveIEverRevealMode: revealMode,
        },
        new SequenceRandomSource([0]),
    );
    session.startTurn(0, [card({ id: "never-card" as never, yesNoAnswerPossible: true })]);
    return session;
}

describe("Never Have I Ever privacy projection", () => {
    it.each(Object.values(NEVER_HAVE_I_EVER_REVEAL_MODES))(
        "shows completion but no answers while collecting in %s",
        (revealMode) => {
            const session = votingSession(revealMode);
            session.submitVote(1, "anna", "YES");

            expect(projectNeverHaveIEverVoting(session)).toEqual({
                revealMode,
                progress: [
                    { playerId: "anna", displayName: "Anna", status: "VOTED" },
                    { playerId: "ben", displayName: "Ben", status: "PENDING" },
                ],
                result: null,
            });
        },
    );

    it("reveals named answers in authoritative voter order only after completion", () => {
        const session = votingSession(NEVER_HAVE_I_EVER_REVEAL_MODES.NAMED_ANSWERS);
        session.submitVote(1, "anna", "YES");
        session.submitVote(2, "ben", "NO");

        expect(projectNeverHaveIEverVoting(session)?.result).toEqual({
            yes: 1,
            no: 1,
            total: 2,
            namedAnswers: [
                { playerId: "anna", displayName: "Anna", vote: "YES" },
                { playerId: "ben", displayName: "Ben", vote: "NO" },
            ],
        });
    });

    it("keeps anonymous results aggregate-only", () => {
        const session = votingSession(NEVER_HAVE_I_EVER_REVEAL_MODES.ANONYMOUS_AGGREGATE);
        session.submitVote(1, "anna", "YES");
        session.submitVote(2, "ben", "NO");

        expect(projectNeverHaveIEverVoting(session)?.result).toEqual({ yes: 1, no: 1, total: 2 });
    });
});
