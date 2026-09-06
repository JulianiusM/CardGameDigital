import {
    GAME_MODES,
    NEVER_HAVE_I_EVER_REVEAL_MODES,
    SESSION_STATES,
    type GameSession,
    type NeverHaveIEverRevealMode,
    type Vote,
} from "../game-core";

export type NeverHaveIEverVotingProjection = {
    revealMode: NeverHaveIEverRevealMode;
    progress: readonly {
        playerId: string;
        displayName: string;
        status: "PENDING" | "VOTED";
    }[];
    result: {
        yes: number;
        no: number;
        total: number;
        namedAnswers?: readonly {
            playerId: string;
            displayName: string;
            vote: Vote;
        }[];
    } | null;
};

/** The retained totals field must never bypass the canonical reveal decision. */
export function projectVoteResult(voting: NeverHaveIEverVotingProjection | null) {
    if (!voting?.result) return { yes: 0, no: 0, total: 0 };
    const { yes, no, total } = voting.result;
    return { yes, no, total };
}

/** One privacy-enforcing projection shared by Couch, Personal, and Party Screen. */
export function projectNeverHaveIEverVoting(
    session: GameSession,
): NeverHaveIEverVotingProjection | null {
    if (session.mode !== GAME_MODES.NEVER_HAVE_I_EVER) return null;
    const voters = session.votingPlayers;
    const progress = voters.map((player) => ({
        playerId: player.id,
        displayName: player.name,
        status: session.votes.has(player.id) ? ("VOTED" as const) : ("PENDING" as const),
    }));
    if (session.state !== SESSION_STATES.SHOWING_RESULTS) {
        return { revealMode: session.neverHaveIEverRevealMode, progress, result: null };
    }
    const aggregate = session.voteResult();
    if (session.neverHaveIEverRevealMode === NEVER_HAVE_I_EVER_REVEAL_MODES.ANONYMOUS_AGGREGATE) {
        return { revealMode: session.neverHaveIEverRevealMode, progress, result: aggregate };
    }
    return {
        revealMode: session.neverHaveIEverRevealMode,
        progress,
        result: {
            ...aggregate,
            namedAnswers: voters.map((player) => ({
                playerId: player.id,
                displayName: player.name,
                vote: session.votes.get(player.id)!,
            })),
        },
    };
}
