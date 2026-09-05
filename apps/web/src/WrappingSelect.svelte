<script context="module" lang="ts">
    export type WrappingSelectOption = {
        value: string;
        label: string;
    };
</script>

<script lang="ts">
    import { tick } from "svelte";

    export let value = "";
    export let options: readonly WrappingSelectOption[] = [];
    export let label: string;
    export let onChange: (value: string) => void;
    export let searchable = true;

    let open = false;
    let query = "";
    let summary: HTMLElement;

    $: selectedOption = options.find((option) => option.value === value) ?? options[0];
    $: normalizedQuery = query.trim().toLocaleLowerCase();
    $: visibleOptions = normalizedQuery
        ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalizedQuery))
        : options;
    $: showSearch = searchable && options.length > 8;

    async function choose(nextValue: string): Promise<void> {
        onChange(nextValue);
        open = false;
        query = "";
        await tick();
        summary?.focus();
    }

    function toggle(): void {
        if (!open) query = "";
    }

    function closeOnEscape(event: KeyboardEvent): void {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        open = false;
        void tick().then(() => summary?.focus());
    }
</script>

<svelte:window on:keydown={closeOnEscape} />

<details class="wrapping-select" bind:open on:toggle={toggle}>
    <summary bind:this={summary} aria-label={label}>
        <span>{selectedOption?.label ?? label}</span>
        <b aria-hidden="true">⌄</b>
    </summary>
    <div class="wrapping-select-menu">
        {#if showSearch}
            <label class="wrapping-select-search">
                <span>{label}</span>
                <input type="search" bind:value={query} />
            </label>
        {/if}
        <div class="wrapping-select-options" role="list" aria-label={label}>
            {#each visibleOptions as option}
                <button
                    type="button"
                    aria-pressed={option.value === value}
                    class:selected={option.value === value}
                    on:click={() => choose(option.value)}>{option.label}</button
                >
            {/each}
        </div>
    </div>
</details>

<style>
    .wrapping-select {
        position: relative;
        width: 100%;
        min-width: 0;
        color: var(--color-espresso);
        font-weight: 650;
    }
    summary {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.65rem;
        width: 100%;
        min-width: 0;
        min-height: 48px;
        padding: 0.7rem 0.85rem;
        border: 1px solid var(--color-edge-strong);
        border-radius: 12px;
        background: rgb(var(--rgb-warm-paper) / 98%);
        overflow-wrap: anywhere;
        cursor: pointer;
        list-style: none;
    }
    summary::-webkit-details-marker {
        display: none;
    }
    summary > span {
        min-width: 0;
    }
    summary > b {
        font-size: 1.2rem;
        line-height: 1;
    }
    .wrapping-select[open] summary > b {
        transform: rotate(180deg);
    }
    .wrapping-select-menu {
        display: grid;
        gap: 0.5rem;
        margin-top: 0.4rem;
        padding: 0.5rem;
        border: 1px solid var(--color-edge);
        border-radius: 12px;
        background: var(--color-warm-paper);
        box-shadow: var(--shadow-control);
    }
    .wrapping-select-search {
        display: grid;
        gap: 0.3rem;
        min-width: 0;
        color: var(--color-muted-cocoa);
        font-size: 0.78rem;
    }
    .wrapping-select-search input {
        width: 100%;
        min-height: 44px;
        padding: 0.65rem 0.75rem;
        color: var(--color-espresso);
        border: 1px solid var(--color-edge-strong);
        border-radius: 10px;
        background: rgb(var(--rgb-soft-cream) / 80%);
    }
    .wrapping-select-options {
        display: grid;
        grid-auto-rows: max-content;
        align-content: start;
        gap: 0.3rem;
        max-height: min(18rem, 45vh);
        overflow-y: auto;
        overscroll-behavior: contain;
    }
    .wrapping-select-options button {
        width: 100%;
        min-width: 0;
        min-height: 44px;
        height: max-content;
        padding: 0.65rem 0.75rem;
        color: var(--color-espresso);
        text-align: left;
        border: 1px solid transparent;
        border-radius: 10px;
        background: transparent;
        box-shadow: none;
        overflow-wrap: anywhere;
        line-height: 1.3;
        white-space: normal;
        transform: none !important;
    }
    .wrapping-select-options button:hover,
    .wrapping-select-options button:focus-visible,
    .wrapping-select-options button.selected {
        border-color: var(--color-selection-edge);
        background: rgb(var(--rgb-sunflower) / 34%);
        box-shadow: none;
    }
    summary:focus-visible,
    .wrapping-select-options button:focus-visible {
        outline-offset: -4px;
    }
</style>
