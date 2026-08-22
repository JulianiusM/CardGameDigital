<script lang="ts">
    import { onMount } from "svelte";
    import { locale, messages } from "./i18n";
    let title = messages.help.title;
    let html = "";
    let error = "";
    let documents: Array<{ slug: string; title: string }> = [];

    async function load(slug: string): Promise<void> {
        error = "";
        const response = await fetch(`/api/v1/help/${encodeURIComponent(slug)}`, {
            headers: { "accept-language": locale },
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? messages.help.loadFailed);
        title = body.title;
        html = body.html;
    }

    async function selectDocument(slug: string): Promise<void> {
        try {
            await load(slug);
        } catch (cause) {
            error = cause instanceof Error ? cause.message : messages.help.loadFailed;
        }
    }

    onMount(async () => {
        try {
            const response = await fetch("/api/v1/help", {
                headers: { "accept-language": locale },
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error?.message ?? messages.help.loadFailed);
            documents = body.documents;
            await load("readme");
        } catch (cause) {
            error = cause instanceof Error ? cause.message : messages.help.loadFailed;
        }
    });
</script>

<main class="account-shell">
    <nav class="account-nav">
        <a href="/play/">{messages.help.backToGame}</a><a href="/play/account"
            >{messages.help.account}</a
        >
    </nav>
    <article class="card-panel help-panel">
        <h1>{title}</h1>
        <nav class="help-topics" aria-label={messages.help.topics}>
            {#each documents as document}
                <button class="secondary" on:click={() => selectDocument(document.slug)}>
                    {document.title}
                </button>
            {/each}
        </nav>
        {#if error}<p class="error">{error}</p>{:else}<div class="help-content">
                {@html html}
            </div>{/if}
    </article>
</main>
