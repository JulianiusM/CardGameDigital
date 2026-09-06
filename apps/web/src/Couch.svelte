<script lang="ts">
    import { scrollText } from "./scrollText";
    import { onMount, tick } from "svelte";
    import { couchApi, COUCH_SESSION_STORAGE_KEY as sessionStorageKey, type Snapshot } from "./api";
    import { ApiError } from "./http";
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

    let setup = loadSetup();
    let recoveryId = sessionStorage.getItem(sessionStorageKey);
    let recovering = Boolean(recoveryId);
    let recoveryFailed = false;
    let recoveryNeedsAccount = false;
    let recoveryAttempt = 0;
    let recoveryPanel: HTMLElement | undefined;
    let recoveryAbort: AbortController | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
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
    $: recoveryStatus = recoveryMessage(recoveryNeedsAccount, recoveryFailed);
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

    onMount(() => {
        void initialize();
        if (recoveryId) void recoverSession();
        const online = () => {
            if (recoveryId) void recoverSession(true);
        };
        window.addEventListener("online", online);
        return () => {
            disposed = true;
            recoveryAbort?.abort();
            clearTimeout(retryTimer);
            window.removeEventListener("online", online);
        };
    });

    async function initialize(): Promise<void> {
        try {
            const [loadedLocales, loadedProfiles, authenticationStatus] = await Promise.all([
                loadCardLocales(),
                loadGameProfiles(),
                refreshAuthentication(),
            ]);
            if (disposed) return;
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
            prefillAccountPlayer(authenticationStatus.account?.user.name ?? "");
        } catch (cause) {
            if (disposed) return;
            showNotification(
                cause instanceof Error ? cause.message : messages.common.connectionFailed,
                "error",
            );
        }
    }

    function recoveryMessage(needsAccount: boolean, failed: boolean): string {
        if (needsAccount) return messages.couch.recoveryAccount;
        if (failed) return messages.couch.recoveryFailed;
        return messages.common.reconnecting;
    }

    async function recoverSession(resetAttempts = false): Promise<void> {
        if (!recoveryId || recoveryAbort || disposed) return;
        if (resetAttempts) recoveryAttempt = 0;
        clearTimeout(retryTimer);
        const id = recoveryId;
        const controller = new AbortController();
        recoveryAbort = controller;
        const timeout = setTimeout(() => controller.abort(), 10_000);
        recovering = true;
        recoveryFailed = false;
        recoveryAttempt++;
        try {
            const restored = await couchApi.get(id, controller.signal);
            if (disposed || recoveryId !== id) return;
            // An unexpected successful body is still an uncertain read, never a new game.
            if (restored.id !== id) throw new Error(messages.common.requestFailed);
            session = restored;
            recoveryId = null;
            recoveryNeedsAccount = false;
        } catch (cause) {
            if (disposed || recoveryId !== id) return;
            if (
                cause instanceof ApiError &&
                cause.status === 404 &&
                cause.code === "SESSION_NOT_FOUND"
            ) {
                clearSession();
                recoveryId = null;
                showNotification(messages.couch.gameUnavailable, "error");
            } else {
                recoveryFailed = true;
                recoveryNeedsAccount =
                    cause instanceof ApiError && (cause.status === 401 || cause.status === 403);
                await tick();
                if (disposed || recoveryId !== id) return;
                recoveryPanel?.focus();
                // Only reads are retried. Never repeat a possibly committed command.
                if (!recoveryNeedsAccount && recoveryAttempt < 3)
                    retryTimer = setTimeout(() => void recoverSession(), 2000 * recoveryAttempt);
            }
        } finally {
            clearTimeout(timeout);
            recoveryAbort = undefined;
            recovering = false;
        }
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
        if (busy || recoveryId) return;
        busy = true;
        dismissNotification();
        exhausted = false;
        try {
            const snapshot = await action();
            if (disposed) return;
            session = snapshot;
            sessionStorage.setItem(sessionStorageKey, snapshot.id);
        } catch (cause) {
            if (disposed) return;
            if (cause instanceof ApiError && cause.code === "CARD_POOL_EXHAUSTED") {
                if (session) exhausted = true;
                else showNotification(messages.couch.noCardsForSettings, "error");
            } else if (
                !session ||
                (cause instanceof ApiError && cause.code !== "STALE_SESSION_REVISION")
            )
                showNotification(
                    cause instanceof Error ? cause.message : messages.couch.genericError,
                    "error",
                );
            if (session) {
                recoveryId = session.id;
                await recoverSession(true);
            }
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

<main class:playing={session && !recoveryId} class="couch-shell">
    {#if !session && !recoveryId && activeDataSpace}
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
    {#if !session && !recoveryId}
        <header>
            <span class="eyebrow">{messages.couch.singleDevice}</span>
            <h1>{messages.couch.players}</h1>
            <p>{messages.couch.passDevice}</p>
        </header>
    {/if}
    {#if recoveryId}
        <section
            class="card-panel reconnect-panel couch-recovery"
            tabindex="-1"
            bind:this={recoveryPanel}
            aria-labelledby="couch-recovery-title"
        >
            <span class="orbit-symbol" aria-hidden="true"><UiIcon name="session" /></span>
            <div class="reconnect-copy" aria-live="polite">
                <h1 id="couch-recovery-title">{messages.couch.recoveryTitle}</h1>
                <p>{messages.couch.recoveryHint}</p>
                <p class="reconnect-status">{recoveryStatus}</p>
            </div>
            <div class="reconnect-actions">
                <button
                    class="primary"
                    disabled={recovering}
                    on:click={() => void recoverSession(true)}
                    >{messages.couch.recoveryRetry}</button
                >
                {#if recoveryNeedsAccount}<a
                        class="secondary"
                        href="/play/account"
                        target="_blank"
                        rel="noopener noreferrer">{messages.menu.account}</a
                    >{/if}
                <a class="secondary" href="/play/">{messages.common.backToMain}</a>
            </div>
        </section>
    {:else if !session}
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
                onConfirmAdult={(adultContentConfirmed) =>
                    (setup = { ...setup, adultContentConfirmed })}
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
            {#if !session.currentCard && (session.remainingCardCount === 0 || (exhausted && session.state !== "CHOOSING_CARD_TYPE"))}
                <div class="card-panel exhausted-state game-phase" role="status">
                    <h2>{messages.couch.exhausted}</h2>
                    <button class="danger" on:click={() => command("end")}
                        >{messages.common.end}</button
                    >
                </div>
            {:else if session.state === "CHOOSING_CARD_TYPE"}
                <div class="choice card-panel game-phase">
                    {#if exhausted}<p role="status">{messages.couch.chooseAnotherType}</p>{/if}
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
        onEnd={session && !recoveryId && session.state !== "ENDED"
            ? () => command("end")
            : undefined}
        {currentGameSettings}
        gameProfiles={profiles}
        {cardLocales}
        currentGamePlayerCount={session?.players.length ?? pendingPlayerCount}
        defaultTab={session && session.state !== "ENDED" ? "session" : "audio"}
    />
</main>
