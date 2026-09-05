<script context="module" lang="ts">
    export type ResponsiveTab = { id: string; label: string; icon?: string };
</script>

<script lang="ts">
    import { onMount, tick } from "svelte";
    import { messages } from "./i18n";
    import UiIcon from "./UiIcon.svelte";

    export let tabs: readonly ResponsiveTab[];
    export let selected: string;
    export let label: string;
    export let onSelect: (id: string) => void;

    let viewport: HTMLDivElement;
    let atStart = true;
    let atEnd = true;
    let lastSelected = "";

    function reducedMotion(): boolean {
        return (
            document.documentElement.dataset.reducedMotion === "true" ||
            matchMedia("(prefers-reduced-motion: reduce)").matches
        );
    }
    function measure(): void {
        if (!viewport) return;
        viewport.style.setProperty("--responsive-tabs-viewport-width", `${viewport.clientWidth}px`);
        atStart = viewport.scrollLeft <= 1;
        atEnd = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1;
    }
    function scroll(direction: -1 | 1): void {
        viewport.scrollBy({
            left: direction * Math.max(160, viewport.clientWidth * 0.7),
            behavior: reducedMotion() ? "auto" : "smooth",
        });
    }
    async function revealSelected(behavior?: ScrollBehavior): Promise<void> {
        await tick();
        const active = viewport?.querySelector<HTMLElement>("[data-tab-selected='true']");
        if (!active) return;

        const viewportBounds = viewport.getBoundingClientRect();
        const activeBounds = active.getBoundingClientRect();
        const viewportCenter = viewportBounds.left + viewport.clientLeft + viewport.clientWidth / 2;
        const activeCenter = activeBounds.left + activeBounds.width / 2;
        const targetLeft = viewport.scrollLeft + activeCenter - viewportCenter;
        viewport.scrollTo({
            left: targetLeft,
            behavior: behavior ?? (reducedMotion() ? "auto" : "smooth"),
        });
        requestAnimationFrame(measure);
    }
    function select(id: string): void {
        onSelect(id);
        void revealSelected();
    }
    function keydown(event: KeyboardEvent, index: number): void {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        select(tabs[next].id);
        requestAnimationFrame(() => {
            viewport.querySelectorAll<HTMLButtonElement>("button[role='tab']")[next]?.focus();
        });
    }

    $: if (viewport && selected !== lastSelected) {
        lastSelected = selected;
        void revealSelected();
    }

    onMount(() => {
        const observer = new ResizeObserver(() => {
            measure();
            void revealSelected("auto");
        });
        observer.observe(viewport);
        measure();
        void revealSelected();
        return () => observer.disconnect();
    });
</script>

<div class="responsive-tabs-shell">
    <button
        type="button"
        class="tab-scroll-arrow previous"
        aria-label={`${label}: ${messages.common.previous}`}
        disabled={atStart}
        on:click={() => scroll(-1)}>‹</button
    >
    <div
        class="responsive-tabs"
        role="tablist"
        aria-label={label}
        bind:this={viewport}
        on:scroll={measure}
    >
        {#each tabs as tab, index}
            <button
                type="button"
                role="tab"
                aria-selected={selected === tab.id}
                data-tab-selected={selected === tab.id}
                class:active={selected === tab.id}
                tabindex={selected === tab.id ? 0 : -1}
                on:click={() => select(tab.id)}
                on:keydown={(event) => keydown(event, index)}
            >
                {#if tab.icon}<span aria-hidden="true"><UiIcon name={tab.icon} /></span>{/if}
                <span>{tab.label}</span>
            </button>
        {/each}
    </div>
    <button
        type="button"
        class="tab-scroll-arrow next"
        aria-label={`${label}: ${messages.common.next}`}
        disabled={atEnd}
        on:click={() => scroll(1)}>›</button
    >
</div>
