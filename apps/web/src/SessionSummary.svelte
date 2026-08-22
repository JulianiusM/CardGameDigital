<script lang="ts">
    import { messages } from "./i18n";
    export let cardsShown: number;
    export let roundNumber: number;
    export let elapsedMinutes: number;
    export let onAnotherRound: (() => void) | undefined;
</script>

<section class="session-summary card-panel">
    <span class="summary-spark" aria-hidden="true">✦</span>
    <h1>{messages.end.title}</h1>
    <p>{messages.end.subtitle}</p>
    <div class="summary-stats">
        <div><strong>{cardsShown}</strong><span>{messages.common.cards}</span></div>
        <div><strong>{roundNumber}</strong><span>{messages.common.rounds}</span></div>
        <div><strong>{elapsedMinutes}</strong><span>{messages.end.minutes}</span></div>
    </div>
    <div class="summary-actions">
        {#if onAnotherRound}
            <button class="primary" on:click={onAnotherRound}>
                {messages.end.anotherRound}
            </button>
        {/if}
        <a
            class:primary={!onAnotherRound}
            class:secondary={Boolean(onAnotherRound)}
            class="button-link"
            href="/play/"
        >
            {messages.end.newGame}
        </a>
    </div>
</section>
