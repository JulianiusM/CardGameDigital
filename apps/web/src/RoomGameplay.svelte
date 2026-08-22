<script lang="ts">
    import GameCard from "./GameCard.svelte";
    import SessionSummary from "./SessionSummary.svelte";
    import { messages } from "./i18n";
    import type { Participant, Presence, Role, SessionView } from "./multiplayer";

    export let session: SessionView;
    export let role: Role;
    export let startedAt: number;
    export let onCommand: (type: string, payload?: object) => void;
    export let onOpenSettings: () => void;
    export let participants: Participant[];
    export let presence: Presence[];
    export let roomCode: string;
    export let exhausted: boolean;

    $: actions = new Set(session.availableActions);
    $: elapsedMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60_000));
    $: pendingVotes = session.controllablePlayers.filter((player) => !player.hasVoted);
</script>

<section class="game-shell">
    <button
        class="settings-trigger in-game"
        aria-label={messages.settings.title}
        on:click={onOpenSettings}
    >
        <span class="gear-icon" aria-hidden="true">⚙</span>
    </button>

    <div class="status">
        <span>{messages.common.round} {session.roundNumber}</span>
        <span>{session.cardsShown} {messages.common.cards}</span>
        <span class="live">{messages.room.live}</span>
    </div>

    <details class="live-players">
        <summary>{messages.settings.players} · {session.players.length}</summary>
        <div class="participant-list">
            {#each participants.filter((participant) => participant.role !== "DISPLAY") as participant}
                <div class="participant">
                    <span
                        class:online={presence.some(
                            ({ participantId }) => participantId === participant.id,
                        )}
                    ></span>
                    <strong>{participant.displayName}</strong><small>{participant.role}</small>
                </div>
                {#each participant.devicePlayers as player}<div class="participant device-player">
                        <span></span><strong>{player.name}</strong><small
                            >{participant.displayName}</small
                        >
                    </div>{/each}
            {/each}
        </div>
        <small>{messages.setup.roomCode}: {roomCode}</small>
    </details>

    {#if session.activePlayer}
        <p class="active-player">
            <span>{messages.common.nowPlaying}</span>
            {session.activePlayer.name}
        </p>
    {/if}

    {#if exhausted}
        <div class="card-panel exhausted-state" role="status">
            <h2>{messages.couch.exhausted}</h2>
            <button class="secondary" on:click={onOpenSettings}>{messages.settings.title}</button>
            {#if role === "HOST"}<button
                    class="danger"
                    on:click={() => onCommand("command.endSession")}>{messages.common.end}</button
                >{/if}
        </div>
    {:else if session.state === "ENDED"}
        <SessionSummary
            cardsShown={session.cardsShown}
            roundNumber={session.roundNumber}
            {elapsedMinutes}
        />
    {:else if session.state === "CHOOSING_CARD_TYPE"}
        <div class="choice card-panel">
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
        <div class="card-panel center">
            <h2>{messages.common.ready}</h2>
            {#if actions.has("ADVANCE_SESSION")}
                <button class="primary" on:click={() => onCommand("command.startTurn")}>
                    {messages.common.reveal}
                </button>
            {/if}
        </div>
    {:else if session.currentCard}
        <GameCard card={session.currentCard} />

        {#if actions.has("SUBMIT_VOTE")}
            <div class="choice">
                {#each pendingVotes as player}
                    <div>
                        <strong>{player.name}</strong>
                        <button
                            on:click={() =>
                                onCommand("command.submitVote", {
                                    playerId: player.id,
                                    vote: "YES",
                                })}
                        >
                            {messages.common.yes}
                        </button>
                        <button
                            on:click={() =>
                                onCommand("command.submitVote", {
                                    playerId: player.id,
                                    vote: "NO",
                                })}
                        >
                            {messages.common.no}
                        </button>
                    </div>
                {/each}
            </div>
        {/if}

        {#if session.state === "SHOWING_RESULTS"}
            <div class="result">
                {messages.common.result(session.voteResult.yes, session.voteResult.total)}
            </div>
        {/if}

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
