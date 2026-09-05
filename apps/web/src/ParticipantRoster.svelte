<script lang="ts">
    import { scrollText } from "./scrollText";
    import AutoPageRegion from "./AutoPageRegion.svelte";
    import { messages } from "./i18n";
    import type { Participant, Presence } from "./multiplayer";

    export let participants: readonly Participant[];
    export let presence: readonly Presence[];
    export let stage = false;
    export let includeDisplays = false;
    export let collapsible = true;
    export let roomCode = "";

    $: visibleParticipants = participants.filter(
        ({ role }) => includeDisplays || role !== "DISPLAY",
    );
    $: rows = visibleParticipants.flatMap((participant) => [
        {
            id: participant.id,
            name: participant.displayName,
            meta: participant.role,
            online: isOnline(participant.id),
            device: false,
        },
        ...participant.devicePlayers.map((player) => ({
            id: player.id,
            name: player.name,
            meta: participant.displayName,
            online: isOnline(participant.id),
            device: true,
        })),
    ]);

    function isOnline(participantId: string): boolean {
        return presence.some((entry) => entry.participantId === participantId);
    }
</script>

{#if stage}
    <section class="stage-player-roster" aria-label={messages.settings.players}>
        <header>
            <strong>{messages.settings.players}</strong><span>{rows.length}</span>
            {#if roomCode}<small>{messages.setup.roomCode}: {roomCode}</small>{/if}
        </header>
        <AutoPageRegion
            itemCount={rows.length}
            rowHeight={38}
            minColumnWidth={165}
            label={messages.settings.players}
            let:start
            let:end
        >
            <div class="stage-player-grid">
                {#each rows.slice(start, end) as row}
                    <div class="stage-player" title={row.name}>
                        <i class:online={row.online} aria-hidden="true"></i><strong
                            use:scrollText={true}>{row.name}</strong
                        >
                    </div>
                {/each}
            </div>
        </AutoPageRegion>
    </section>
{:else if collapsible}
    <details class="live-players">
        <summary>{messages.settings.players} · {rows.length}</summary>
        <div class="participant-list">
            {#each rows as row}
                <div class:device-player={row.device} class="participant">
                    <span class:online={row.online}></span><strong use:scrollText>{row.name}</strong
                    ><small use:scrollText>{row.meta}</small>
                </div>
            {/each}
        </div>
        {#if roomCode}<small>{messages.setup.roomCode}: {roomCode}</small>{/if}
    </details>
{:else}
    <section class="participant-roster-list" aria-label={messages.settings.players}>
        <header><strong>{messages.settings.players}</strong><span>{rows.length}</span></header>
        <div class="participant-list">
            {#each rows as row}
                <div class:device-player={row.device} class="participant">
                    <span class:online={row.online}></span><strong use:scrollText>{row.name}</strong
                    ><small use:scrollText>{row.meta}</small>
                </div>
            {/each}
        </div>
    </section>
{/if}
