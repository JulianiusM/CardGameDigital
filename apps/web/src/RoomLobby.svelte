<script lang="ts">
    import BoundarySetup, { type BoundarySelection } from "./BoundarySetup.svelte";
    import { messages, gameModes } from "./i18n";
    import type {
        GameProfileSummary,
        GroupSummary,
        Participant,
        Presence,
        Role,
    } from "./multiplayer";

    export let participants: Participant[];
    export let presence: Presence[];
    export let effectiveRole: Role;
    export let boundaryConfigured: boolean;
    export let qr: string;
    export let code: string;
    export let devicePlayerNames: string[];
    export let profiles: GameProfileSummary[];
    export let groups: GroupSummary[];
    export let profileId: string;
    export let groupId: string;
    export let mode: (typeof gameModes)[number][0];
    export let maximumIntensity: number;
    export let randomQuestionRatio: number;
    export let persistRoom: boolean;
    export let adultContentConfirmed: boolean;
    export let transferTarget: string;
    export let onSetDevicePlayer: (index: number, value: string) => void;
    export let onAddDevicePlayer: () => void;
    export let onRemoveDevicePlayer: (index: number) => void;
    export let onSaveDevicePlayers: () => void;
    export let onStart: () => void;
    export let onTransferHost: (participantId: string) => void;
    export let onSaveBoundaries: (boundaries: BoundarySelection) => void;

    $: players = participants.filter((participant) => participant.role !== "DISPLAY");
    $: playerCount = players.reduce(
        (total, participant) => total + 1 + participant.devicePlayers.length,
        0,
    );
    $: hostCandidates = participants.filter((participant) => participant.role === "PLAYER");

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
            <details class="advanced lobby-settings">
                <summary>{messages.settings.advanced}</summary>

                <label>
                    {messages.room.profile}
                    <select bind:value={profileId}>
                        {#each profiles as profile}
                            <option
                                value={profile.id}
                                disabled={profile.requiresAdultConfirmation &&
                                    !adultContentConfirmed}
                            >
                                {profile.name}
                            </option>
                        {/each}
                    </select>
                </label>

                <label class="adult-confirmation">
                    <input type="checkbox" bind:checked={adultContentConfirmed} />
                    {messages.room.adultConfirmation}
                </label>

                <label class:disabled={!persistRoom}>
                    {messages.room.groupHistory}
                    <select bind:value={groupId} disabled={!persistRoom}>
                        <option value="">{messages.room.noGroup}</option>
                        {#each groups as group}
                            <option value={group.id}>{group.name}</option>
                        {/each}
                    </select>
                </label>

                <label>
                    {messages.room.gameMode}
                    <select bind:value={mode}>
                        {#each gameModes as item}
                            <option value={item[0]}>{item[1]}</option>
                        {/each}
                    </select>
                </label>

                <div class="settings-grid">
                    <label>
                        {messages.room.maximumIntensity}
                        <input type="number" min="1" max="5" bind:value={maximumIntensity} />
                    </label>
                    <label>
                        {messages.room.questionRatio}
                        <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            bind:value={randomQuestionRatio}
                        />
                    </label>
                </div>

                <div class="host-transfer">
                    <label>
                        {messages.room.transfer}
                        <select bind:value={transferTarget}>
                            <option value="">{messages.room.selectDevice}</option>
                            {#each hostCandidates as candidate}
                                <option value={candidate.id}>{candidate.displayName}</option>
                            {/each}
                        </select>
                    </label>
                    <button
                        class="secondary"
                        disabled={!transferTarget}
                        on:click={() => onTransferHost(transferTarget)}
                    >
                        {messages.room.transferAction}
                    </button>
                </div>
            </details>

            <button class="primary lobby-start" disabled={playerCount < 2} on:click={onStart}>
                {messages.room.start}
            </button>
        {/if}

        {#if effectiveRole !== "DISPLAY"}
            {#if boundaryConfigured}
                <p class="boundary-saved">{messages.room.boundariesSaved}</p>
            {:else}
                <details class="advanced">
                    <summary>{messages.boundaries.heading}</summary>
                    <BoundarySetup onSave={onSaveBoundaries} />
                </details>
            {/if}
        {/if}
    </div>

    {#if effectiveRole !== "PLAYER"}
        <div class="card-panel join-card">
            <h2>{messages.room.phoneJoin}</h2>
            {#if qr}
                <img src={qr} alt={messages.accessibility.roomQrCode(code)} />
            {/if}
            <strong>{code}</strong>
            <p>{messages.room.qrPrivacy}</p>
        </div>
    {/if}
</section>
