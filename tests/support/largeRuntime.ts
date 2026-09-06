import {
    GameSession,
    SequenceRandomSource,
    DARE_TYPES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
} from "../../packages/game-core";
import { profile } from "./game";
export function largeRuntime() {
    let seed = 12345;
    const name = () =>
        Array.from({ length: 40 }, () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return String.fromCharCode(0x4e00 + (seed % 20000));
        }).join("");
    const players = Array.from({ length: 1000 }, (_, index) => ({
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        name: name(),
    }));
    const boundary = {
        disabledQuestionCategoryIds: new Set(Object.values(QUESTION_CATEGORIES)),
        disabledDareTypeIds: new Set(Object.values(DARE_TYPES)),
        blockedOperationalFlags: new Set(Object.values(OPERATIONAL_FLAGS)),
    };
    return new GameSession(
        {
            id: "10000000-0000-4000-8000-000000001001",
            mode: "CLASSIC_TRUTH_OR_DARE",
            players,
            profile: profile(),
            cardLocale: "de-DE",
            boundariesByPlayer: new Map(players.map(({ id }) => [id, boundary])),
        },
        new SequenceRandomSource([0]),
    ).toRuntimeState();
}
