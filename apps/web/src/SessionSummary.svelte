<script lang="ts">
    import { messages } from "./i18n";
    import UiIcon from "./UiIcon.svelte";
    export let cardsShown: number;
    export let roundNumber: number;
    export let elapsedMinutes: number;
    export let onAnotherRound: (() => void) | undefined = undefined;
    export let onNewGame: (() => void) | undefined = undefined;
    export let onExit: (() => void) | undefined = undefined;
    export let exitLabel = "";
    export let exitDanger = false;
</script>

<section class="session-summary card-panel">
    <span class="summary-spark" aria-hidden="true"><UiIcon name="spark" /></span>
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
        {#if onNewGame}<button
                class:primary={!onAnotherRound}
                class:secondary={Boolean(onAnotherRound)}
                on:click={onNewGame}>{messages.end.newGame}</button
            >{:else if !onAnotherRound}<p class="waiting-for-host">
                {messages.end.waitingForHost}
            </p>{/if}
        {#if onExit}<button
                class:danger={exitDanger}
                class:secondary={!exitDanger}
                on:click={onExit}>{exitLabel}</button
            >{/if}
    </div>
</section>
