<script lang="ts">
    import { onMount } from "svelte";

    export let itemCount = 0;
    export let rowHeight = 48;
    export let minColumnWidth = 190;
    export let grid = true;
    export let intervalMs = 4800;
    export let label = "";

    let viewport: HTMLElement;
    let page = 0;
    let pageSize = 1;
    let lastLayoutKey = "";

    $: pageCount = Math.max(1, Math.ceil(itemCount / pageSize));
    $: layoutKey = `${itemCount}:${pageSize}`;
    $: if (layoutKey !== lastLayoutKey) {
        page = 0;
        lastLayoutKey = layoutKey;
    }
    $: if (page >= pageCount) page = 0;
    $: start = page * pageSize;
    $: end = Math.min(itemCount, start + pageSize);

    function measure(): void {
        if (!viewport) return;
        const availableHeight = Math.max(rowHeight, viewport.clientHeight - 26);
        const rows = Math.max(1, Math.floor(availableHeight / rowHeight));
        const columns = grid ? Math.max(1, Math.floor(viewport.clientWidth / minColumnWidth)) : 1;
        pageSize = rows * columns;
    }

    onMount(() => {
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        measure();
        const timer = window.setInterval(() => {
            if (!document.hidden && pageCount > 1) page = (page + 1) % pageCount;
        }, intervalMs);
        return () => {
            observer.disconnect();
            window.clearInterval(timer);
        };
    });
</script>

<div
    class="auto-page-region"
    bind:this={viewport}
    aria-label={label}
    data-page-size={pageSize}
    data-page-count={pageCount}
>
    {#key page}
        <div class="auto-page-content">
            <slot {start} {end} {page} {pageCount} />
        </div>
    {/key}
    {#if pageCount > 1}
        <div class="auto-page-status" aria-live="polite">
            <span>{page + 1} / {pageCount}</span>
            <span class="auto-page-dots" aria-hidden="true">
                {#each Array(pageCount) as _, index}<i class:active={index === page}></i>{/each}
            </span>
        </div>
    {/if}
</div>

<style>
    .auto-page-region {
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
    }
    .auto-page-content {
        min-height: 0;
        overflow: hidden;
        animation: page-crossfade 240ms ease both;
    }
    .auto-page-status {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.55rem;
        min-height: 22px;
        color: var(--color-muted-cocoa);
        font-size: 0.72rem;
    }
    .auto-page-dots {
        display: flex;
        gap: 0.25rem;
    }
    .auto-page-dots i {
        width: 0.3rem;
        height: 0.3rem;
        border-radius: 50%;
        background: rgb(59 36 22 / 22%);
    }
    .auto-page-dots i.active {
        background: var(--color-selection-edge);
    }
    @keyframes page-crossfade {
        from {
            opacity: 0;
            transform: translateY(5px);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .auto-page-content {
            animation: page-opacity 200ms ease both;
        }
    }
    :global(:root[data-reduced-motion="true"]) .auto-page-content {
        animation: page-opacity 200ms ease both;
    }
    @keyframes page-opacity {
        from {
            opacity: 0;
        }
    }
</style>
