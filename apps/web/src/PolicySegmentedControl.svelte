<script context="module" lang="ts">
    export type PolicySegmentOption = {
        value: string;
        label: string;
    };
</script>

<script lang="ts">
    export let label: string;
    export let options: readonly PolicySegmentOption[];
    export let value: string;
    export let onChange: (value: string) => void;
    export let disabled = false;
</script>

<div class="policy-segmented-control" role="group" aria-label={label}>
    {#each options as option}
        <button
            type="button"
            class:selected={value === option.value}
            aria-pressed={value === option.value}
            {disabled}
            on:click={() => onChange(option.value)}
        >
            {option.label}
        </button>
    {/each}
</div>
