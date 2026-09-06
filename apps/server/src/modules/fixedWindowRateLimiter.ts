import settings from "./settings";

type RateWindow = { startedAt: number; count: number };

export class FixedWindowRateLimiter {
    private readonly windows = new Map<string, RateWindow>();
    private nextPruneAt = 0;

    constructor(
        private readonly windowMs: number,
        private readonly limit: number,
        private readonly maximumKeys = settings.value.rateLimiterMaximumKeys,
    ) {
        if (!Number.isFinite(windowMs) || windowMs <= 0)
            throw new Error("windowMs must be positive");
        if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be positive");
    }

    consume(key: string, now = Date.now()): boolean {
        const current = this.windows.get(key);
        if (!current || now - current.startedAt >= this.windowMs) {
            this.prune(now);
            if (!current && this.windows.size >= this.maximumKeys) return false;
            this.windows.set(key, { startedAt: now, count: 1 });
            return true;
        }
        current.count++;
        return current.count <= this.limit;
    }

    clear(): void {
        this.windows.clear();
        this.nextPruneAt = 0;
    }

    private prune(now: number): void {
        if (this.windows.size < Math.min(1_000, this.maximumKeys)) return;
        if (now < this.nextPruneAt) return;
        this.nextPruneAt = now + Math.min(this.windowMs, 1_000);
        for (const [key, value] of this.windows) {
            if (now - value.startedAt >= this.windowMs) this.windows.delete(key);
            else this.nextPruneAt = Math.min(this.nextPruneAt, value.startedAt + this.windowMs);
        }
    }
}
