import { randomInt } from "node:crypto";
import type { RandomSource } from "../game-core";

export class CryptoRandomSource implements RandomSource {
    nextInt(maxExclusive: number): number {
        if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0)
            throw new RangeError("maxExclusive must be a positive safe integer");
        return randomInt(maxExclusive);
    }
    nextFloat(): number {
        return this.nextInt(0x1_0000_0000) / 0x1_0000_0000;
    }
}
