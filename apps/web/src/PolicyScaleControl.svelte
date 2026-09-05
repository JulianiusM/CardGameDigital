<script context="module" lang="ts">
    export type PolicyScaleOption = {
        value: string;
        label: string;
    };
</script>

<script lang="ts">
    export let label: string;
    export let options: readonly PolicyScaleOption[];
    export let value: string;
    export let valueText: string | undefined = undefined;
    export let onChange: (value: string) => void;
    export let disabled = false;

    $: selectedIndex = Math.max(
        0,
        options.findIndex((option) => option.value === value),
    );
    $: selectedOption = options[selectedIndex];

    function select(event: Event): void {
        const index = Number((event.currentTarget as HTMLInputElement).value);
        const option = options[index];
        if (option) onChange(option.value);
    }
</script>

<div class="policy-scale-control">
    <div class="policy-scale-readout" aria-hidden="true">
        <span>{options[0]?.label}</span>
        <output>{valueText ?? selectedOption?.label}</output>
        <span>{options[options.length - 1]?.label}</span>
    </div>
    <div class="policy-scale-track">
        <input
            type="range"
            min="0"
            max={Math.max(0, options.length - 1)}
            step="1"
            value={selectedIndex}
            aria-label={label}
            aria-valuetext={valueText ?? selectedOption?.label}
            {disabled}
            on:input={select}
        />
        <div
            class="policy-scale-ticks"
            style={`--policy-scale-columns: ${Math.max(1, options.length)}`}
            aria-hidden="true"
        >
            {#each options as _option, index}
                <span class:active={index <= selectedIndex}></span>
            {/each}
        </div>
    </div>
</div>
