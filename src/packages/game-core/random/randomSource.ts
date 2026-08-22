export interface RandomSource {
    nextFloat(): number;
    nextInt(maxExclusive: number): number;
}

export class SequenceRandomSource implements RandomSource {
    private index = 0;
    constructor(private readonly values: readonly number[]) {
        if (!values.length || values.some((value) => value < 0 || value >= 1))
            throw new RangeError("Sequence values must be in [0, 1)");
    }
    nextFloat(): number {
        return this.values[this.index++ % this.values.length];
    }
    nextInt(maxExclusive: number): number {
        return Math.floor(this.nextFloat() * maxExclusive);
    }
}
