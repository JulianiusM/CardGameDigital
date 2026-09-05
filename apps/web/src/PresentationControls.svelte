<script lang="ts">
    import { dismissNotification } from "./notifications";
    import SettingsModal from "./SettingsModal.svelte";
    import SettingsTrigger from "./SettingsTrigger.svelte";
    let open = false;

    function openSettings(): void {
        dismissNotification();
        open = true;
    }
</script>

<SettingsTrigger onOpen={openSettings} />
<SettingsModal bind:open />
