<script lang="ts">
    import { ApiError, couchApi, type Snapshot } from "./api";
    import SettingsModal from "./SettingsModal.svelte";
    import GameCard from "./GameCard.svelte";
    import SessionSummary from "./SessionSummary.svelte";
    import { presentation } from "./presentation";
    import { atmosphereFor, effectForCommand, sceneFor } from "./presentationMapping";
    import { messages, gameModes } from "./i18n";
    import { loadSetup, setupHref } from "./setup";

    const setup = loadSetup();
    let mode = (gameModes.find((item) => item[0] === setup.mode) ?? gameModes[0])[0];
    let playerNames = setup.groupMembers.length >= 2 ? [...setup.groupMembers] : ["Anna", "Ben"];
    const intensity = setup.maximumIntensity;
    let session: Snapshot | null = null;
    let busy = false;
    let error = "";
    let settingsOpen = false;
    let lastCardId: string | undefined;
    let startedAt = Date.now();
    let exhausted = false;
    $: unvotedPlayers =
        session?.players.filter((player) => !session?.votedPlayerIds.includes(player.id)) ?? [];
    $: cardAtmosphere = atmosphereFor(session?.currentCard);
    $: {
        const cardId = session?.currentCard?.id;
        if (cardId && cardId !== lastCardId) presentation.playEffect("reveal");
        lastCardId = cardId;
        presentation.setScene(
            sceneFor(session?.state, session?.currentCard, Boolean(session)),
            cardAtmosphere,
        );
    }

    function setPlayer(index: number, value: string): void {
        playerNames[index] = value;
        playerNames = [...playerNames];
    }
    function addPlayer(): void {
        if (playerNames.length < 20) playerNames = [...playerNames, ""];
    }
    function removePlayer(index: number): void {
        if (playerNames.length > 2)
            playerNames = playerNames.filter((_, current) => current !== index);
    }
    async function run(action: () => Promise<Snapshot>): Promise<void> {
        busy = true;
        error = "";
        exhausted = false;
        try {
            session = await action();
        } catch (cause) {
            if (cause instanceof ApiError && cause.code === "CARD_POOL_EXHAUSTED") exhausted = true;
            else if (cause instanceof ApiError && cause.code === "STALE_SESSION_REVISION")
                error = messages.couch.stale;
            else error = cause instanceof Error ? cause.message : messages.couch.genericError;
        } finally {
            busy = false;
        }
    }
    function createSession(): void {
        const players = playerNames
            .map((name) => ({ name: name.trim() }))
            .filter((player) => player.name);
        if (players.length < 2) {
            error = messages.couch.minimumPlayers;
            return;
        }
        startedAt = Date.now();
        presentation.playEffect("confirm");
        void run(() =>
            couchApi.create({
                mode,
                players,
                maximumIntensity: intensity,
                randomQuestionRatio: 0.6,
                letsTalkMetaInterval: 5,
                profileId: setup.profileId,
                adultContentConfirmed: setup.adultContentConfirmed,
                groupId: setup.groupId,
            }),
        );
    }
    function command(name: string, payload: object = {}): void {
        presentation.playEffect(effectForCommand(name));
        if (session) void run(() => couchApi.command(session!, name, payload));
    }
    $: elapsedMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60_000));
</script>

<main class:playing={session} class="couch-shell">
    {#if !session}
        <header>
            <span class="eyebrow">{messages.couch.singleDevice}</span>
            <h1>{messages.couch.players}</h1>
            <p>{messages.couch.passDevice}</p>
        </header>
    {/if}
    {#if error}<div class="error" role="alert">{error}</div>{/if}

    {#if !session}
        <section class="player-setup card-panel">
            <div class="setup-summary">
                <span>{gameModes.find((item) => item[0] === mode)?.[1]}</span><a
                    class="text-action"
                    href={setupHref("mode")}>{messages.common.change}</a
                >
            </div>
            <div class="players playful-list">
                {#each playerNames as name, index}
                    <label
                        ><span class="avatar">{index + 1}</span><input
                            aria-label={`${messages.common.person} ${index + 1}`}
                            value={name}
                            on:input={(event) => setPlayer(index, event.currentTarget.value)}
                            maxlength="40"
                        />{#if playerNames.length > 2}<button
                                class="icon"
                                aria-label={messages.common.removePerson}
                                on:click={() => removePlayer(index)}>×</button
                            >{/if}</label
                    >
                {/each}
                <button class="secondary add-player" on:click={addPlayer}
                    >{messages.common.addPerson}</button
                >
            </div>
            <button
                class="primary start"
                disabled={busy || playerNames.filter((name) => name.trim()).length < 2}
                on:click={createSession}>{messages.common.startGame} <span>→</span></button
            >
        </section>
    {:else if session.state === "ENDED"}
        <SessionSummary
            cardsShown={session.cardsShown}
            roundNumber={session.roundNumber}
            {elapsedMinutes}
            onAnotherRound={() => {
                session = null;
                createSession();
            }}
        />
    {:else}
        <section class="game-shell" data-atmosphere={cardAtmosphere}>
            <button
                class="settings-trigger in-game"
                aria-label={messages.settings.title}
                on:click={() => (settingsOpen = true)}
                ><span class="gear-icon" aria-hidden="true">⚙</span></button
            >
            <div class="status">
                <span>{messages.common.round} {session.roundNumber}</span><span
                    >{session.cardsShown} {messages.common.cards}</span
                >
            </div>
            {#if session.activePlayer}<p class="active">
                    <span>{messages.common.nowPlaying}</span>{session.activePlayer.name}
                </p>{/if}
            {#if exhausted}
                <div class="card-panel exhausted-state" role="status">
                    <h2>{messages.couch.exhausted}</h2>
                    <button class="danger" on:click={() => command("end")}
                        >{messages.common.end}</button
                    >
                </div>
            {:else if session.state === "CHOOSING_CARD_TYPE"}
                <div class="choice card-panel">
                    <span class="choice-symbol">↝</span>
                    <h2>{messages.common.truthOrDare}</h2>
                    <div>
                        <button
                            disabled={busy}
                            on:click={() => command("choose", { cardType: "QUESTION" })}
                            >{messages.common.truth}</button
                        ><button
                            disabled={busy}
                            on:click={() => command("choose", { cardType: "DARE" })}
                            >{messages.common.dare}</button
                        >
                    </div>
                </div>
            {:else if session.state === "WAITING_FOR_PLAYER"}
                <div class="card-panel center turn-ready">
                    <span class="orbit-symbol">✦</span>
                    <h2>{messages.common.ready}</h2>
                    <button class="primary" disabled={busy} on:click={() => command("start")}
                        >{messages.common.reveal}</button
                    >
                </div>
            {:else if session.currentCard}
                <GameCard card={session.currentCard} showIntensity />
                {#if session.state === "COLLECTING_ANSWERS"}<div class="voting">
                        <h2>{messages.couch.voteRemaining}: {unvotedPlayers.length}</h2>
                        {#each unvotedPlayers as player}<div>
                                <strong>{player.name}</strong><button
                                    disabled={busy}
                                    on:click={() =>
                                        command("vote", { playerId: player.id, vote: "YES" })}
                                    >{messages.common.yes}</button
                                ><button
                                    disabled={busy}
                                    on:click={() =>
                                        command("vote", { playerId: player.id, vote: "NO" })}
                                    >{messages.common.no}</button
                                >
                            </div>{/each}
                    </div>
                {:else if session.state === "SHOWING_RESULTS"}<div class="result">
                        {messages.common.result(session.voteResult.yes, session.voteResult.total)}
                    </div>{/if}
                <div class="actions">
                    <button class="secondary" disabled={busy} on:click={() => command("skip")}
                        >{messages.common.skip}</button
                    >{#if session.state !== "COLLECTING_ANSWERS"}<button
                            class="primary"
                            disabled={busy}
                            on:click={() => command("advance")}>{messages.common.next}</button
                        >{/if}
                </div>
            {/if}
        </section>
        <SettingsModal bind:open={settingsOpen} onEnd={() => command("end")} />
    {/if}
</main>
