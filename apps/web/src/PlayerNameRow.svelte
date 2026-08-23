<script lang="ts">
    import { messages } from "./i18n";

    export let index: number;
    export let value: string;
    export let removable = true;
    export let onInput: (value: string) => void;
    export let onRemove: () => void;

    $: inputId = `player-name-${index}`;
</script>

<div class="player-name-row">
    <label for={inputId}>{messages.common.person} {index + 1}</label>
    <input
        id={inputId}
        {value}
        maxlength="40"
        on:input={(event) => onInput(event.currentTarget.value)}
    />
    {#if removable}
        <button
            type="button"
            class="icon remove-player-button"
            aria-label={`${messages.common.removePerson}: ${messages.common.person} ${index + 1}`}
            on:click={onRemove}
        >
            <span aria-hidden="true">×</span>
        </button>
    {:else}
        <span class="player-row-action-spacer" aria-hidden="true"></span>
    {/if}
</div>
