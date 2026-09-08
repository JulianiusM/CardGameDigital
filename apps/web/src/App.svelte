<script lang="ts">
    import { onMount, tick } from "svelte";
    import QRCode from "qrcode";
    import AdaptiveBackdrop from "./AdaptiveBackdrop.svelte";
    import Account from "./Account.svelte";
    import CardManagement from "./CardManagement.svelte";
    import BoundarySetup, { type BoundarySelection } from "./BoundarySetup.svelte";
    import Couch from "./Couch.svelte";
    import { COUCH_SESSION_STORAGE_KEY } from "./api";
    import GameSettingsEditor from "./GameSettingsEditor.svelte";
    import GameSettingsModal from "./GameSettingsModal.svelte";
    import Help from "./Help.svelte";
    import HostTransferControl from "./HostTransferControl.svelte";
    import Home from "./Home.svelte";
    import PresentationControls from "./PresentationControls.svelte";
    import RoomGameplay from "./RoomGameplay.svelte";
    import RoomLobby from "./RoomLobby.svelte";
    import SettingsModal from "./SettingsModal.svelte";
    import SettingsTrigger from "./SettingsTrigger.svelte";
    import NotificationToast from "./NotificationToast.svelte";
    import { dismissNotification, notification, showNotification } from "./notifications";
    import { messages } from "./i18n";
    import {
        clearJoin,
        loadCardLocales,
        loadGameProfiles,
        loadLastJoin,
        loadServerInfo,
        RoomSocket,
        type Join,
        type ReconnectPhase,
        type Role,
    } from "./multiplayer";
    import type {
        CardLocaleSummary,
        GameProfileSummary,
        RoomGameSettings,
    } from "../../../packages/protocol";
    import { presentation, type AtmospherePresentation } from "./presentation";
    import { atmosphereFor, effectForCommand, sceneFor } from "./presentationMapping";
    import {
        configureNavigationProtection,
        navigate,
        routeFromLocation,
        startRouter,
        type AppRoute,
    } from "./router";
    import { hasMeaningfulSetup, loadSetup, resetSetup } from "./setup";
    import { updateLocalLanguagePreferences } from "./languagePreferences";
    import { accountApi } from "./accountApi";
    import { authentication, setAuthenticatedAccount } from "./authentication";
    import { roomJoinUrls } from "./roomAccessUrls";
    import { GOLDEN_MISCHIEF_COLORS } from "../../../packages/design-tokens";

    let route: AppRoute = routeFromLocation();
    let joined: Join | null = null;
    let connection: RoomSocket | null = null;
    let qr = "";
    let roomUrls: string[] = [];
    let profiles: GameProfileSummary[] = [];
    let cardLocales: CardLocaleSummary[] = [];
    let settingsDraft: RoomGameSettings | null = null;
    let settingsDirty = false;
    let devicePlayerNames: string[] = [];
    let projectedDevicePlayerKey = "";
    let devicePlayersDirty = false;
    let devicePlayersSaving = false;
    let devicePlayerSaveTimer: ReturnType<typeof setTimeout> | undefined;
    let transferTarget = "";
    let updateCounter = 0;
    let lastCardId: string | undefined;
    let lastGameAtmosphere: AtmospherePresentation | null = null;
    let settingsOpen = false;
    let currentSettingsOpen = false;
    let recoveringRoom = false;
    let connectingParticipantId = "";
    let openSettingsAfterReset = false;
    let lastConnectionNotice = "";
    let lastSettingsNoticeId = 0;
    let lastRoomNoticeId = 0;

    function refreshed<T>(_counter: number, value: T): T {
        return value;
    }

    $: snapshot = refreshed(updateCounter, connection?.snapshot);
    $: session = snapshot?.session;
    $: participants = snapshot?.participants ?? [];
    $: representedPlayerCount = participants.reduce(
        (total, participant) =>
            total + (participant.role === "DISPLAY" ? 0 : 1 + participant.devicePlayers.length),
        0,
    );
    $: currentParticipant = participants.find(({ id }) => id === joined?.participantId);
    $: {
        const names = currentParticipant?.devicePlayers.map(({ name }) => name) ?? [];
        const nextKey = JSON.stringify(names);
        if (nextKey !== projectedDevicePlayerKey) {
            projectedDevicePlayerKey = nextKey;
            if (devicePlayersDirty && nextKey === JSON.stringify(normalizedDevicePlayerNames())) {
                devicePlayersDirty = false;
                devicePlayersSaving = false;
                // The acknowledgement omits empty draft rows. Keep a row added while
                // this save was in flight so the next name is not entered into an old row.
            } else if (!devicePlayersDirty) devicePlayerNames = names;
        }
    }
    $: if (openSettingsAfterReset && snapshot && !session && effectiveRole === "HOST") {
        openSettingsAfterReset = false;
        openSettings();
    }
    $: effectiveRole = refreshed(updateCounter, connection?.role);
    $: enrollmentPending = Boolean(
        session &&
        session.state !== "ENDED" &&
        effectiveRole !== "DISPLAY" &&
        !session.players.some(({ id }) => id === joined?.participantId),
    );
    let wasEnrollmentPending = false;
    $: if (wasEnrollmentPending && !enrollmentPending && session) {
        wasEnrollmentPending = false;
        void tick().then(() => {
            window.scrollTo(0, 0);
            const heading = document.querySelector<HTMLElement>(".game-shell h2");
            heading?.setAttribute("tabindex", "-1");
            heading?.focus({ preventScroll: true });
        });
    } else if (enrollmentPending) wasEnrollmentPending = true;
    $: roomPresence = refreshed(updateCounter, connection?.presence ?? []);
    $: connectionError = refreshed(updateCounter, connection?.error ?? "");
    $: connectionErrorCode = refreshed(updateCounter, connection?.errorCode ?? "");
    $: reconnectPhase = refreshed(updateCounter, connection?.reconnectPhase ?? "CONNECTING");
    $: reconnectAttempt = refreshed(updateCounter, connection?.reconnectAttempt ?? 0);
    $: reconnectSeconds = refreshed(updateCounter, connection?.reconnectSeconds ?? 0);
    $: reconnectMaximum = connection?.reconnectMaximum ?? 5;
    $: reconnectStatus = reconnectStatusText(
        reconnectPhase,
        reconnectAttempt,
        reconnectSeconds,
        reconnectMaximum,
    );
    $: settingsNotice = refreshed(updateCounter, connection?.settingsNotice ?? "");
    $: settingsNoticeId = refreshed(updateCounter, connection?.settingsNoticeId ?? 0);
    $: roomNotice = refreshed(updateCounter, connection?.roomNotice ?? "");
    $: roomNoticeId = refreshed(updateCounter, connection?.roomNoticeId ?? 0);
    $: cardReplacementSequence = refreshed(updateCounter, connection?.cardReplacementSequence ?? 0);
    $: cardReplacementReason = refreshed(updateCounter, connection?.cardReplacementReason ?? "");
    $: roomSettings = snapshot?.settings;
    $: roomCode = joined?.roomCode ?? "";
    $: cardAtmosphere = atmosphereFor(session?.currentCard);
    $: gameInProgress = Boolean(session && session.state !== "ENDED");
    $: if (cardAtmosphere) lastGameAtmosphere = cardAtmosphere;
    $: if (!gameInProgress && !cardAtmosphere) lastGameAtmosphere = null;
    $: settingsDefaultTab = defaultSettingsTab(effectiveRole, session?.state);
    $: if (connectionError && connectionError !== lastConnectionNotice) {
        lastConnectionNotice = connectionError;
        showNotification(connectionError, "error");
    } else if (!connectionError) lastConnectionNotice = "";
    $: if (settingsNotice && settingsNoticeId > lastSettingsNoticeId) {
        lastSettingsNoticeId = settingsNoticeId;
        showNotification(settingsNotice, "info");
    }
    $: if (roomNotice && roomNoticeId > lastRoomNoticeId) {
        lastRoomNoticeId = roomNoticeId;
        showNotification(roomNotice, "info");
    }
    $: {
        const cardId = session?.currentCard?.id;
        if (cardId && cardId !== lastCardId) presentation.playEffect("reveal");
        lastCardId = cardId;
        presentation.setScene(
            sceneFor(session?.state, session?.currentCard, Boolean(joined)),
            cardAtmosphere ?? (gameInProgress ? lastGameAtmosphere : null),
        );
    }

    onMount(() => {
        configureNavigationProtection(
            () => Boolean(joined) || (route === "home" && hasMeaningfulSetup()),
            () => confirm(messages.settings.leaveNavigationConfirm),
        );
        const stopRouter = startRouter((next) => {
            route = next;
            void enforceRoute();
        });
        void enforceRoute();
        return () => {
            if (devicePlayerSaveTimer) clearTimeout(devicePlayerSaveTimer);
            stopRouter();
            connection?.dispose();
        };
    });

    async function enforceRoute(): Promise<void> {
        if (route === "legacy-room") {
            const saved = loadLastJoin();
            if (!saved) {
                navigate("/play/", { replace: true, force: true });
                return;
            }
            navigate("/play/room", { replace: true, force: true });
            return;
        }
        if (route === "couch" && !sessionStorage.getItem(COUCH_SESSION_STORAGE_KEY)) {
            const setup = loadSetup();
            if (setup.intent !== "HOST" || setup.step !== "screen" || setup.deviceMode !== "couch")
                navigate("/play/?setup=group", { replace: true, force: true });
            return;
        }
        if (route !== "room") return;
        const saved = loadLastJoin();
        if (!saved) {
            navigate("/play/", { replace: true, force: true });
            return;
        }
        await connect(saved);
    }

    async function connect(value: Join): Promise<void> {
        if (
            joined?.participantId === value.participantId &&
            (connection || connectingParticipantId === value.participantId)
        )
            return;
        connection?.dispose();
        resetRoomOverlays();
        joined = value;
        recoveringRoom = true;
        connectingParticipantId = value.participantId;
        try {
            const [loadedProfiles, loadedLocales, serverInfo] = await Promise.all([
                loadGameProfiles(),
                loadCardLocales(),
                loadServerInfo(),
            ]);
            if (joined?.participantId !== value.participantId) return;
            connection = new RoomSocket(
                value,
                () => {
                    updateCounter++;
                    recoveringRoom = !connection?.authenticated;
                },
                (reason) => leaveCompleted(value, reason),
                serverInfo.endpoints.webSocketPath,
            );
            profiles = loadedProfiles;
            cardLocales = loadedLocales.locales;
            const access = roomJoinUrls(serverInfo, location.origin, value.roomCode);
            roomUrls = access.urls;
            qr = await QRCode.toDataURL(access.qrUrl, {
                margin: 1,
                width: 260,
                color: {
                    dark: GOLDEN_MISCHIEF_COLORS.espresso,
                    light: GOLDEN_MISCHIEF_COLORS.warmPaper,
                },
            });
        } catch (cause) {
            qr = "";
            roomUrls = [];
            showNotification(
                cause instanceof Error ? cause.message : messages.common.connectionFailed,
                "error",
            );
        } finally {
            if (connectingParticipantId === value.participantId) connectingParticipantId = "";
        }
    }

    function leaveCompleted(
        value: Join,
        reason: "LEFT" | "ROOM_CLOSED" | "RECONNECT_EXPIRED",
    ): void {
        clearJoin(value);
        resetRoomOverlays();
        joined = null;
        connection = null;
        resetSetup("intent");
        if (reason === "ROOM_CLOSED") {
            showNotification(messages.room.closedNotice, "info");
        } else if (reason === "RECONNECT_EXPIRED") {
            showNotification(messages.room.reconnectExpired, "info");
        }
        navigate("/play/", { force: true });
    }

    function resetRoomOverlays(): void {
        settingsOpen = false;
        currentSettingsOpen = false;
        openSettingsAfterReset = false;
        settingsDraft = null;
        settingsDirty = false;
        transferTarget = "";
        lastCardId = undefined;
        lastSettingsNoticeId = 0;
        lastRoomNoticeId = 0;
        qr = "";
        roomUrls = [];
    }

    function defaultSettingsTab(role: Role | undefined, sessionState?: string): string {
        if (sessionState === "ENDED") {
            if (role === "HOST") return "audio";
            return "services";
        }
        if (sessionState) {
            if (role === "HOST") return "session";
            if (role === "PLAYER") return "services";
            if (role === "DISPLAY") return "currentGame";
        }
        if (role === "HOST") return "game";
        if (role === "PLAYER") return "content";
        if (role === "DISPLAY") return "services";
        return "audio";
    }

    function reconnectStatusText(
        phase: ReconnectPhase,
        attempt: number,
        seconds: number,
        maximum: number,
    ): string {
        if (phase === "OFFLINE") return messages.common.reconnectOffline;
        if (phase === "STOPPED") return messages.common.reconnectStopped;
        if (phase === "EXHAUSTED") return messages.common.reconnectExhausted;
        if (phase === "WAITING")
            return messages.common.reconnectWaiting(
                seconds,
                Math.min(attempt + 1, maximum),
                maximum,
            );
        return messages.common.reconnectAttempting(Math.max(1, attempt), maximum);
    }

    function returnToMenuFromReconnect(): void {
        const value = joined;
        connection?.dispose();
        if (value) clearJoin(value);
        resetRoomOverlays();
        joined = null;
        connection = null;
        resetSetup("intent");
        navigate("/play/", { force: true });
    }

    function command(type: string, payload: object = {}): void {
        presentation.playEffect(effectForCommand(type));
        connection?.command(type, payload);
    }
    function startSession(): void {
        flushDevicePlayers();
        command("command.startSession");
    }
    function newRoomGame(): void {
        if (effectiveRole !== "HOST" || session?.state !== "ENDED") return;
        openSettingsAfterReset = true;
        command("command.resetSession");
    }
    function saveBoundaries(boundaries: BoundarySelection): void {
        command("command.setBoundaries", boundaries);
    }
    function setDevicePlayer(index: number, value: string): void {
        devicePlayerNames[index] = value;
        devicePlayerNames = [...devicePlayerNames];
        scheduleDevicePlayerSave();
    }
    function normalizedDevicePlayerNames(): string[] {
        return devicePlayerNames.map((entry) => entry.trim()).filter(Boolean);
    }
    function scheduleDevicePlayerSave(): void {
        devicePlayersDirty = true;
        devicePlayersSaving = false;
        if (devicePlayerSaveTimer) clearTimeout(devicePlayerSaveTimer);
        devicePlayerSaveTimer = setTimeout(flushDevicePlayers, 500);
    }
    function flushDevicePlayers(): void {
        if (!devicePlayersDirty) return;
        if (devicePlayerSaveTimer) clearTimeout(devicePlayerSaveTimer);
        devicePlayerSaveTimer = undefined;
        devicePlayersSaving = true;
        command("command.setDevicePlayers", {
            names: normalizedDevicePlayerNames(),
        });
    }
    function addDevicePlayer(): void {
        devicePlayerNames = [...devicePlayerNames, ""];
    }
    function removeDevicePlayer(index: number): void {
        devicePlayerNames = devicePlayerNames.filter((_, current) => current !== index);
        scheduleDevicePlayerSave();
    }
    function leaveRoom(): void {
        command("command.leaveRoom");
    }
    function closeRoom(): void {
        if (!confirm(messages.room.closeConfirm)) return;
        command("command.closeRoom");
    }
    function openSettings(): void {
        dismissNotification();
        if (roomSettings) {
            const {
                revision: _revision,
                updatedByParticipantId: _updatedBy,
                ...settings
            } = roomSettings;
            settingsDraft = structuredClone(settings);
            settingsDirty = false;
        }
        settingsOpen = true;
    }
    function changeSettings(settings: RoomGameSettings): void {
        settingsDraft = settings;
        settingsDirty = true;
    }
    function rememberCardLocale(cardLocale: string): void {
        if (roomSettings?.groupId) return;
        updateLocalLanguagePreferences({ cardLocale });
        if (!$authentication.authenticated) return;
        void accountApi
            .updateLanguagePreferences({ cardLocale })
            .then((account) => setAuthenticatedAccount($authentication, account))
            .catch((cause) =>
                showNotification(
                    cause instanceof Error ? cause.message : messages.common.requestFailed,
                    "error",
                ),
            );
    }
    function saveRoomSettings(): void {
        if (!settingsDraft || !roomSettings) return;
        command("command.updateRoomSettings", {
            expectedRevision: roomSettings.revision,
            settings: settingsDraft,
        });
        settingsDirty = false;
        settingsOpen = false;
    }
</script>

<AdaptiveBackdrop />
{#if route === "home" || route === "account" || route === "cards" || route === "help"}<PresentationControls
    />{/if}
{#if $notification}<div class="notification-lane">
        <NotificationToast
            message={$notification.message}
            notificationId={$notification.id}
            duration={$notification.duration}
            kind={$notification.kind}
            onDismiss={() => dismissNotification($notification?.id)}
        />
    </div>{/if}

{#key route}
    <div class="app-location">
        {#if route === "home"}
            <Home />
        {:else if route === "account"}
            <Account />
        {:else if route === "cards"}
            <CardManagement />
        {:else if route === "help"}
            <Help />
        {:else if route === "couch"}
            <Couch />
        {:else if route === "room"}
            <main
                class:playing={Boolean(session && session.state !== "ENDED" && !enrollmentPending)}
                class:display-role={effectiveRole === "DISPLAY"}
            >
                {#if snapshot}<div class="room-size" aria-live="polite">
                        {messages.room.playerCount(
                            representedPlayerCount,
                            snapshot.capacity.maximumPlayers,
                        )}
                    </div>{/if}
                {#if recoveringRoom || !snapshot || !effectiveRole}
                    <section class="card-panel reconnect-panel" aria-live="polite">
                        <div class="reconnect-copy">
                            <span class="eyebrow">{messages.common.connectionFailed}</span>
                            <h1>{messages.common.connectionLostTitle}</h1>
                            <p>{messages.common.connectionLostBody}</p>
                            <p class="reconnect-status">{reconnectStatus}</p>
                        </div>
                        <div class="reconnect-actions">
                            {#if reconnectPhase !== "CONNECTING"}<button
                                    class="primary"
                                    on:click={() => connection?.retryNow()}
                                    >{messages.common.retryNow}</button
                                >{/if}
                            {#if reconnectPhase !== "STOPPED" && reconnectPhase !== "EXHAUSTED"}
                                <button
                                    class="secondary"
                                    on:click={() => connection?.stopReconnecting()}
                                    >{messages.common.stopReconnecting}</button
                                >
                            {:else}
                                <button class="secondary" on:click={returnToMenuFromReconnect}
                                    >{messages.common.backToMain}</button
                                >
                            {/if}
                        </div>
                    </section>
                {:else}
                    {#if !session || session.state === "ENDED"}<header>
                            <span class="eyebrow">{messages.room.roles[effectiveRole]}</span>
                            <h1>{roomCode}</h1>
                        </header>{/if}
                    <SettingsTrigger onOpen={openSettings} />
                    {#if !session}
                        <RoomLobby
                            {participants}
                            presence={roomPresence}
                            {effectiveRole}
                            bootstrapMode={snapshot.bootstrapMode}
                            hostStatus={snapshot.hostStatus}
                            boundaryConfigured={snapshot.boundaryConfigured}
                            {qr}
                            {roomUrls}
                            code={roomCode}
                            roomAccess={{
                                roomCode,
                                participantCredential: joined!.participantCredential,
                            }}
                            settings={snapshot.settings}
                            {profiles}
                            {cardLocales}
                            {devicePlayerNames}
                            onSetDevicePlayer={setDevicePlayer}
                            onAddDevicePlayer={addDevicePlayer}
                            onRemoveDevicePlayer={removeDevicePlayer}
                            {devicePlayersDirty}
                            {devicePlayersSaving}
                            onStart={startSession}
                            onSaveBoundaries={saveBoundaries}
                            onOpenSettings={openSettings}
                            onViewSettings={() => (currentSettingsOpen = true)}
                            onLeave={leaveRoom}
                        />
                    {:else if enrollmentPending}
                        <section class="card-panel enrollment-panel">
                            <h2>{messages.boundaries.enrollmentTitle}</h2>
                            <p>{messages.boundaries.enrollmentHint}</p>
                            <BoundarySetup
                                cardLocale={snapshot.settings.cardLocale}
                                onSave={saveBoundaries}
                            />
                            <button class="secondary" on:click={leaveRoom}
                                >{messages.room.leaveRoom}</button
                            >
                        </section>
                    {:else}
                        <RoomGameplay
                            {session}
                            cardLocale={snapshot.settings.cardLocale}
                            role={effectiveRole}
                            {participants}
                            presence={roomPresence}
                            {roomCode}
                            exhausted={connectionErrorCode === "CARD_POOL_EXHAUSTED"}
                            onCommand={command}
                            onOpenSettings={openSettings}
                            onNewGame={effectiveRole === "HOST" ? newRoomGame : undefined}
                            onSummaryExit={effectiveRole === "HOST" ? closeRoom : leaveRoom}
                            summaryExitLabel={effectiveRole === "HOST"
                                ? messages.settings.closeRoom
                                : messages.room.leaveRoom}
                            summaryExitDanger={effectiveRole === "HOST"}
                            {cardReplacementSequence}
                            {cardReplacementReason}
                        />
                    {/if}
                    <SettingsModal
                        bind:open={settingsOpen}
                        showGame={!session && effectiveRole === "HOST"}
                        showAdvanced={effectiveRole === "HOST"}
                        showContent={!session && effectiveRole !== "DISPLAY"}
                        onBoundaries={!session && effectiveRole !== "DISPLAY"
                            ? saveBoundaries
                            : undefined}
                        onEnd={session && session.state !== "ENDED" && effectiveRole === "HOST"
                            ? () => command("command.endSession")
                            : undefined}
                        onCloseRoom={effectiveRole === "HOST" ? closeRoom : undefined}
                        onLeave={leaveRoom}
                        currentGameSettings={session ? snapshot.settings : undefined}
                        cardLocale={snapshot.settings.cardLocale}
                        gameProfiles={profiles}
                        {cardLocales}
                        {roomCode}
                        {qr}
                        {roomUrls}
                        autoPageRoomUrls={effectiveRole === "DISPLAY"}
                        currentGamePlayerCount={Math.max(2, representedPlayerCount)}
                        roomAccess={{
                            roomCode,
                            participantCredential: joined!.participantCredential,
                        }}
                        defaultTab={settingsDefaultTab}
                    >
                        <div slot="game">
                            {#if settingsDraft}<GameSettingsEditor
                                    settings={settingsDraft}
                                    {profiles}
                                    {cardLocales}
                                    playerCount={Math.max(2, representedPlayerCount)}
                                    onChange={changeSettings}
                                    onCardLocaleSelect={rememberCardLocale}
                                />
                                <button
                                    class="primary wide"
                                    disabled={!settingsDirty}
                                    on:click={saveRoomSettings}>{messages.common.save}</button
                                >{/if}
                        </div>
                        <div slot="advanced">
                            <HostTransferControl
                                {participants}
                                selected={transferTarget}
                                onSelect={(participantId) => (transferTarget = participantId)}
                                onTransfer={() =>
                                    command("command.transferHost", {
                                        participantId: transferTarget,
                                    })}
                            />
                        </div>
                    </SettingsModal>
                    <GameSettingsModal
                        bind:open={currentSettingsOpen}
                        settings={snapshot.settings}
                        {profiles}
                        {cardLocales}
                        playerCount={Math.max(2, representedPlayerCount)}
                        roomAccess={{
                            roomCode,
                            participantCredential: joined!.participantCredential,
                        }}
                    />
                {/if}
            </main>
        {/if}
    </div>
{/key}
