<script lang="ts">
    import { messages } from "./i18n";
    import type { Participant } from "./multiplayer";
    import WrappingSelect, { type WrappingSelectOption } from "./WrappingSelect.svelte";

    export let participants: readonly Participant[];
    export let selected = "";
    export let onSelect: (participantId: string) => void;
    export let onTransfer: () => void;

    $: candidates = participants.filter(({ role }) => role === "PLAYER");
    $: candidateOptions = [
        { value: "", label: messages.room.selectDevice },
        ...candidates.map(({ id, displayName }) => ({ value: id, label: displayName })),
    ] satisfies WrappingSelectOption[];
</script>

<section class="settings-section-card host-transfer-control">
    <div>
        <h3 id="host-transfer-title">{messages.room.transfer}</h3>
        <p>{messages.room.transferHint}</p>
    </div>
    <div class="host-transfer-action">
        <div class="host-transfer-field">
            <span>{messages.room.selectDevice}</span>
            <WrappingSelect
                value={selected}
                options={candidateOptions}
                label={messages.room.transfer}
                onChange={onSelect}
            />
        </div>
        <button class="secondary" disabled={!selected} on:click={onTransfer}>
            {messages.room.transferAction}
        </button>
    </div>
</section>
