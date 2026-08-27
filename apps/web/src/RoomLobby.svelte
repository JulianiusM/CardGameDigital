<script lang="ts">
    import BoundarySetup, { type BoundarySelection } from "./BoundarySetup.svelte";
    import { messages } from "./i18n";
    import ParticipantRoster from "./ParticipantRoster.svelte";
    import PlayerNameRow from "./PlayerNameRow.svelte";
    import type {
        GameProfileSummary,
        CardLocaleSummary,
        Participant,
        Presence,
        Role,
        RoomBootstrapMode,
        RoomHostStatus,
        VersionedRoomGameSettings,
    } from "./multiplayer";
    import EligibleCardPreview from "./EligibleCardPreview.svelte";
    import type { RoomEligibilityAccess } from "./cardPolicyApi";
    import RoomAvailabilityUrls from "./RoomAvailabilityUrls.svelte";

    export let participants: Participant[];
    export let presence: Presence[];
    export let effectiveRole: Role;
    export let bootstrapMode: RoomBootstrapMode;
    export let hostStatus: RoomHostStatus;
    export let boundaryConfigured: boolean;
    export let qr: string;
    export let roomUrls: string[] = [];
    export let code: string;
    export let settings: VersionedRoomGameSettings;
    export let roomAccess: RoomEligibilityAccess;
    export let profiles: GameProfileSummary[];
    export let cardLocales: CardLocaleSummary[] = [];
    export let devicePlayerNames: string[];
    export let onSetDevicePlayer: (index: number, value: string) => void;
    export let onAddDevicePlayer: () => void;
    export let onRemoveDevicePlayer: (index: number) => void;
    export let devicePlayersDirty = false;
    export let devicePlayersSaving = false;
    export let onStart: () => void;
    export let onSaveBoundaries: (boundaries: BoundarySelection) => void;
    export let onOpenSettings: () => void;
    export let onViewSettings: () => void;
    export let onLeave: () => void;

    $: players = participants.filter(
        (participant) =>
            participant.role !== "DISPLAY" && participant.connectionStatus === "CONNECTED",
    );
    $: playerCount = players.reduce(
        (total, participant) => total + 1 + participant.devicePlayers.length,
        0,
    );
    $: selectedProfile = profiles.find(({ id }) => id === settings.profileId);
    $: selectedMode = Object.values(messages.modes).find(([id]) => id === settings.mode);
    $: selectedLocale = cardLocales.find(({ id }) => id === settings.cardLocale);
    $: hostStatusText = projectHostStatus(hostStatus);

    function projectHostStatus(status: RoomHostStatus): { title: string; detail: string } {
        switch (status.state) {
            case "AWAITING_FIRST_HOST":
                return {
                    title: messages.room.awaitingFirstHost,
                    detail: messages.room.awaitingFirstHostHint,
                };
            case "CONNECTING":
                return {
                    title: messages.room.hostConnecting(status.displayName ?? ""),
                    detail: messages.room.hostConnectingHint,
                };
            case "CONNECTED":
                return {
                    title: messages.room.hostConnected(status.displayName ?? ""),
                    detail: messages.room.hostConnectedHint,
                };
            case "RECONNECTING":
                return {
                    title: messages.room.hostReconnecting(status.displayName ?? ""),
                    detail: messages.room.hostReconnectingHint,
                };
            case "AWAITING_REPLACEMENT_HOST":
                return {
                    title: messages.room.awaitingReplacementHost,
                    detail: messages.room.awaitingReplacementHostHint,
                };
        }
    }
</script>

<section class:public-stage-lobby={effectiveRole === "DISPLAY"} class="lobby-grid">
    <div class="card-panel lobby">
        <h2>{messages.room.lobby}</h2>

        {#if effectiveRole === "DISPLAY" && bootstrapMode === "DISPLAY_WAITING_FOR_HOST"}<section
                class:connected={hostStatus.state === "CONNECTED"}
                class:attention={hostStatus.state !== "CONNECTED"}
                class="host-status-banner"
                aria-live="polite"
            >
                <span class="host-status-orb" aria-hidden="true"></span>
                <div>
                    <strong>{hostStatusText.title}</strong>
                    <p>{hostStatusText.detail}</p>
                </div>
            </section>{/if}

        <section class="room-settings-summary" aria-labelledby="room-settings-heading">
            <div>
                <h3 id="room-settings-heading">{messages.room.currentSettings}</h3>
                <p>
                    <strong>{selectedMode?.[1] ?? settings.mode}</strong> · {selectedProfile?.name ??
                        settings.profileId}
                </p>
                <small
                    >{selectedLocale?.nativeName ?? settings.cardLocale} · {messages.room
                        .startingIntensity}: {settings.configuration.startingIntensity} → {messages
                        .room.endingIntensity}: {settings.configuration.maximumIntensity} · {messages
                        .cardManagement.sensitivityNames[
                        settings.configuration.maximumSocialSensitivity
                    ]} · {settings.configuration.enabledQuestionCategoryIds.length}
                    {messages.settings.content} · {settings.configuration.enabledDareTypeIds.length}
                    {messages.common.dare}</small
                >
                {#if settings.mode === "NEVER_HAVE_I_EVER"}<small class="reveal-summary">
                        {settings.neverHaveIEverRevealMode === "NAMED_ANSWERS"
                            ? messages.neverHaveIEver.named
                            : messages.neverHaveIEver.anonymous}
                    </small>{/if}
            </div>
            <div class="room-settings-actions">
                {#if effectiveRole === "DISPLAY"}
                    <EligibleCardPreview {settings} {playerCount} {roomAccess} compact />
                {/if}
                <button class="secondary" on:click={onViewSettings}
                    >{messages.room.viewSettings}</button
                >
                {#if effectiveRole === "HOST"}<button class="text-action" on:click={onOpenSettings}
                        >{messages.room.editSettings}</button
                    >{/if}
            </div>
        </section>

        {#if effectiveRole !== "DISPLAY"}
            <EligibleCardPreview {settings} {playerCount} {roomAccess} compact />
        {/if}

        <ParticipantRoster
            {participants}
            {presence}
            stage={effectiveRole === "DISPLAY"}
            includeDisplays={effectiveRole !== "DISPLAY"}
            collapsible={false}
            roomCode={code}
        />

        {#if effectiveRole !== "DISPLAY"}
            <div class="players">
                <h3>{messages.room.localPlayers}</h3>
                {#each devicePlayerNames as localName, index}
                    <PlayerNameRow
                        {index}
                        value={localName}
                        onInput={(value) => onSetDevicePlayer(index, value)}
                        onRemove={() => onRemoveDevicePlayer(index)}
                    />
                {/each}
                <button class="secondary" on:click={onAddDevicePlayer}>
                    {messages.room.addLocalPerson}
                </button>
                <p
                    class:saving={devicePlayersDirty}
                    class="device-player-save-status"
                    aria-live="polite"
                >
                    {devicePlayersSaving
                        ? messages.room.savingLocalPlayers
                        : devicePlayersDirty
                          ? messages.room.localPlayersPending
                          : messages.room.localPlayersSaved}
                    <small>{messages.room.localPlayersAutoSaveHint}</small>
                </p>
            </div>
        {/if}

        {#if effectiveRole === "HOST"}
            <button
                class="primary primary-action lobby-start"
                disabled={playerCount < 2}
                on:click={onStart}
            >
                {messages.room.start}
            </button>
        {/if}

        {#if effectiveRole !== "DISPLAY"}
            {#if boundaryConfigured}<p class="boundary-saved">
                    {messages.room.boundariesSaved}
                </p>{/if}
            <details class="advanced">
                <summary>{messages.boundaries.heading}</summary>
                <BoundarySetup cardLocale={settings.cardLocale} onSave={onSaveBoundaries} />
            </details>
        {/if}
        <div class="lobby-actions">
            <button class="text-action leave-lobby" on:click={onLeave}
                >{messages.room.leaveLobby}</button
            >
        </div>
    </div>

    <div class="card-panel join-card">
        <h2>{messages.room.phoneJoin}</h2>
        {#if qr}<img src={qr} alt={messages.accessibility.roomQrCode(code)} />{/if}
        <strong>{code}</strong>
        <RoomAvailabilityUrls urls={roomUrls} autoPage={effectiveRole === "DISPLAY"} />
        <p>{messages.room.qrPrivacy}</p>
    </div>
</section>
