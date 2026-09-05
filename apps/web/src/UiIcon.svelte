<script lang="ts">
    export let name: string;
    export let label: string | undefined = undefined;
</script>

<svg
    class="ui-icon"
    viewBox="0 0 24 24"
    role={label ? "img" : undefined}
    aria-hidden={label ? undefined : "true"}
>
    {#if label}<title>{label}</title>{/if}
    <use href={`/play/motifs/ui-icons.svg#${name}`}></use>
</svg>
