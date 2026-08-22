<script lang="ts">
    export type ResponsiveTab = { id: string; label: string; icon?: string };
    export let tabs: readonly ResponsiveTab[];
    export let selected: string;
    export let label: string;
    export let onSelect: (id: string) => void;

    function keydown(event: KeyboardEvent, index: number): void {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        onSelect(tabs[next].id);
        requestAnimationFrame(() => {
            const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll(
                "button",
            );
            buttons?.[next]?.focus();
        });
    }
</script>

<div class="responsive-tabs" role="tablist" aria-label={label}>
    {#each tabs as tab, index}
        <button
            type="button"
            role="tab"
            aria-selected={selected === tab.id}
            class:active={selected === tab.id}
            tabindex={selected === tab.id ? 0 : -1}
            on:click={() => onSelect(tab.id)}
            on:keydown={(event) => keydown(event, index)}
        >
            {#if tab.icon}<span aria-hidden="true">{tab.icon}</span>{/if}
            <span>{tab.label}</span>
        </button>
    {/each}
</div>
