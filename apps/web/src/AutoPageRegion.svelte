<script lang="ts">
    import { afterUpdate, onMount, tick } from "svelte";

    export let itemCount = 0;
    export let rowHeight = 48;
    export let minColumnWidth = 190;
    export let grid = true;
    export let intervalMs = 4800;
    export let label = "";

    let viewport: HTMLElement;
    let content: HTMLElement;
    let page = 0;
    let pageSize = 1;
    let maximumPageSize = 1;
    let measuredWidth = -1;
    let measuredHeight = -1;
    let lastLayoutKey = "";
    let fitQueued = false;
    let fitFrame = 0;
    let requestedPageHoldUntil = 0;
    let shownPage = -1;
    let pageShownAt = 0;

    $: pageCount = Math.max(1, Math.ceil(itemCount / pageSize));
    $: layoutKey = `${itemCount}:${pageSize}`;
    $: if (layoutKey !== lastLayoutKey) {
        page = 0;
        lastLayoutKey = layoutKey;
    }
    $: if (page >= pageCount) page = 0;
    $: start = page * pageSize;
    $: end = Math.min(itemCount, start + pageSize);
    $: if (shownPage !== page) {
        shownPage = page;
        pageShownAt = performance.now();
    }

    function measure(): void {
        if (!viewport) return;
        const width = viewport.clientWidth;
        const height = viewport.clientHeight;
        const availableHeight = Math.max(rowHeight, height - 26);
        const rows = Math.max(1, Math.floor(availableHeight / rowHeight));
        const columns = grid ? Math.max(1, Math.floor(width / minColumnWidth)) : 1;
        const nextMaximumPageSize = rows * columns;
        if (
            width === measuredWidth &&
            height === measuredHeight &&
            nextMaximumPageSize === maximumPageSize
        ) {
            return;
        }
        measuredWidth = width;
        measuredHeight = height;
        maximumPageSize = nextMaximumPageSize;
        pageSize = maximumPageSize;
        queueFitCheck();
    }

    function queueFitCheck(): void {
        if (fitQueued || !content) return;
        fitQueued = true;
        fitFrame = window.requestAnimationFrame(() => {
            fitQueued = false;
            void fitRenderedItems();
        });
    }

    async function fitRenderedItems(): Promise<void> {
        await tick();
        if (!content || pageSize <= 1) return;
        const { fittingItems, renderedItems } = renderedItemFit();
        if (renderedItems > 0 && fittingItems < renderedItems) {
            pageSize = fittingItems > 0 ? fittingItems : pageSize - 1;
            return;
        }
        const overflowsVertically = content.scrollHeight > content.clientHeight + 0.5;
        const overflowsHorizontally = content.scrollWidth > content.clientWidth + 0.5;
        if (overflowsVertically || overflowsHorizontally || hasPaintedOverflow()) pageSize -= 1;
    }

    function renderedItemFit(): { fittingItems: number; renderedItems: number } {
        if (!content || !(content.firstElementChild instanceof HTMLElement)) {
            return { fittingItems: pageSize, renderedItems: pageSize };
        }
        const bounds = content.getBoundingClientRect();
        const items = Array.from(content.firstElementChild.children).filter(
            (element): element is HTMLElement => element instanceof HTMLElement,
        );
        let fittingItems = 0;
        for (const item of items) {
            const rect = item.getBoundingClientRect();
            const contained =
                rect.left >= bounds.left - 0.5 &&
                rect.right <= bounds.right + 0.5 &&
                rect.top >= bounds.top - 0.5 &&
                rect.bottom <= bounds.bottom + 0.5;
            if (!contained) break;
            fittingItems += 1;
        }
        return { fittingItems, renderedItems: items.length };
    }

    function hasPaintedOverflow(): boolean {
        if (!content) return false;
        const bounds = content.getBoundingClientRect();
        const descendants = Array.from(content.querySelectorAll<HTMLElement>("*"));
        return descendants.some((element) => {
            const style = window.getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden") return false;
            const rect = element.getBoundingClientRect();
            if (rect.width < 0.5 || rect.height < 0.5) return false;
            const clipsOwnContent =
                (element.scrollWidth > element.clientWidth + 2 &&
                    !/auto|scroll/.test(style.overflowX)) ||
                element.scrollHeight > element.clientHeight + 2;
            return (
                clipsOwnContent ||
                rect.left < bounds.left - 0.5 ||
                rect.right > bounds.right + 0.5 ||
                rect.top < bounds.top - 0.5 ||
                rect.bottom > bounds.bottom + 0.5
            );
        });
    }

    function requestPage(event: CustomEvent<number | { page: number }>): void {
        const requested =
            typeof event.detail === "number" ? event.detail : Number(event.detail?.page ?? 0);
        if (!Number.isFinite(requested)) return;
        requestedPageHoldUntil = performance.now() + intervalMs;
        page = Math.min(pageCount - 1, Math.max(0, Math.trunc(requested)));
    }

    function listenForPageRequest(node: HTMLElement): { destroy: () => void } {
        const listener = (event: Event) =>
            requestPage(event as CustomEvent<number | { page: number }>);
        node.addEventListener("autopage-request", listener);
        return { destroy: () => node.removeEventListener("autopage-request", listener) };
    }

    afterUpdate(queueFitCheck);

    onMount(() => {
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        measure();
        const timer = window.setInterval(() => {
            const labelsReadyAt = Math.max(
                0,
                ...Array.from(
                    content.querySelectorAll<HTMLElement>("[data-text-scroll-ready-at]"),
                    (label) => Number(label.dataset.textScrollReadyAt),
                ),
            );
            if (
                !document.hidden &&
                pageCount > 1 &&
                performance.now() >= requestedPageHoldUntil &&
                performance.now() >= labelsReadyAt &&
                !content.querySelector("[data-text-scroll-paused]") &&
                performance.now() - pageShownAt >= intervalMs
            ) {
                page = (page + 1) % pageCount;
            }
        }, intervalMs);
        return () => {
            observer.disconnect();
            window.clearInterval(timer);
            window.cancelAnimationFrame(fitFrame);
        };
    });
</script>

<div
    class="auto-page-region"
    bind:this={viewport}
    aria-label={label}
    data-page={page}
    data-page-size={pageSize}
    data-page-count={pageCount}
    data-maximum-page-size={maximumPageSize}
    use:listenForPageRequest
>
    {#key page}
        <div class="auto-page-content" bind:this={content}>
            <slot {start} {end} {page} {pageCount} />
        </div>
    {/key}
    {#if pageCount > 1}
        <div class="auto-page-status" aria-live="polite">
            <span>{page + 1} / {pageCount}</span>
            <span class="auto-page-dots" aria-hidden="true">
                {#each Array(Math.min(pageCount, 7)) as _, index}<i
                        class:active={pageCount <= 7
                            ? index === page
                            : index === Math.round((page / Math.max(1, pageCount - 1)) * 6)}
                    ></i>{/each}
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
        background: rgb(var(--rgb-espresso) / 22%);
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
