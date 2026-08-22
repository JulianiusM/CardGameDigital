<script lang="ts">
    export let title: string;
</script>

<main class="article-shell">
    <article class="card-panel article-panel">
        <header class="article-header"><h1>{title}</h1></header>
        <slot name="navigation" />
        <div class="article-content"><slot /></div>
    </article>
</main>
