type RateWindow = { startedAt: number; count: number };

export class FixedWindowRateLimiter {
    private readonly windows = new Map<string, RateWindow>();

    constructor(
        private readonly windowMs: number,
        private readonly limit: number,
    ) {
        if (!Number.isFinite(windowMs) || windowMs <= 0)
            throw new Error("windowMs must be positive");
        if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be positive");
    }

    consume(key: string, now = Date.now()): boolean {
        const current = this.windows.get(key);
        if (!current || now - current.startedAt >= this.windowMs) {
            this.windows.set(key, { startedAt: now, count: 1 });
            this.prune(now);
            return true;
        }
        current.count++;
        return current.count <= this.limit;
    }

    clear(): void {
        this.windows.clear();
    }

    private prune(now: number): void {
        if (this.windows.size < 1_000) return;
        for (const [key, value] of this.windows) {
            if (now - value.startedAt >= this.windowMs) this.windows.delete(key);
        }
    }
}
