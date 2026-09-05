<script lang="ts">
    import { scrollText } from "./scrollText";
    import { onMount } from "svelte";
    import { ApiError, couchApi, type Snapshot } from "./api";
    import SettingsModal from "./SettingsModal.svelte";
    import SettingsTrigger from "./SettingsTrigger.svelte";
    import GameCard from "./GameCard.svelte";
    import SessionSummary from "./SessionSummary.svelte";
    import NeverHaveIEverVoting from "./NeverHaveIEverVoting.svelte";
    import PlayerNameRow from "./PlayerNameRow.svelte";
    import UiIcon from "./UiIcon.svelte";
    import { presentation, type AtmospherePresentation } from "./presentation";
    import { atmosphereFor, effectForCommand, sceneFor } from "./presentationMapping";
    import { messages, gameModes } from "./i18n";
    import { elapsedMinutes as minutesSince } from "./elapsedTime";
    import { navigate } from "./router";
    import { dismissNotification, showNotification } from "./notifications";
    import { loadSetup, resetSetup, setupHref, setupRoomSettings } from "./setup";
    import { loadCardLocales, loadGameProfiles, loadHostConfiguration } from "./multiplayer";
    import type { CardLocaleSummary, GameProfileSummary } from "../../../packages/protocol";
    import { authentication, refreshAuthentication } from "./authentication";
    import EligibleCardPreview from "./EligibleCardPreview.svelte";

    const setup = loadSetup();
    const sessionStorageKey = "party-game:couch-session";
    let mode = (gameModes.find((item) => item[0] === setup.mode) ?? gameModes[0])[0];
    let playerNames =
        setup.groupMembers.length >= 2
            ? [...setup.groupMembers]
            : [setup.hostName.trim() || messages.room.namePlaceholder, "Ben"];
    let session: Snapshot | null = null;
    let busy = false;
    let settingsOpen = false;
    let lastCardId: string | undefined;
    let lastGameAtmosphere: AtmospherePresentation | null = null;
    let exhausted = false;
    let cardLocales: CardLocaleSummary[] = [];
    let profiles: GameProfileSummary[] = [];
    let activeDataSpace: { id: string; name: string } | null = null;
    $: currentGameSettings = session?.settings ?? setupRoomSettings(setup);
    $: pendingGameSettings = { ...setupRoomSettings(setup), mode };
    $: pendingPlayerCount = Math.max(2, playerNames.filter((name) => name.trim()).length);
    $: cardAtmosphere = atmosphereFor(session?.currentCard);
    $: gameInProgress = Boolean(session && session.state !== "ENDED");
    $: if (cardAtmosphere) lastGameAtmosphere = cardAtmosphere;
    $: if (!gameInProgress && !cardAtmosphere) lastGameAtmosphere = null;
    $: {
        const cardId = session?.currentCard?.id;
        if (cardId && cardId !== lastCardId) presentation.playEffect("reveal");
        lastCardId = cardId;
        presentation.setScene(
            sceneFor(session?.state, session?.currentCard, Boolean(session)),
            cardAtmosphere ?? (gameInProgress ? lastGameAtmosphere : null),
        );
    }

    onMount(async () => {
        try {
            const storedSessionId = sessionStorage.getItem(sessionStorageKey);
            const [loadedLocales, loadedProfiles, restoredSession, authenticationStatus] =
                await Promise.all([
                    loadCardLocales(),
                    loadGameProfiles(),
                    storedSessionId ? couchApi.get(storedSessionId).catch(() => null) : null,
                    refreshAuthentication(),
                ]);
            cardLocales = loadedLocales.locales;
            profiles = loadedProfiles;
            if (authenticationStatus.deploymentMode === "local") {
                activeDataSpace = (await loadHostConfiguration()).dataSpace;
            } else if (authenticationStatus.account?.activeDataSpaceId) {
                activeDataSpace =
                    authenticationStatus.account.dataSpaces.find(
                        ({ id }) => id === authenticationStatus.account?.activeDataSpaceId,
                    ) ?? null;
            }
            if (restoredSession) session = restoredSession;
            else if (storedSessionId) sessionStorage.removeItem(sessionStorageKey);
            prefillAccountPlayer(authenticationStatus.account?.user.name ?? "");
        } catch (cause) {
            showNotification(
                cause instanceof Error ? cause.message : messages.common.connectionFailed,
                "error",
            );
        }
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
            const snapshot = await action();
            session = snapshot;
            sessionStorage.setItem(sessionStorageKey, snapshot.id);
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
                persistence:
                    $authentication.deploymentMode === "local" || $authentication.authenticated
                        ? "DATASPACE"
                        : "EPHEMERAL",
                mode,
                players,
                configuration: {
                    enabledQuestionCategoryIds: setup.enabledQuestionCategoryIds,
                    enabledDareTypeIds: setup.enabledDareTypeIds,
                    blockedOperationalFlags: setup.blockedOperationalFlags,
                    maximumSocialSensitivity: setup.maximumSocialSensitivity,
                    startingIntensity: setup.startingIntensity,
                    maximumIntensity: setup.maximumIntensity,
                    intensityProgressionUnit: setup.intensityProgressionUnit,
                    intensityProgressionInterval: setup.intensityProgressionInterval,
                    intensityProgressionIncrement: setup.intensityProgressionIncrement,
                    randomQuestionRatio: setup.randomQuestionRatio,
                    maximumTypeStreak: setup.maximumTypeStreak,
                    letsTalkMetaInterval: setup.letsTalkMetaInterval,
                },
                profileId: setup.profileId,
                adultContentConfirmed: setup.adultContentConfirmed,
                groupId: setup.groupChoice === "SELECT" ? setup.groupId : null,
                cardLocale: setup.cardLocale,
                cardFallbackEnabled: setup.cardFallbackEnabled,
                cardFallbackLocales: setup.cardFallbackLocales,
                neverHaveIEverRevealMode: setup.neverHaveIEverRevealMode,
                cardPolicy: structuredClone(
                    setup.cardPolicy ?? {
                        scopeDefault: {},
                        conditionalRules: [],
                        exactCards: [],
                    },
                ),
            }),
        );
    }
    function command(name: string, payload: object = {}): void {
        presentation.playEffect(effectForCommand(name));
        if (session) void run(() => couchApi.command(session!, name, payload));
    }
    function backToMain(): void {
        sessionStorage.removeItem(sessionStorageKey);
        resetSetup("intent");
        navigate("/play/", { force: true });
    }
    $: elapsedMinutes = minutesSince(session?.startedAt ?? Date.now());

    function clearSession(): void {
        sessionStorage.removeItem(sessionStorageKey);
        session = null;
    }
    function prefillAccountPlayer(accountName: string, force = false): void {
        const preferredName = accountName.trim();
        if (!preferredName || (setup.groupChoice === "SELECT" && setup.groupMembers.length >= 2))
            return;
        const currentName = playerNames[0]?.trim() ?? "";
        const setupName = setup.hostName.trim();
        const replaceable =
            force ||
            !currentName ||
            currentName === messages.room.namePlaceholder ||
            currentName === setupName;
        if (replaceable) playerNames = [preferredName, ...playerNames.slice(1)];
    }
    function startNewGameSetup(): void {
        clearSession();
        prefillAccountPlayer($authentication.account?.user.name ?? "", true);
    }
</script>

<main class:playing={session} class="couch-shell">
    {#if !session && activeDataSpace}
        <div class="home-context-status">
            {#if $authentication.authenticationAvailable && $authentication.authenticated}
                <a class="active-dataspace-indicator" href="/play/account?returnTo=%2Fplay%2Fcouch">
                    <span aria-hidden="true"><UiIcon name="group" /></span>
                    <small>{messages.menu.activeDataSpace}</small>
                    <strong>{activeDataSpace.name}</strong>
                </a>
            {:else}
                <div class="active-dataspace-indicator" role="status">
                    <span aria-hidden="true"><UiIcon name="group" /></span>
                    <small>{messages.menu.activeDataSpace}</small>
                    <strong>{activeDataSpace.name}</strong>
                </div>
            {/if}
        </div>
    {/if}
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
                <span>
                    <strong>{gameModes.find((item) => item[0] === mode)?.[1]}</strong>
                    <small>
                        {messages.room.maximumSocialSensitivity}: {messages.cardManagement
                            .sensitivityNames[setup.maximumSocialSensitivity]}
                    </small>
                </span><a class="text-action" href={setupHref("mode")}>{messages.common.change}</a>
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
            <EligibleCardPreview
                settings={pendingGameSettings}
                playerCount={pendingPlayerCount}
                compact
            />
            <button
                class="primary primary-action"
                disabled={busy || playerNames.filter((name) => name.trim()).length < 2}
                on:click={createSession}>{messages.common.startGame} <span>→</span></button
            >
        </section>
    {:else if session.state === "ENDED"}
        <div class="summary-phase game-phase">
            <SessionSummary
                cardsShown={session.cardsShown}
                roundNumber={session.roundNumber}
                {elapsedMinutes}
                onAnotherRound={() => {
                    clearSession();
                    createSession();
                }}
                onNewGame={startNewGameSetup}
                onExit={backToMain}
                exitLabel={messages.common.backToMain}
            />
        </div>
    {:else}
        <section class="game-shell">
            <div class="status">
                <span data-adaptive-contrast>{messages.common.round} {session.roundNumber}</span
                ><span data-adaptive-contrast>{session.cardsShown} {messages.common.cards}</span
                ><span class="remaining-cards" data-adaptive-contrast
                    >{messages.common.remainingCards(session.remainingCardCount)}</span
                >
            </div>
            {#if session.activePlayer}<p class="active-player" data-adaptive-contrast>
                    <span>{messages.common.nowPlaying}</span><strong use:scrollText
                        >{session.activePlayer.name}</strong
                    >
                </p>{/if}
            {#if exhausted}
                <div class="card-panel exhausted-state game-phase" role="status">
                    <h2>{messages.couch.exhausted}</h2>
                    <button class="danger" on:click={() => command("end")}
                        >{messages.common.end}</button
                    >
                </div>
            {:else if session.state === "CHOOSING_CARD_TYPE"}
                <div class="choice card-panel game-phase">
                    <span class="choice-symbol"><UiIcon name="dare" /></span>
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
                <div class="card-panel center turn-ready game-phase">
                    <span class="orbit-symbol"><UiIcon name="spark" /></span>
                    <h2>{messages.common.ready}</h2>
                    <button class="primary" disabled={busy} on:click={() => command("start")}
                        >{messages.common.reveal}</button
                    >
                </div>
            {:else if session.currentCard}
                <GameCard
                    card={session.currentCard}
                    cardLocale={session.settings.cardLocale}
                    showIntensity
                />
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
        currentGamePlayerCount={pendingPlayerCount}
        defaultTab={session && session.state !== "ENDED" ? "session" : "audio"}
    />
</main>
