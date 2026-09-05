<script lang="ts">
    import AutoPageText from "./AutoPageText.svelte";
    import { messages } from "./i18n";

    export let urls: readonly string[] = [];
    export let autoPage = false;
</script>

{#if urls.length}
    <section class:auto-page={autoPage} class="room-availability-urls">
        <small>{messages.room.availableUrls}</small>
        {#if autoPage}
            <div class="room-url-pages">
                <AutoPageText text={urls.join("\n")} element="code" variant="url" />
            </div>
        {:else}
            <ul>
                {#each urls as url (url)}<li><code title={url}>{url}</code></li>{/each}
            </ul>
        {/if}
    </section>
{/if}

<style>
    .room-availability-urls {
        display: grid;
        gap: 0.2rem;
        width: min(100%, 34rem);
        max-height: 8.5rem;
        margin: 0.75rem auto 0;
        padding: 0.4rem 0.55rem;
        overflow-y: auto;
        border: 1px solid rgb(107 68 42 / 14%);
        border-radius: 12px;
        color: var(--color-muted-cocoa);
        background: rgb(var(--rgb-warm-paper) / 52%);
        text-align: start;
        scrollbar-color: rgb(166 104 18 / 50%) transparent;
    }
    .room-availability-urls > small {
        font-size: clamp(9px, 0.62rem, 10px);
        font-weight: 750;
        letter-spacing: 0.04em;
        line-height: 1.1;
        text-transform: uppercase;
    }
    ul {
        display: grid;
        gap: 0.25rem;
        min-width: 0;
        margin: 0;
        padding: 0;
        list-style: none;
    }
    li {
        min-width: 0;
    }
    code {
        display: block;
        min-width: 0;
        color: var(--color-espresso);
        font-family: inherit;
        font-size: clamp(0.68rem, 1.8vw, 0.78rem);
        font-weight: 600;
        line-height: 1.25;
        overflow-wrap: anywhere;
    }
    .room-availability-urls.auto-page {
        grid-template-rows: auto minmax(0, 1fr);
        min-height: 0;
        max-height: none;
        overflow: hidden;
    }
    .room-url-pages {
        width: 100%;
        height: clamp(5.5rem, 18vh, 10rem);
        min-height: 0;
    }
</style>
