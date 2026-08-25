<script lang="ts">
    import { messages } from "./i18n";

    export let onAll: () => void;
    export let onNone: () => void;
</script>

<div class="bulk-selection-actions" aria-label={messages.common.selectionActions}>
    <button type="button" on:click={onAll}>{messages.common.allActive}</button>
    <button type="button" on:click={onNone}>{messages.common.noneActive}</button>
</div>
