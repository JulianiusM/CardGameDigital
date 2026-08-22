<script lang="ts">
    import { onMount } from "svelte";
    import { locale, messages } from "./i18n";
    import ArticleLayout from "./ArticleLayout.svelte";
    let title = messages.help.title;
    let html = "";
    let error = "";
    let documents: Array<{ slug: string; title: string }> = [];
    let currentSlug = "readme";

    async function load(slug: string): Promise<void> {
        error = "";
        const response = await fetch(`/api/v1/help/${encodeURIComponent(slug)}`, {
            headers: { "accept-language": locale },
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? messages.help.loadFailed);
        title = body.title;
        html = body.html;
        currentSlug = slug;
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

<ArticleLayout {title}>
    <div slot="navigation">
        <nav class="article-back"><a href="/play/">{messages.help.backToGame}</a></nav>
        <div class="help-topics" aria-label={messages.help.topics} role="tablist">
            {#each documents as document}
                <button
                    class:active={currentSlug === document.slug}
                    role="tab"
                    aria-selected={currentSlug === document.slug}
                    on:click={() => selectDocument(document.slug)}
                >
                    {document.title}
                </button>
            {/each}
        </div>
    </div>
    {#if error}<p class="error">{error}</p>{:else}<div class="help-content">{@html html}</div>{/if}
</ArticleLayout>
