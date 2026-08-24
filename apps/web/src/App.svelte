<script lang="ts">
    import { onMount } from "svelte";
    import QRCode from "qrcode";
    import AdaptiveBackdrop from "./AdaptiveBackdrop.svelte";
    import Account from "./Account.svelte";
    import type { BoundarySelection } from "./BoundarySetup.svelte";
    import Couch from "./Couch.svelte";
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
        RoomSocket,
        type GameProfileSummary,
        type CardLocaleSummary,
        type Join,
        type ReconnectPhase,
        type Role,
        type RoomGameSettings,
    } from "./multiplayer";
    import { presentation } from "./presentation";
    import { atmosphereFor, effectForCommand, sceneFor } from "./presentationMapping";
    import {
        configureNavigationProtection,
        navigate,
        routeFromLocation,
        startRouter,
        type AppRoute,
    } from "./router";
    import { hasMeaningfulSetup, loadSetup, resetSetup } from "./setup";

    let route: AppRoute = routeFromLocation();
    let joined: Join | null = null;
    let connection: RoomSocket | null = null;
    let qr = "";
    let profiles: GameProfileSummary[] = [];
    let cardLocales: CardLocaleSummary[] = [];
    let settingsDraft: RoomGameSettings | null = null;
    let settingsDirty = false;
    let devicePlayerNames: string[] = [];
    let projectedDevicePlayerKey = "";
    let transferTarget = "";
    let updateCounter = 0;
    let lastCardId: string | undefined;
    let settingsOpen = false;
    let currentSettingsOpen = false;
    let recoveringRoom = false;
    let openSettingsAfterReset = false;
    let lastConnectionNotice = "";
    let lastSettingsNoticeId = 0;
    let lastRoomNoticeId = 0;

    $: snapshot = (updateCounter, connection?.snapshot);
    $: session = snapshot?.session;
    $: participants = snapshot?.participants ?? [];
    $: currentParticipant = participants.find(({ id }) => id === joined?.participantId);
    $: {
        const names = currentParticipant?.devicePlayers.map(({ name }) => name) ?? [];
        const nextKey = JSON.stringify(names);
        if (nextKey !== projectedDevicePlayerKey) {
            projectedDevicePlayerKey = nextKey;
            devicePlayerNames = names;
        }
    }
    $: if (openSettingsAfterReset && snapshot && !session && effectiveRole === "HOST") {
        openSettingsAfterReset = false;
        openSettings();
    }
    $: effectiveRole = (updateCounter, connection?.role);
    $: roomPresence = (updateCounter, connection?.presence ?? []);
    $: connectionError = (updateCounter, connection?.error ?? "");
    $: connectionErrorCode = (updateCounter, connection?.errorCode ?? "");
    $: reconnectPhase = (updateCounter, connection?.reconnectPhase ?? "CONNECTING");
    $: reconnectAttempt = (updateCounter, connection?.reconnectAttempt ?? 0);
    $: reconnectSeconds = (updateCounter, connection?.reconnectSeconds ?? 0);
    $: reconnectMaximum = connection?.reconnectMaximum ?? 5;
    $: reconnectStatus = reconnectStatusText(
        reconnectPhase,
        reconnectAttempt,
        reconnectSeconds,
        reconnectMaximum,
    );
    $: settingsNotice = (updateCounter, connection?.settingsNotice ?? "");
    $: settingsNoticeId = (updateCounter, connection?.settingsNoticeId ?? 0);
    $: roomNotice = (updateCounter, connection?.roomNotice ?? "");
    $: roomNoticeId = (updateCounter, connection?.roomNoticeId ?? 0);
    $: cardReplacementSequence = (updateCounter, connection?.cardReplacementSequence ?? 0);
    $: cardReplacementReason = (updateCounter, connection?.cardReplacementReason ?? "");
    $: roomSettings = snapshot?.settings;
    $: roomCode = joined?.roomCode ?? "";
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
            atmosphereFor(session?.currentCard),
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
        if (route === "couch") {
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
        if (joined?.participantId === value.participantId && connection) return;
        connection?.dispose();
        resetRoomOverlays();
        joined = value;
        recoveringRoom = true;
        connection = new RoomSocket(
            value,
            () => {
                updateCounter++;
                recoveringRoom = !connection?.authenticated;
            },
            (reason) => leaveCompleted(value, reason),
        );
        qr = await QRCode.toDataURL(`${location.origin}/play/?room=${value.roomCode}`, {
            margin: 1,
            width: 260,
            color: { dark: "#3b2416", light: "#fff8e8" },
        });
        const [loadedProfiles, loadedLocales] = await Promise.all([
            loadGameProfiles(),
            loadCardLocales(),
        ]);
        profiles = loadedProfiles;
        cardLocales = loadedLocales.locales;
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
    }
    function saveDevicePlayers(): void {
        command("command.setDevicePlayers", {
            names: devicePlayerNames.map((entry) => entry.trim()).filter(Boolean),
        });
    }
    function leaveRoom(): void {
        command("command.leaveRoom");
    }
    function closeRoom(): void {
        if (!confirm(messages.room.closeConfirm)) return;
        command("command.closeRoom");
    }
    function openSettings(): void {
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
{#if route === "home" || route === "account" || route === "help"}<PresentationControls />{/if}
{#if $notification}<NotificationToast
        message={$notification.message}
        notificationId={$notification.id}
        duration={$notification.duration}
        kind={$notification.kind}
        onDismiss={() => dismissNotification($notification?.id)}
    />{/if}

{#key route}
    <div class="app-location">
        {#if route === "home"}
            <Home />
        {:else if route === "account"}
            <Account />
        {:else if route === "help"}
            <Help />
        {:else if route === "couch"}
            <Couch />
        {:else if route === "room"}
            <main
                class:playing={Boolean(session && session.state !== "ENDED")}
                class:display-role={effectiveRole === "DISPLAY"}
            >
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
                            boundaryConfigured={snapshot.boundaryConfigured}
                            {qr}
                            code={roomCode}
                            settings={snapshot.settings}
                            {profiles}
                            {cardLocales}
                            {devicePlayerNames}
                            onSetDevicePlayer={setDevicePlayer}
                            onAddDevicePlayer={() =>
                                (devicePlayerNames = [...devicePlayerNames, ""])}
                            onRemoveDevicePlayer={(index) =>
                                (devicePlayerNames = devicePlayerNames.filter(
                                    (_, current) => current !== index,
                                ))}
                            onSaveDevicePlayers={saveDevicePlayers}
                            onStart={startSession}
                            onSaveBoundaries={saveBoundaries}
                            onOpenSettings={openSettings}
                            onViewSettings={() => (currentSettingsOpen = true)}
                            onLeave={leaveRoom}
                        />
                    {:else}
                        <RoomGameplay
                            {session}
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
                        gameProfiles={profiles}
                        {cardLocales}
                        {roomCode}
                        {qr}
                        defaultTab={settingsDefaultTab}
                    >
                        <div slot="game">
                            {#if settingsDraft}<GameSettingsEditor
                                    settings={settingsDraft}
                                    {profiles}
                                    {cardLocales}
                                    onChange={changeSettings}
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
                    />
                {/if}
            </main>
        {/if}
    </div>
{/key}
