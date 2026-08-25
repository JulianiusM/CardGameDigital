export type LinkedRange = { start: number; end: number };

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Keeps a linked inclusive range valid without shrinking either control's travel.
 * Crossing one handle moves the other handle at the same transition point.
 */
export function updateLinkedRange(
    current: LinkedRange,
    changed: "start" | "end",
    nextValue: number,
    minimum: number,
    maximum: number,
): LinkedRange {
    const next = clamp(nextValue, minimum, maximum);
    if (changed === "start") {
        return { start: next, end: Math.max(current.end, next) };
    }
    return { start: Math.min(current.start, next), end: next };
}
