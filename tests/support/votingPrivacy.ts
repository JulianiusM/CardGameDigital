import { expect } from "vitest";

/** Inspect the whole response/envelope, including fields outside the voting panel. */
export function expectHiddenVotingAnswers(payload: unknown): void {
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(
        /"(?:YES|NO)"|"(?:vote|votes|namedAnswers|boundariesByPlayer)"\s*:/,
    );
    for (const total of serialized.matchAll(/"(?:yes|no|total)":(\d+)/g)) {
        expect(Number(total[1])).toBe(0);
    }
}
