<script lang="ts">
    import { onMount, tick } from "svelte";
    import { messages } from "./i18n";

    export let text = "";
    export let element: "p" | "code" = "p";
    export let intervalMs = 4800;
    export let variant: "card" | "url" = "card";
    export let interactive = false;

    let viewport: HTMLElement;
    let copy: HTMLElement;
    let measureCopy: HTMLElement;
    let sourceText = text;
    let lastPropText = text;
    let pages = [text];
    let page = 0;
    let sourceVersion = 0;
    let lastMeasurementKey = "";
    let measurementQueued = false;
    let remeasurementRequested = false;
    let measurementFrame = 0;
    let requestedPageHoldUntil = 0;

    $: pageCount = Math.max(1, pages.length);
    $: if (page >= pageCount) page = 0;
    $: visibleText = pages[page] ?? sourceText;
    $: if (text !== lastPropText) {
        lastPropText = text;
        replaceSource(text);
    }

    function replaceSource(nextText: string): void {
        if (nextText === sourceText && pages.length > 0) return;
        sourceText = nextText;
        pages = [nextText];
        page = 0;
        sourceVersion += 1;
        lastMeasurementKey = "";
        queueMeasurement();
    }

    function queueMeasurement(): void {
        if (!viewport || !measureCopy) return;
        if (measurementQueued) {
            remeasurementRequested = true;
            return;
        }
        measurementQueued = true;
        measurementFrame = window.requestAnimationFrame(() => {
            void measurePages().finally(() => {
                measurementQueued = false;
                if (!remeasurementRequested) return;
                remeasurementRequested = false;
                queueMeasurement();
            });
        });
    }

    function candidateFits(candidate: string): boolean {
        measureCopy.textContent = candidate || "\u00a0";
        const measuredHeight = Math.max(
            measureCopy.getBoundingClientRect().height,
            measureCopy.scrollHeight,
        );
        const heightInset = variant === "url" ? 1 : 6;
        return (
            measuredHeight <= Math.max(0, viewport.clientHeight - heightInset) &&
            measureCopy.scrollWidth <= viewport.clientWidth + 0.5
        );
    }

    function fittingCharacterCount(characters: readonly string[], offset: number): number {
        const remaining = characters.length - offset;
        if (remaining <= 0) return 0;

        let lower = 1;
        let upper = Math.min(32, remaining);
        let best = 0;
        // Locate a nearby upper bound before binary search. Measuring half of a
        // 10,000-character source for every tiny page otherwise blocks the UI.
        while (candidateFits(characters.slice(offset, offset + upper).join(""))) {
            best = upper;
            if (upper === remaining) return upper;
            lower = upper + 1;
            upper = Math.min(upper * 2, remaining);
        }
        while (lower <= upper) {
            const middle = Math.floor((lower + upper) / 2);
            const candidate = characters.slice(offset, offset + middle).join("");
            if (candidateFits(candidate)) {
                best = middle;
                lower = middle + 1;
            } else {
                upper = middle - 1;
            }
        }
        return Math.max(1, best);
    }

    function isWhitespace(character: string | undefined): boolean {
        return character !== undefined && /\s/u.test(character);
    }

    function fittingPageCharacterCount(characters: readonly string[], offset: number): number {
        const fitted = fittingCharacterCount(characters, offset);
        const end = offset + fitted;
        if (end >= characters.length) return fitted;

        // Preserve source text exactly, but prefer a natural word boundary whenever one
        // is available in the measured region. Character-level paging remains necessary
        // for a single URL/token that is itself larger than the viewport.
        if (isWhitespace(characters[end - 1]) || isWhitespace(characters[end])) return fitted;
        for (let index = end - 1; index >= offset; index -= 1) {
            if (!isWhitespace(characters[index])) continue;
            const boundaryCount = index - offset + 1;
            const hasVisibleContent = characters
                .slice(offset, offset + boundaryCount)
                .some((character) => !isWhitespace(character));
            if (hasVisibleContent) return boundaryCount;
        }
        if (variant === "url") {
            for (let index = end - 1; index > offset; index -= 1) {
                if (!"/?#&".includes(characters[index] ?? "")) continue;
                return index - offset + 1;
            }
        }
        return fitted;
    }

    async function measurePages(): Promise<void> {
        const measuredVersion = sourceVersion;
        await tick();
        if (!viewport || !measureCopy || viewport.clientWidth < 1 || viewport.clientHeight < 1) {
            return;
        }

        const computed = window.getComputedStyle(copy);
        const measurementKey = [
            sourceVersion,
            viewport.clientWidth,
            viewport.clientHeight,
            computed.fontFamily,
            computed.fontSize,
            computed.fontWeight,
            computed.lineHeight,
            computed.letterSpacing,
        ].join(":");
        if (measurementKey === lastMeasurementKey) return;

        // Keep combining marks and joined emoji intact at every page boundary.
        const characters = Array.from(
            new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(sourceText),
            ({ segment }) => segment,
        );
        const nextPages: string[] = [];
        let offset = 0;
        while (offset < characters.length) {
            const count = fittingPageCharacterCount(characters, offset);
            nextPages.push(characters.slice(offset, offset + count).join(""));
            offset += count;
        }
        if (nextPages.length === 0) nextPages.push("");

        if (sourceVersion !== measuredVersion) {
            remeasurementRequested = true;
            return;
        }
        pages = nextPages;
        page = Math.min(page, nextPages.length - 1);
        lastMeasurementKey = measurementKey;
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

    onMount(() => {
        const resizeObserver = new ResizeObserver(() => {
            lastMeasurementKey = "";
            queueMeasurement();
        });
        resizeObserver.observe(viewport);

        const mutationObserver = new MutationObserver(() => {
            const actualText = copy.textContent ?? "";
            if (actualText !== visibleText) replaceSource(actualText);
        });
        mutationObserver.observe(copy, { characterData: true, childList: true, subtree: true });

        void document.fonts?.ready.then(() => {
            lastMeasurementKey = "";
            queueMeasurement();
        });
        queueMeasurement();

        const timer = window.setInterval(() => {
            if (
                !interactive &&
                !document.hidden &&
                pageCount > 1 &&
                performance.now() >= requestedPageHoldUntil
            ) {
                page = (page + 1) % pageCount;
            }
        }, intervalMs);

        return () => {
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            window.clearInterval(timer);
            window.cancelAnimationFrame(measurementFrame);
        };
    });
</script>

<div
    class:card-copy-pager={variant === "card"}
    class:url-copy-pager={variant === "url"}
    class="auto-page-text"
    data-page={page}
    data-page-count={pageCount}
    data-source-length={sourceText.length}
    use:listenForPageRequest
>
    <div class="auto-page-text-viewport" bind:this={viewport}>
        {#if element === "code"}
            <code class="auto-page-copy" bind:this={copy} aria-label={sourceText}
                >{visibleText}</code
            >
            <code
                class="auto-page-copy auto-page-measure"
                bind:this={measureCopy}
                aria-hidden="true"
            ></code>
        {:else}
            <p class="auto-page-copy" bind:this={copy} aria-label={sourceText}>{visibleText}</p>
            <p
                class="auto-page-copy auto-page-measure"
                bind:this={measureCopy}
                aria-hidden="true"
            ></p>
        {/if}
    </div>
    {#if interactive && pageCount > 1}
        <nav class="auto-page-text-controls" aria-label={`${page + 1} / ${pageCount}`}>
            <button
                class="text-action auto-page-text-button first-page-button"
                type="button"
                disabled={page === 0}
                aria-label={messages.common.firstPage}
                on:click={() => (page = 0)}>«</button
            >
            <button
                class="text-action auto-page-text-button previous-page-button"
                type="button"
                disabled={page === 0}
                aria-label={messages.common.previous}
                on:click={() => (page -= 1)}>‹</button
            >
            <span aria-live="polite">{page + 1} / {pageCount}</span>
            <button
                class="text-action auto-page-text-button next-page-button"
                type="button"
                disabled={page === pageCount - 1}
                aria-label={messages.common.next}
                on:click={() => (page += 1)}>›</button
            >
            <button
                class="text-action auto-page-text-button last-page-button"
                type="button"
                disabled={page === pageCount - 1}
                aria-label={messages.common.lastPage}
                on:click={() => (page = pageCount - 1)}>»</button
            >
        </nav>
    {:else}
        <div
            class:auto-page-status-hidden={pageCount === 1}
            class="auto-page-text-status"
            aria-live="polite"
        >
            {page + 1} / {pageCount}
        </div>
    {/if}
</div>

<style>
    .auto-page-text {
        container-type: inline-size;
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
    }
    .auto-page-text-viewport {
        position: relative;
        display: grid;
        align-items: center;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
    }
    .auto-page-copy {
        min-width: 0;
        min-height: 0;
        max-width: 100%;
        max-height: 100%;
        margin: 0 !important;
        overflow: visible;
        overflow-wrap: anywhere;
        word-break: break-word;
    }
    .auto-page-measure {
        position: absolute !important;
        inset: 0 0 auto !important;
        display: block !important;
        width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible !important;
        visibility: hidden !important;
        pointer-events: none !important;
    }
    .auto-page-text-status {
        display: grid;
        place-items: center;
        min-height: 1.4rem;
        color: var(--color-muted-cocoa);
        font-size: clamp(0.68rem, 1.5vw, 0.78rem);
        font-variant-numeric: tabular-nums;
        line-height: 1;
    }
    .auto-page-text-controls {
        display: grid;
        grid-template-columns: 44px 44px minmax(0, 1fr) 44px 44px;
        align-items: center;
        justify-content: center;
        gap: 4px;
        width: 100%;
        min-width: 0;
        min-height: 44px;
        color: var(--color-muted-cocoa);
        font-size: clamp(12px, 1.5vw, 14px);
        font-variant-numeric: tabular-nums;
        line-height: 1;
        white-space: nowrap;
    }
    .auto-page-text-button {
        display: grid;
        place-items: center;
        width: 44px;
        min-width: 44px;
        height: 44px;
        min-height: 44px;
        padding: 0;
        color: var(--color-espresso);
        border: 1px solid var(--color-edge);
        border-radius: 50%;
        background: rgb(var(--rgb-warm-paper) / 82%);
        box-shadow: none;
        font-size: 22px;
        line-height: 1;
    }
    .auto-page-text-button:focus-visible {
        outline-offset: -4px;
    }
    @container (max-width: 280px) {
        .auto-page-text-controls {
            grid-template-columns: 44px minmax(0, 1fr) 44px;
            grid-template-rows: 44px 44px;
            gap: 0;
        }
        .first-page-button {
            grid-row: 1;
            grid-column: 1;
        }
        .previous-page-button {
            grid-row: 2;
            grid-column: 1;
        }
        .auto-page-text-controls > span {
            grid-row: 1 / 3;
            grid-column: 2;
        }
        .next-page-button {
            grid-row: 2;
            grid-column: 3;
        }
        .last-page-button {
            grid-row: 1;
            grid-column: 3;
        }
    }
    .auto-page-status-hidden {
        display: none;
    }
    .url-copy-pager .auto-page-copy {
        color: var(--color-espresso);
        font-family: inherit;
        font-size: clamp(0.68rem, 1.8vw, 0.78rem);
        font-weight: 600;
        line-height: 1.25;
        white-space: pre-wrap;
    }
    .url-copy-pager .auto-page-text-status {
        min-height: 16px;
        font-size: 10px;
    }
    .url-copy-pager .auto-page-status-hidden {
        display: grid;
        visibility: hidden;
    }
    @media (prefers-reduced-motion: reduce) {
        .auto-page-copy {
            animation: none;
        }
    }
</style>
