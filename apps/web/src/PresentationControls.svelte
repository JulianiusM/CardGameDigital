<script lang="ts">
    import SettingsModal from "./SettingsModal.svelte";
    import SettingsTrigger from "./SettingsTrigger.svelte";
    let open = false;
</script>

<SettingsTrigger onOpen={() => (open = true)} />
<SettingsModal bind:open />
