<script lang="ts">
    import UiIcon from "./UiIcon.svelte";

    export let href: string;
    export let label: string;
    export let icon = "service";
    export let newTab = false;
</script>

<a
    class="settings-action"
    {href}
    target={newTab ? "_blank" : undefined}
    rel={newTab ? "noopener noreferrer" : undefined}
>
    <span class="settings-action-icon" aria-hidden="true"><UiIcon name={icon} /></span>
    <strong>{label}</strong>
    <span class="settings-action-arrow" aria-hidden="true">›</span>
</a>
