<script lang="ts">
    import GameSettingsSummary from "./GameSettingsSummary.svelte";
    import { messages } from "./i18n";
    import type { GameProfileSummary, VersionedRoomGameSettings } from "./multiplayer";
    export let open = false;
    export let settings: VersionedRoomGameSettings;
    export let profiles: readonly GameProfileSummary[] = [];
</script>

{#if open}
    <div class="modal-backdrop" role="presentation" on:click={() => (open = false)}>
        <!-- Dialog consumes pointer events so only the backdrop dismisses it. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role a11y_click_events_have_key_events -->
        <div
            class="settings-modal current-settings-modal"
            role="dialog"
            tabindex="-1"
            aria-modal="true"
            aria-labelledby="current-game-settings-title"
            on:click|stopPropagation
        >
            <header class="modal-header">
                <h2 id="current-game-settings-title">{messages.room.currentSettings}</h2>
                <button
                    class="icon close"
                    aria-label={messages.settings.close}
                    on:click={() => (open = false)}>×</button
                >
            </header>
            <div class="modal-content"><GameSettingsSummary {settings} {profiles} /></div>
        </div>
    </div>
{/if}
