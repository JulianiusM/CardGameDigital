<script lang="ts">
    import GameSettingsSummary from "./GameSettingsSummary.svelte";
    import ModalShell from "./ModalShell.svelte";
    import { messages } from "./i18n";
    import type {
        CardLocaleSummary,
        GameProfileSummary,
        RoomEligibilityAccess,
        VersionedRoomGameSettings,
    } from "../../../packages/protocol";
    export let open = false;
    export let settings: VersionedRoomGameSettings;
    export let profiles: readonly GameProfileSummary[] = [];
    export let cardLocales: readonly CardLocaleSummary[] = [];
    export let playerCount = 2;
    export let roomAccess: RoomEligibilityAccess | undefined = undefined;
</script>

<ModalShell bind:open labelledBy="current-game-settings-title" className="current-settings-modal">
    <header class="modal-header">
        <h2 id="current-game-settings-title">{messages.room.currentSettings}</h2>
        <button
            class="icon close"
            aria-label={messages.settings.close}
            on:click={() => (open = false)}>×</button
        >
    </header>
    {#if open}
        <div class="modal-content">
            <GameSettingsSummary
                {settings}
                {profiles}
                {cardLocales}
                {playerCount}
                {roomAccess}
                showEligibility
            />
        </div>
    {/if}
</ModalShell>
