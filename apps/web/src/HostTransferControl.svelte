<script lang="ts">
    import { messages } from "./i18n";
    import type { Participant } from "./multiplayer";

    export let participants: readonly Participant[];
    export let selected = "";
    export let onSelect: (participantId: string) => void;
    export let onTransfer: () => void;

    $: candidates = participants.filter(({ role }) => role === "PLAYER");
</script>

<section class="settings-section-card host-transfer-control">
    <div>
        <h3 id="host-transfer-title">{messages.room.transfer}</h3>
        <p>{messages.room.transferHint}</p>
    </div>
    <div class="host-transfer-action">
        <label
            ><span>{messages.room.selectDevice}</span><select
                aria-label={messages.room.transfer}
                value={selected}
                on:change={(event) => onSelect(event.currentTarget.value)}
            >
                <option value="">{messages.room.selectDevice}</option>
                {#each candidates as candidate}<option value={candidate.id}
                        >{candidate.displayName}</option
                    >{/each}
            </select></label
        >
        <button class="secondary" disabled={!selected} on:click={onTransfer}>
            {messages.room.transferAction}
        </button>
    </div>
</section>
