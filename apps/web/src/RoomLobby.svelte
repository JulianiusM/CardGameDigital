<script lang="ts">
    import BoundarySetup, { type BoundarySelection } from "./BoundarySetup.svelte";
    import { messages } from "./i18n";
    import type { Participant, Presence, Role } from "./multiplayer";

    export let participants: Participant[];
    export let presence: Presence[];
    export let effectiveRole: Role;
    export let boundaryConfigured: boolean;
    export let qr: string;
    export let code: string;
    export let devicePlayerNames: string[];
    export let onSetDevicePlayer: (index: number, value: string) => void;
    export let onAddDevicePlayer: () => void;
    export let onRemoveDevicePlayer: (index: number) => void;
    export let onSaveDevicePlayers: () => void;
    export let onStart: () => void;
    export let onSaveBoundaries: (boundaries: BoundarySelection) => void;

    $: players = participants.filter(
        (participant) =>
            participant.role !== "DISPLAY" && participant.connectionStatus === "CONNECTED",
    );
    $: playerCount = players.reduce(
        (total, participant) => total + 1 + participant.devicePlayers.length,
        0,
    );
    function isOnline(participantId: string): boolean {
        return presence.some((entry) => entry.participantId === participantId);
    }
</script>

<section class="lobby-grid">
    <div class="card-panel lobby">
        <h2>{messages.room.lobby}</h2>

        {#each participants as participant}
            <div class="participant">
                <span class:online={isOnline(participant.id)}></span>
                <strong>{participant.displayName}</strong>
                <small>{participant.role}</small>
            </div>
            {#each participant.devicePlayers as player}
                <div class="participant device-player">
                    <span class:online={isOnline(participant.id)}></span>
                    <strong>{player.name}</strong>
                    <small>{participant.displayName}</small>
                </div>
            {/each}
        {/each}

        {#if effectiveRole !== "DISPLAY"}
            <div class="players">
                <h3>{messages.room.localPlayers}</h3>
                {#each devicePlayerNames as localName, index}
                    <label>
                        {messages.common.person}
                        {index + 1}
                        <input
                            value={localName}
                            maxlength="40"
                            on:input={(event) =>
                                onSetDevicePlayer(index, event.currentTarget.value)}
                        />
                        <button
                            class="icon"
                            aria-label={messages.room.localPerson}
                            on:click={() => onRemoveDevicePlayer(index)}
                        >
                            ×
                        </button>
                    </label>
                {/each}
                <button class="secondary" on:click={onAddDevicePlayer}>
                    {messages.room.addLocalPerson}
                </button>
                <button class="secondary" on:click={onSaveDevicePlayers}>
                    {messages.room.saveLocalPlayers}
                </button>
            </div>
        {/if}

        {#if effectiveRole === "HOST"}
            <button class="primary lobby-start" disabled={playerCount < 2} on:click={onStart}>
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
    </div>

    <div class="card-panel join-card">
        <h2>{messages.room.phoneJoin}</h2>
        {#if qr}<img src={qr} alt={messages.accessibility.roomQrCode(code)} />{/if}
        <strong>{code}</strong>
        <p>{messages.room.qrPrivacy}</p>
    </div>
</section>
