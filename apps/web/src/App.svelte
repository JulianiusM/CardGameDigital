<script lang="ts">
    import { onMount } from "svelte";
    import QRCode from "qrcode";
    import Account from "./Account.svelte";
    import type { BoundarySelection } from "./BoundarySetup.svelte";
    import Couch from "./Couch.svelte";
    import GameSettingsEditor from "./GameSettingsEditor.svelte";
    import Help from "./Help.svelte";
    import Home from "./Home.svelte";
    import PresentationControls from "./PresentationControls.svelte";
    import RoomGameplay from "./RoomGameplay.svelte";
    import RoomLobby from "./RoomLobby.svelte";
    import SettingsModal from "./SettingsModal.svelte";
    import { messages } from "./i18n";
    import {
        clearJoin,
        loadGameProfiles,
        loadLastJoin,
        RoomSocket,
        type GameProfileSummary,
        type Join,
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
    let error = "";
    let qr = "";
    let profiles: GameProfileSummary[] = [];
    let settingsDraft: RoomGameSettings | null = null;
    let settingsDirty = false;
    let devicePlayerNames: string[] = [];
    let projectedDevicePlayerKey = "";
    let transferTarget = "";
    let updateCounter = 0;
    let lastCardId: string | undefined;
    let settingsOpen = false;
    let recoveringRoom = false;
    let sessionStartedAt = Date.now();
    let observedSessionId: string | undefined;

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
    $: effectiveRole = (updateCounter, connection?.role);
    $: roomPresence = (updateCounter, connection?.presence ?? []);
    $: connectionError = (updateCounter, connection?.error ?? "");
    $: connectionErrorCode = (updateCounter, connection?.errorCode ?? "");
    $: settingsNotice = (updateCounter, connection?.settingsNotice ?? "");
    $: roomSettings = snapshot?.settings;
    $: roomCode = joined?.roomCode ?? "";
    $: {
        if (session?.id && session.id !== observedSessionId) {
            observedSessionId = session.id;
            sessionStartedAt = Date.now();
        }
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
        joined = value;
        recoveringRoom = true;
        error = "";
        connection = new RoomSocket(
            value,
            () => {
                updateCounter++;
                recoveringRoom = !connection?.authenticated;
            },
            () => leaveCompleted(value),
        );
        qr = await QRCode.toDataURL(`${location.origin}/play/?room=${value.roomCode}`, {
            margin: 1,
            width: 260,
            color: { dark: "#17132d", light: "#ffffff" },
        });
        profiles = await loadGameProfiles();
    }

    function leaveCompleted(value: Join): void {
        clearJoin(value);
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

{#if route === "home" || route === "account" || route === "help"}<PresentationControls />{/if}

{#if route === "home"}
    <Home />
{:else if route === "account"}
    <Account />
{:else if route === "help"}
    <Help />
{:else if route === "couch"}
    <Couch />
{:else if route === "room"}
    <main class:playing={joined}>
        {#if error || connectionError}<div class="error room-error" role="alert">
                {error || connectionError}
            </div>{/if}
        {#if settingsNotice}<div class="toast" role="status">
                <span>{settingsNotice}</span><button
                    class="icon"
                    aria-label={messages.settings.dismiss}
                    on:click={() => connection?.clearSettingsNotice()}>×</button
                >
            </div>{/if}
        {#if recoveringRoom || !snapshot || !effectiveRole}
            <section class="card-panel reconnect-panel" aria-live="polite">
                <h1>{messages.common.reconnecting}</h1>
            </section>
        {:else}
            <header>
                <span class="eyebrow">{messages.room.roles[effectiveRole]}</span>
                <h1>{roomCode}</h1>
            </header>
            {#if !session}
                <button
                    class="settings-trigger"
                    aria-label={messages.settings.title}
                    on:click={openSettings}
                    ><span class="gear-icon" aria-hidden="true">⚙</span></button
                >
                <RoomLobby
                    {participants}
                    presence={roomPresence}
                    {effectiveRole}
                    boundaryConfigured={snapshot.boundaryConfigured}
                    {qr}
                    code={roomCode}
                    settings={snapshot.settings}
                    {profiles}
                    {devicePlayerNames}
                    onSetDevicePlayer={setDevicePlayer}
                    onAddDevicePlayer={() => (devicePlayerNames = [...devicePlayerNames, ""])}
                    onRemoveDevicePlayer={(index) =>
                        (devicePlayerNames = devicePlayerNames.filter(
                            (_, current) => current !== index,
                        ))}
                    onSaveDevicePlayers={saveDevicePlayers}
                    onStart={startSession}
                    onSaveBoundaries={saveBoundaries}
                    onOpenSettings={openSettings}
                    onLeave={leaveRoom}
                />
            {:else}
                <RoomGameplay
                    {session}
                    role={effectiveRole}
                    startedAt={sessionStartedAt}
                    {participants}
                    presence={roomPresence}
                    {roomCode}
                    exhausted={connectionErrorCode === "CARD_POOL_EXHAUSTED"}
                    onCommand={command}
                    onOpenSettings={openSettings}
                />
            {/if}
            <SettingsModal
                bind:open={settingsOpen}
                showGame={!session && effectiveRole === "HOST"}
                showAdvanced={!session && effectiveRole === "HOST"}
                showContent={!session && effectiveRole !== "DISPLAY"}
                onBoundaries={!session && effectiveRole !== "DISPLAY" ? saveBoundaries : undefined}
                onEnd={session && effectiveRole === "HOST"
                    ? () => command("command.endSession")
                    : undefined}
                onLeave={leaveRoom}
                {roomCode}
                {qr}
            >
                <div slot="game">
                    {#if settingsDraft}<GameSettingsEditor
                            settings={settingsDraft}
                            {profiles}
                            onChange={changeSettings}
                        />
                        <button
                            class="primary wide"
                            disabled={!settingsDirty}
                            on:click={saveRoomSettings}>{messages.common.save}</button
                        >{/if}
                </div>
                <div slot="advanced" class="section-grid">
                    <label
                        >{messages.room.transfer}<select bind:value={transferTarget}
                            ><option value="">{messages.room.selectDevice}</option
                            >{#each participants.filter((participant) => participant.role === "PLAYER") as candidate}<option
                                    value={candidate.id}>{candidate.displayName}</option
                                >{/each}</select
                        ></label
                    >
                    <button
                        class="secondary"
                        disabled={!transferTarget}
                        on:click={() =>
                            command("command.transferHost", { participantId: transferTarget })}
                        >{messages.room.transferAction}</button
                    >
                </div>
            </SettingsModal>
        {/if}
    </main>
{/if}
