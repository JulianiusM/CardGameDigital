<script lang="ts">
    export let href: string;
    export let label: string;
    export let icon = "↗";
    export let newTab = false;
</script>

<a
    class="settings-action"
    {href}
    target={newTab ? "_blank" : undefined}
    rel={newTab ? "noopener noreferrer" : undefined}
>
    <span class="settings-action-icon" aria-hidden="true">{icon}</span>
    <strong>{label}</strong>
    <span class="settings-action-arrow" aria-hidden="true">›</span>
</a>
