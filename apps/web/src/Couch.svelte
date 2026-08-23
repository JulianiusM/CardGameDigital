<script lang="ts">
    import { onMount } from "svelte";
    import { ApiError, couchApi, type Snapshot } from "./api";
    import SettingsModal from "./SettingsModal.svelte";
    import SettingsTrigger from "./SettingsTrigger.svelte";
    import GameCard from "./GameCard.svelte";
    import SessionSummary from "./SessionSummary.svelte";
    import NeverHaveIEverVoting from "./NeverHaveIEverVoting.svelte";
    import PlayerNameRow from "./PlayerNameRow.svelte";
    import { presentation } from "./presentation";
    import { atmosphereFor, effectForCommand, sceneFor } from "./presentationMapping";
    import { messages, gameModes } from "./i18n";
    import { elapsedMinutes as minutesSince } from "./elapsedTime";
    import { navigate } from "./router";
    import { dismissNotification, showNotification } from "./notifications";
    import { loadSetup, resetSetup, setupHref, setupRoomSettings } from "./setup";
    import {
        loadCardLocales,
        loadGameProfiles,
        type CardLocaleSummary,
        type GameProfileSummary,
    } from "./multiplayer";

    const setup = loadSetup();
    let mode = (gameModes.find((item) => item[0] === setup.mode) ?? gameModes[0])[0];
    let playerNames = setup.groupMembers.length >= 2 ? [...setup.groupMembers] : ["Anna", "Ben"];
    let session: Snapshot | null = null;
    let busy = false;
    let settingsOpen = false;
    let lastCardId: string | undefined;
    let exhausted = false;
    let cardLocales: CardLocaleSummary[] = [];
    let profiles: GameProfileSummary[] = [];
    $: currentGameSettings = session?.settings ?? setupRoomSettings(setup);
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

    onMount(async () => {
        const [loadedLocales, loadedProfiles] = await Promise.all([
            loadCardLocales(),
            loadGameProfiles(),
        ]);
        cardLocales = loadedLocales.locales;
        profiles = loadedProfiles;
    });

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
        dismissNotification();
        exhausted = false;
        try {
            session = await action();
        } catch (cause) {
            if (cause instanceof ApiError && cause.code === "CARD_POOL_EXHAUSTED") {
                if (session) exhausted = true;
                else showNotification(messages.couch.noCardsForSettings, "error");
            } else if (cause instanceof ApiError && cause.code === "STALE_SESSION_REVISION")
                showNotification(messages.couch.stale, "error");
            else
                showNotification(
                    cause instanceof Error ? cause.message : messages.couch.genericError,
                    "error",
                );
        } finally {
            busy = false;
        }
    }
    function createSession(): void {
        const players = playerNames
            .map((name) => ({ name: name.trim() }))
            .filter((player) => player.name);
        if (players.length < 2) {
            showNotification(messages.couch.minimumPlayers, "error");
            return;
        }
        presentation.playEffect("confirm");
        void run(() =>
            couchApi.create({
                mode,
                players,
                configuration: {
                    enabledQuestionCategoryIds: setup.enabledQuestionCategoryIds,
                    enabledDareTypeIds: setup.enabledDareTypeIds,
                    blockedOperationalFlags: setup.blockedOperationalFlags,
                    maximumIntensity: setup.maximumIntensity,
                    randomQuestionRatio: setup.randomQuestionRatio,
                    maximumTypeStreak: setup.maximumTypeStreak,
                    letsTalkMetaInterval: setup.letsTalkMetaInterval,
                },
                profileId: setup.profileId,
                adultContentConfirmed: setup.adultContentConfirmed,
                groupId: setup.groupChoice === "SELECT" ? setup.groupId : null,
                cardLocale: setup.cardLocale,
                neverHaveIEverRevealMode: setup.neverHaveIEverRevealMode,
            }),
        );
    }
    function command(name: string, payload: object = {}): void {
        presentation.playEffect(effectForCommand(name));
        if (session) void run(() => couchApi.command(session!, name, payload));
    }
    function backToMain(): void {
        resetSetup("intent");
        navigate("/play/", { force: true });
    }
    $: elapsedMinutes = minutesSince(session?.startedAt ?? Date.now());
</script>

<main class:playing={session} class="couch-shell">
    <SettingsTrigger onOpen={() => (settingsOpen = true)} />
    {#if !session}
        <header>
            <span class="eyebrow">{messages.couch.singleDevice}</span>
            <h1>{messages.couch.players}</h1>
            <p>{messages.couch.passDevice}</p>
        </header>
    {/if}
    {#if !session}
        <button class="text-action back-link couch-back" on:click={backToMain}
            >← {messages.common.backToMain}</button
        >
        <section class="player-setup card-panel">
            <div class="setup-summary">
                <span>{gameModes.find((item) => item[0] === mode)?.[1]}</span><a
                    class="text-action"
                    href={setupHref("mode")}>{messages.common.change}</a
                >
            </div>
            <div class="players">
                {#each playerNames as name, index}
                    <PlayerNameRow
                        {index}
                        value={name}
                        removable={playerNames.length > 2}
                        onInput={(value) => setPlayer(index, value)}
                        onRemove={() => removePlayer(index)}
                    />
                {/each}
                <button class="secondary add-player" on:click={addPlayer}
                    >{messages.common.addPerson}</button
                >
            </div>
            <button
                class="primary primary-action"
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
            onNewGame={() => (session = null)}
            onExit={backToMain}
            exitLabel={messages.common.backToMain}
        />
    {:else}
        <section class="game-shell" data-atmosphere={cardAtmosphere}>
            <div class="status">
                <span>{messages.common.round} {session.roundNumber}</span><span
                    >{session.cardsShown} {messages.common.cards}</span
                >
            </div>
            {#if session.activePlayer}<p class="active-player">
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
                {#if session.neverHaveIEverVoting}<NeverHaveIEverVoting
                        voting={session.neverHaveIEverVoting}
                        controllablePlayerIds={session.neverHaveIEverVoting.progress.map(
                            ({ playerId }) => playerId,
                        )}
                        {busy}
                        onVote={(playerId, vote) => command("vote", { playerId, vote })}
                    />{/if}
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
    {/if}
    <SettingsModal
        bind:open={settingsOpen}
        onEnd={session && session.state !== "ENDED" ? () => command("end") : undefined}
        {currentGameSettings}
        gameProfiles={profiles}
        {cardLocales}
        defaultTab={session && session.state !== "ENDED" ? "session" : "audio"}
    />
</main>
