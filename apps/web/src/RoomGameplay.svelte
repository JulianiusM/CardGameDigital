<script lang="ts">
    import GameCard from "./GameCard.svelte";
    import NeverHaveIEverVoting from "./NeverHaveIEverVoting.svelte";
    import ParticipantRoster from "./ParticipantRoster.svelte";
    import SessionSummary from "./SessionSummary.svelte";
    import { messages } from "./i18n";
    import { elapsedMinutes as minutesSince } from "./elapsedTime";
    import type { Participant, Presence, Role, SessionView } from "./multiplayer";

    export let session: SessionView;
    export let role: Role;
    export let onCommand: (type: string, payload?: object) => void;
    export let onOpenSettings: () => void;
    export let onNewGame: (() => void) | undefined;
    export let onSummaryExit: () => void;
    export let summaryExitLabel: string;
    export let summaryExitDanger = false;
    export let participants: Participant[];
    export let presence: Presence[];
    export let roomCode: string;
    export let exhausted: boolean;
    export let cardReplacementSequence = 0;
    export let cardReplacementReason: "SKIPPED" | "VETOED" | "" = "";

    $: actions = new Set(session.availableActions);
    $: elapsedMinutes = minutesSince(session.startedAt);
    $: showingVotingResults = Boolean(session.neverHaveIEverVoting?.result);
</script>

<section
    class:public-stage={role === "DISPLAY"}
    class:ended-stage={role === "DISPLAY" && session.state === "ENDED"}
    class="game-shell"
>
    <div class="stage-status">
        <div class="status">
            <span>{messages.common.round} {session.roundNumber}</span>
            <span>{session.cardsShown} {messages.common.cards}</span>
            <span class="live">{messages.room.live}</span>
        </div>
        {#if role === "DISPLAY"}<strong class="stage-room-code">{roomCode}</strong>{/if}
    </div>
    <ParticipantRoster
        {participants}
        {presence}
        stage={role === "DISPLAY"}
        includeDisplays={false}
        {roomCode}
    />

    {#if session.activePlayer}
        <p class="active-player">
            <span>{messages.common.nowPlaying}</span>
            {session.activePlayer.name}
        </p>
    {/if}

    {#if exhausted}
        <div class="card-panel exhausted-state game-phase" role="status">
            <h2>{messages.couch.exhausted}</h2>
            <button class="secondary" on:click={onOpenSettings}>{messages.settings.title}</button>
            {#if role === "HOST"}<button
                    class="danger"
                    on:click={() => onCommand("command.endSession")}>{messages.common.end}</button
                >{/if}
        </div>
    {:else if session.state === "ENDED"}
        <div class="summary-phase game-phase">
            <SessionSummary
                cardsShown={session.cardsShown}
                roundNumber={session.roundNumber}
                {elapsedMinutes}
                {onNewGame}
                onExit={onSummaryExit}
                exitLabel={summaryExitLabel}
                exitDanger={summaryExitDanger}
            />
        </div>
    {:else if session.state === "CHOOSING_CARD_TYPE"}
        <div class="choice card-panel game-phase">
            <h2>
                {actions.has("CHOOSE_CARD_TYPE")
                    ? messages.room.privateChoice
                    : messages.common.truthOrDare}
            </h2>
            {#if actions.has("CHOOSE_CARD_TYPE")}
                <div>
                    <button
                        on:click={() =>
                            onCommand("command.chooseCardType", { cardType: "QUESTION" })}
                    >
                        {messages.common.truth}
                    </button>
                    <button
                        on:click={() => onCommand("command.chooseCardType", { cardType: "DARE" })}
                    >
                        {messages.common.dare}
                    </button>
                </div>
            {:else}
                <p>{messages.room.remoteChoice}</p>
            {/if}
        </div>
    {:else if session.state === "WAITING_FOR_PLAYER"}
        <div class="card-panel center game-phase">
            <h2>{messages.common.ready}</h2>
            {#if actions.has("ADVANCE_SESSION")}
                <button class="primary" on:click={() => onCommand("command.startTurn")}>
                    {messages.common.reveal}
                </button>
            {/if}
        </div>
    {:else if session.currentCard}
        <div
            class:with-public-voting={session.neverHaveIEverVoting}
            class:voting-results={showingVotingResults}
            class:anonymous-voting-results={showingVotingResults &&
                session.neverHaveIEverVoting?.revealMode === "ANONYMOUS_AGGREGATE"}
            class:voting-collection={session.neverHaveIEverVoting && !showingVotingResults}
            class="gameplay-focus game-phase"
        >
            {#key `${session.currentCard.id}:${cardReplacementSequence}`}
                <GameCard
                    card={session.currentCard}
                    showIntensity
                    compact={role === "DISPLAY" && showingVotingResults}
                    replacementDraw={Boolean(cardReplacementReason)}
                />
            {/key}

            {#if session.neverHaveIEverVoting}
                <NeverHaveIEverVoting
                    voting={session.neverHaveIEverVoting}
                    controllablePlayerIds={actions.has("SUBMIT_VOTE")
                        ? session.controllablePlayers.map(({ id }) => id)
                        : []}
                    stage={role === "DISPLAY"}
                    onVote={(playerId, vote) => onCommand("command.submitVote", { playerId, vote })}
                />
            {/if}
        </div>

        <div class="actions">
            {#if actions.has("VETO_CARD")}
                <button class="secondary" on:click={() => onCommand("command.vetoCard")}>
                    {messages.room.otherCard}
                </button>
            {/if}
            {#if actions.has("SKIP_CARD")}
                <button class="secondary" on:click={() => onCommand("command.skipCard")}>
                    {messages.common.skip}
                </button>
            {/if}
            {#if actions.has("ADVANCE_SESSION")}
                <button class="primary" on:click={() => onCommand("command.advanceSession")}>
                    {messages.common.next}
                </button>
            {/if}
        </div>
    {/if}
</section>
