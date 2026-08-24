<script lang="ts">
    import BackdropLayer from "./BackdropLayer.svelte";
    import { backdropPresentation } from "./presentation";
</script>

<div class="adaptive-backdrop" aria-hidden="true">
    <BackdropLayer presentation={$backdropPresentation} />
</div>

<style>
    .adaptive-backdrop {
        position: fixed;
        z-index: 0;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
    }
</style>
