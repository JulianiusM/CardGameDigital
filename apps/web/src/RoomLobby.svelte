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
        VersionedRoomGameSettings,
    } from "./multiplayer";

    export let participants: Participant[];
    export let presence: Presence[];
    export let effectiveRole: Role;
    export let boundaryConfigured: boolean;
    export let qr: string;
    export let code: string;
    export let settings: VersionedRoomGameSettings;
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
</script>

<section class:public-stage-lobby={effectiveRole === "DISPLAY"} class="lobby-grid">
    <div class="card-panel lobby">
        <h2>{messages.room.lobby}</h2>

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
                        .room.endingIntensity}: {settings.configuration.maximumIntensity} · {settings
                        .configuration.enabledQuestionCategoryIds.length}
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
                <button class="secondary" on:click={onViewSettings}
                    >{messages.room.viewSettings}</button
                >
                {#if effectiveRole === "HOST"}<button class="text-action" on:click={onOpenSettings}
                        >{messages.room.editSettings}</button
                    >{/if}
            </div>
        </section>

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
                <BoundarySetup onSave={onSaveBoundaries} />
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
        <p>{messages.room.qrPrivacy}</p>
    </div>
</section>
