<script lang="ts">
    import GameSettingsSummary from "./GameSettingsSummary.svelte";
    import ModalShell from "./ModalShell.svelte";
    import { messages } from "./i18n";
    import type {
        CardLocaleSummary,
        GameProfileSummary,
        VersionedRoomGameSettings,
    } from "./multiplayer";
    export let open = false;
    export let settings: VersionedRoomGameSettings;
    export let profiles: readonly GameProfileSummary[] = [];
    export let cardLocales: readonly CardLocaleSummary[] = [];
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
    <div class="modal-content">
        <GameSettingsSummary {settings} {profiles} {cardLocales} />
    </div>
</ModalShell>
