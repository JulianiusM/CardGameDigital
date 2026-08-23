export function elapsedMinutes(startedAt: number, now = Date.now()): number {
    return Math.max(1, Math.round((now - startedAt) / 60_000));
}
