<script lang="ts">
    import AutoPageRegion from "./AutoPageRegion.svelte";
    import { messages } from "./i18n";
    import type { NeverHaveIEverVotingView } from "./multiplayer";

    export let voting: NeverHaveIEverVotingView;
    export let controllablePlayerIds: readonly string[] = [];
    export let busy = false;
    export let stage = false;
    export let onVote: ((playerId: string, vote: "YES" | "NO") => void) | undefined;

    $: controllable = voting.progress.filter(
        ({ playerId, status }) => status === "PENDING" && controllablePlayerIds.includes(playerId),
    );
    $: yesNames = voting.result?.namedAnswers
        ?.filter(({ vote }) => vote === "YES")
        .map(({ displayName }) => displayName);
    $: noNames = voting.result?.namedAnswers
        ?.filter(({ vote }) => vote === "NO")
        .map(({ displayName }) => displayName);
</script>

<section class="never-voting" aria-label={messages.neverHaveIEver.progress}>
    <p class="reveal-mode-indicator">
        {voting.revealMode === "NAMED_ANSWERS"
            ? messages.neverHaveIEver.named
            : messages.neverHaveIEver.anonymous}
    </p>

    {#if voting.result}
        <h2>{messages.neverHaveIEver.result}</h2>
        <div class:stage-results={stage} class="never-result-columns">
            <section class="answer-column yes-column" aria-label={messages.common.yes}>
                <header>
                    <strong>{messages.common.yes}</strong><span>{voting.result.yes}</span>
                </header>
                {#if stage && yesNames?.length}
                    <AutoPageRegion
                        itemCount={yesNames.length}
                        rowHeight={41}
                        grid={false}
                        label={messages.common.yes}
                        let:start
                        let:end
                    >
                        <div class="answer-name-list">
                            {#each yesNames.slice(start, end) as name}<div class="answer-name">
                                    {name}
                                </div>{/each}
                        </div>
                    </AutoPageRegion>
                {:else if yesNames?.length}
                    <div class="answer-name-list">
                        {#each yesNames as name}<div class="answer-name">{name}</div>{/each}
                    </div>
                {:else if voting.result.yes === 0}<small>{messages.neverHaveIEver.noAnswers}</small
                    >{/if}
            </section>
            <section class="answer-column no-column" aria-label={messages.common.no}>
                <header>
                    <strong>{messages.common.no}</strong><span>{voting.result.no}</span>
                </header>
                {#if stage && noNames?.length}
                    <AutoPageRegion
                        itemCount={noNames.length}
                        rowHeight={41}
                        grid={false}
                        label={messages.common.no}
                        let:start
                        let:end
                    >
                        <div class="answer-name-list">
                            {#each noNames.slice(start, end) as name}<div class="answer-name">
                                    {name}
                                </div>{/each}
                        </div>
                    </AutoPageRegion>
                {:else if noNames?.length}
                    <div class="answer-name-list">
                        {#each noNames as name}<div class="answer-name">{name}</div>{/each}
                    </div>
                {:else if voting.result.no === 0}<small>{messages.neverHaveIEver.noAnswers}</small
                    >{/if}
            </section>
        </div>
    {:else}
        <h2>{messages.neverHaveIEver.progress}</h2>
        {#if stage}
            <AutoPageRegion
                itemCount={voting.progress.length}
                rowHeight={52}
                minColumnWidth={210}
                label={messages.neverHaveIEver.progress}
                let:start
                let:end
            >
                <div class="vote-progress-list" role="list">
                    {#each voting.progress.slice(start, end) as player}
                        <div
                            class:voted={player.status === "VOTED"}
                            class="vote-progress-row"
                            role="listitem"
                        >
                            <strong>{player.displayName}</strong>
                            <span>
                                <i aria-hidden="true">{player.status === "VOTED" ? "✓" : "•"}</i>
                                {player.status === "VOTED"
                                    ? messages.neverHaveIEver.voted
                                    : messages.neverHaveIEver.pending}
                            </span>
                        </div>
                    {/each}
                </div>
            </AutoPageRegion>
        {:else}
            <div class="vote-progress-list" role="list">
                {#each voting.progress as player}
                    <div
                        class:voted={player.status === "VOTED"}
                        class="vote-progress-row"
                        role="listitem"
                    >
                        <strong>{player.displayName}</strong>
                        <span>
                            <i aria-hidden="true">{player.status === "VOTED" ? "✓" : "•"}</i>
                            {player.status === "VOTED"
                                ? messages.neverHaveIEver.voted
                                : messages.neverHaveIEver.pending}
                        </span>
                    </div>
                {/each}
            </div>
        {/if}
        {#if onVote && controllable.length}
            <div class="never-vote-controls">
                <h3>{messages.neverHaveIEver.yourAnswers}</h3>
                {#each controllable as player}
                    <div class="never-vote-row">
                        <strong>{player.displayName}</strong>
                        <div>
                            <button
                                class="secondary vote-choice"
                                disabled={busy}
                                on:click={() => onVote?.(player.playerId, "YES")}
                                >{messages.common.yes}</button
                            >
                            <button
                                class="secondary vote-choice"
                                disabled={busy}
                                on:click={() => onVote?.(player.playerId, "NO")}
                                >{messages.common.no}</button
                            >
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    {/if}
</section>
