<script lang="ts">
    export let value: number;
    export let min: number;
    export let max: number;
    export let step = 1;
    export let labelledBy: string;
    export let decreaseLabel: string;
    export let increaseLabel: string;
    export let onChange: (value: number) => void;

    function decimalPlaces(input: number): number {
        const [, decimals = ""] = String(input).split(".");
        return decimals.length;
    }

    function update(next: number): void {
        if (!Number.isFinite(next)) return;
        const bounded = Math.min(max, Math.max(min, next));
        const precision = decimalPlaces(step);
        onChange(Number(bounded.toFixed(precision)));
    }
</script>

<div class="number-input">
    <button
        type="button"
        aria-label={decreaseLabel}
        disabled={value <= min}
        on:click={() => update(value - step)}>−</button
    >
    <input
        type="number"
        {min}
        {max}
        {step}
        {value}
        aria-labelledby={labelledBy}
        on:change={(event) => update(event.currentTarget.valueAsNumber)}
    />
    <button
        type="button"
        aria-label={increaseLabel}
        disabled={value >= max}
        on:click={() => update(value + step)}>+</button
    >
</div>

<style>
    .number-input {
        display: grid;
        grid-template-columns: 2.75rem minmax(4rem, 5.25rem) 2.75rem;
        align-items: stretch;
        overflow: visible;
        border: 1px solid var(--color-edge-strong);
        border-radius: 14px;
        background: rgb(var(--rgb-warm-paper) / 98%);
    }
    button,
    input {
        min-height: 44px;
        color: var(--color-espresso);
        border: 0;
        background: transparent;
    }
    button {
        padding: 0;
        border-radius: 0;
        box-shadow: none;
        font-size: 1.35rem;
        font-weight: 750;
        transform: none !important;
    }
    button:first-child {
        border-radius: 13px 0 0 13px;
        border-right: 1px solid var(--color-edge);
    }
    button:last-child {
        border-radius: 0 13px 13px 0;
        border-left: 1px solid var(--color-edge);
    }
    button:not(:disabled):hover,
    button:not(:disabled):active {
        color: var(--color-espresso);
        background: var(--color-sunflower);
        box-shadow: none;
        transform: none !important;
    }
    input {
        width: 100%;
        min-width: 0;
        padding: 0.55rem 0.35rem;
        text-align: center;
        appearance: textfield;
    }
    input::-webkit-inner-spin-button,
    input::-webkit-outer-spin-button {
        margin: 0;
        appearance: none;
    }
    .number-input:focus-within {
        border-color: var(--color-selection-edge);
    }
</style>
