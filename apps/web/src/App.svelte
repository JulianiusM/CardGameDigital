<script lang="ts">
    import { onMount } from "svelte";
    import QRCode from "qrcode";
    import type { BoundarySelection } from "./BoundarySetup.svelte";
    import Couch from "./Couch.svelte";
    import Home from "./Home.svelte";
    import Account from "./Account.svelte";
    import Help from "./Help.svelte";
    import PresentationControls from "./PresentationControls.svelte";
    import RoomLobby from "./RoomLobby.svelte";
    import RoomGameplay from "./RoomGameplay.svelte";
    import SettingsModal from "./SettingsModal.svelte";
    import { presentation } from "./presentation";
    import { atmosphereFor, effectForCommand, sceneFor } from "./presentationMapping";
    import { cardLocale, messages, gameModes } from "./i18n";
    import {
        loadGameProfiles,
        loadHostConfiguration,
        loadJoin,
        rooms,
        RoomSocket,
        saveJoin,
        saveGameSettings,
        type GameProfileSummary,
        type GroupSummary,
        type Join,
        type Role,
    } from "./multiplayer";

    const route = location.pathname.replace(/^\/play\/?/, "");
    const isHome = !route;
    const isCouch = route === "couch";
    const isAccount = route === "account";
    const isHelp = route === "help";
    function roleForRoute(path: string): Role {
        if (path.startsWith("display")) return "DISPLAY";
        if (path.startsWith("host")) return "HOST";
        return "PLAYER";
    }

    const role = roleForRoute(route);
    const joinRole: Exclude<Role, "HOST"> = role === "DISPLAY" ? "DISPLAY" : "PLAYER";
    const modes = gameModes;

    let name = role === "DISPLAY" ? messages.room.displayName : "";
    let code = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
    let joined: Join | null = null;
    let connection: RoomSocket | null = null;
    let error = "";
    let qr = "";
    let mode: (typeof modes)[number][0] =
        (new URLSearchParams(location.search).get("mode") as (typeof modes)[number][0]) ??
        modes[0][0];
    let profiles: GameProfileSummary[] = [];
    let profileId = new URLSearchParams(location.search).get("profile") ?? "PROFILE_FRIENDS";
    let adultContentConfirmed = false;
    let groups: GroupSummary[] = [];
    let groupId = "";
    let maximumIntensity = 3;
    let randomQuestionRatio = 0.6;
    let letsTalkMetaInterval = 5;
    let canPersist = false;
    let persistRoom = false;
    let devicePlayerNames: string[] = [];
    let transferTarget = "";
    let updateCounter = 0;
    let lastCardId: string | undefined;
    let settingsOpen = false;
    let sessionStartedAt = Date.now();
    let observedSessionId: string | undefined;

    // RoomSocket owns mutable transport state. The counter tells Svelte to
    // re-evaluate its snapshot and presence values after each server message.
    $: snapshot = (updateCounter, connection?.snapshot);
    $: session = snapshot?.session;
    $: participants = snapshot?.participants ?? [];
    $: effectiveRole = connection?.role ?? role;
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

    async function connect(value: Join): Promise<void> {
        joined = value;
        code = value.roomCode;
        connection = new RoomSocket(value, () => updateCounter++);

        // The QR code contains only the public Room code, never the participant credential.
        qr = await QRCode.toDataURL(`${location.origin}/play/mobile?room=${code}`, {
            margin: 1,
            width: 260,
            color: { dark: "#17132d", light: "#ffffff" },
        });
    }

    onMount(async () => {
        profiles = await loadGameProfiles();
        if (role === "HOST") {
            try {
                const configuration = await loadHostConfiguration();
                groups = configuration.groups;
                profileId = configuration.settings.preferredProfileId;
                groupId = configuration.settings.defaultGroupId ?? "";
                maximumIntensity = configuration.settings.maximumIntensity;
                randomQuestionRatio = configuration.settings.randomQuestionRatio;
                letsTalkMetaInterval = configuration.settings.letsTalkMetaInterval;
                canPersist = true;
            } catch {
                // Public anonymous hosts intentionally have no DataSpace configuration.
                canPersist = false;
            }
        }
        const savedJoin = code ? loadJoin(code, role) : null;
        if (savedJoin) void connect(savedJoin);
    });

    async function enterRoom(): Promise<void> {
        error = "";
        try {
            let result: Join;
            if (role === "HOST") {
                const persistence = persistRoom ? "DATASPACE" : "EPHEMERAL";
                result = await rooms.create(name || "Host", persistence);
            } else {
                result = await rooms.join(code, name, joinRole);
            }
            saveJoin(result);
            await connect(result);
        } catch (cause) {
            error = cause instanceof Error ? cause.message : messages.common.connectionFailed;
        }
    }

    function command(type: string, payload: object = {}): void {
        presentation.playEffect(effectForCommand(type));
        connection?.command(type, payload);
    }

    async function startSession(): Promise<void> {
        try {
            if (persistRoom) {
                await saveGameSettings({
                    preferredProfileId: profileId,
                    maximumIntensity,
                    randomQuestionRatio,
                    letsTalkMetaInterval,
                    defaultGroupId: groupId || null,
                });
            }
        } catch (cause) {
            error = cause instanceof Error ? cause.message : messages.room.settingsError;
            return;
        }
        command("command.startSession", {
            mode,
            profileId,
            groupId: persistRoom && groupId ? groupId : null,
            adultContentConfirmed,
            maximumIntensity,
            randomQuestionRatio,
            letsTalkMetaInterval,
            cardLocale,
        });
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
</script>

{#if !session}<PresentationControls />{/if}

{#if isHome}
    <Home />
{:else if isAccount}
    <Account />
{:else if isHelp}
    <Help />
{:else if isCouch}
    <Couch />
{:else}
    <main class:playing={joined}>
        <header>
            <span class="eyebrow">
                {messages.room.roles[effectiveRole]}
            </span>
            <h1>{joined ? code : messages.room.connect}</h1>
        </header>

        {#if error || connection?.error}
            <div class="error" role="alert">{error || connection?.error}</div>
        {/if}

        {#if !joined}
            <section class="card-panel connect">
                <h2>{role === "HOST" ? messages.room.create : messages.room.join}</h2>
                <label>
                    {messages.room.yourName}
                    <input
                        bind:value={name}
                        maxlength="40"
                        placeholder={messages.room.namePlaceholder}
                    />
                </label>
                {#if role !== "HOST"}
                    <label>
                        {messages.room.code}
                        <input
                            bind:value={code}
                            maxlength="6"
                            placeholder={messages.room.codePlaceholder}
                        />
                    </label>
                {/if}
                <button class="primary" on:click={enterRoom}>
                    {role === "HOST" ? messages.room.createAction : messages.room.joinAction}
                </button>
                {#if role === "HOST" && canPersist}
                    <label class="adult-confirmation">
                        <input type="checkbox" bind:checked={persistRoom} />
                        {messages.room.persist}
                    </label>
                {/if}
                <p><a href="/play/couch">{messages.room.couchAlternative}</a></p>
            </section>
        {:else if !session}
            <RoomLobby
                {participants}
                presence={connection?.presence ?? []}
                {effectiveRole}
                boundaryConfigured={snapshot?.boundaryConfigured ?? false}
                {qr}
                {code}
                {devicePlayerNames}
                {profiles}
                {groups}
                bind:profileId
                bind:groupId
                bind:mode
                bind:maximumIntensity
                bind:randomQuestionRatio
                bind:persistRoom
                bind:adultContentConfirmed
                bind:transferTarget
                onSetDevicePlayer={setDevicePlayer}
                onAddDevicePlayer={() => (devicePlayerNames = [...devicePlayerNames, ""])}
                onRemoveDevicePlayer={(index) =>
                    (devicePlayerNames = devicePlayerNames.filter(
                        (_, current) => current !== index,
                    ))}
                onSaveDevicePlayers={saveDevicePlayers}
                onStart={startSession}
                onTransferHost={(participantId) =>
                    command("command.transferHost", { participantId })}
                onSaveBoundaries={saveBoundaries}
            />
        {:else}
            <RoomGameplay
                {session}
                role={effectiveRole}
                startedAt={sessionStartedAt}
                onCommand={command}
                onOpenSettings={() => (settingsOpen = true)}
            />
        {/if}
        {#if session && effectiveRole === "HOST"}<SettingsModal
                bind:open={settingsOpen}
                showContent
                onBoundaries={saveBoundaries}
                onEnd={() => command("command.endSession")}
            />{/if}
    </main>
{/if}
