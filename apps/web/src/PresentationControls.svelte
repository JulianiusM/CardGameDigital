<script lang="ts">
    import SettingsModal from "./SettingsModal.svelte";
    import { messages } from "./i18n";
    let open = false;
</script>

<button class="settings-trigger" aria-label={messages.settings.title} on:click={() => (open = true)}
    ><span class="gear-icon" aria-hidden="true">⚙</span></button
>
<SettingsModal bind:open />
