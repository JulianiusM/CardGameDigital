<script lang="ts">
    import { locale, messages } from "./i18n";
    import type { GroupSummary } from "../../../packages/protocol";
    import UiIcon from "./UiIcon.svelte";

    export let groups: readonly GroupSummary[];
    export let selectedId: string | null = null;
    export let onSelect: (group: GroupSummary) => void;
    export let pageSize = 16;

    let query = "";
    let page = 0;
    let lastRevealedSelection: string | null = null;

    $: normalizedQuery = query.trim().toLocaleLowerCase(locale);
    $: matchingGroups = groups.filter((group) => {
        if (!normalizedQuery) return true;
        return [group.name, ...group.members].some((value) =>
            value.toLocaleLowerCase(locale).includes(normalizedQuery),
        );
    });
    $: pageCount = Math.max(1, Math.ceil(matchingGroups.length / pageSize));
    $: if (page >= pageCount) page = pageCount - 1;
    $: pageStart = page * pageSize;
    $: visibleGroups = matchingGroups.slice(pageStart, pageStart + pageSize);
    $: if (
        !normalizedQuery &&
        selectedId &&
        selectedId !== lastRevealedSelection &&
        matchingGroups.some(({ id }) => id === selectedId)
    ) {
        page = Math.floor(matchingGroups.findIndex(({ id }) => id === selectedId) / pageSize);
        lastRevealedSelection = selectedId;
    }

    function memberPreview(group: GroupSummary): string {
        if (!group.members.length) return messages.account.groupHasNoMembers;
        const preview = group.members.slice(0, 3).join(", ");
        if (group.members.length <= 3) return preview;
        return `${preview} · +${group.members.length - 3}`;
    }
</script>

<div class="group-browser">
    <label class="group-browser-search">
        <span>{messages.account.searchGroups}</span>
        <span class="group-search-control">
            <span aria-hidden="true"><UiIcon name="group" /></span>
            <input
                type="search"
                bind:value={query}
                placeholder={messages.account.searchGroupsPlaceholder}
                on:input={() => (page = 0)}
            />
        </span>
    </label>
    <div class="group-browser-summary" aria-live="polite">
        <span>{messages.account.groupResults(matchingGroups.length)}</span>
        {#if matchingGroups.length}
            <small
                >{messages.account.groupResultRange(
                    pageStart + 1,
                    Math.min(pageStart + pageSize, matchingGroups.length),
                )}</small
            >
        {/if}
    </div>
    <div
        class="group-browser-list group-list"
        role="listbox"
        aria-label={messages.account.groupList}
    >
        {#each visibleGroups as group (group.id)}
            <button
                class:selected={selectedId === group.id}
                class="group-browser-row group-list-row text-button"
                type="button"
                role="option"
                aria-selected={selectedId === group.id}
                on:click={() => onSelect(group)}
            >
                <span class="group-browser-symbol" aria-hidden="true"><UiIcon name="group" /></span>
                <span class="group-browser-copy">
                    <strong>{group.name}</strong>
                    <small>{memberPreview(group)}</small>
                </span>
                <span
                    class="group-browser-member-count"
                    aria-label={messages.account.groupMembersCount(group.members.length)}
                    >{group.members.length}</span
                >
            </button>
        {:else}
            <div class="group-browser-empty" role="status">
                <span aria-hidden="true"><UiIcon name="group" /></span>
                <strong>{messages.account.noMatchingGroups}</strong>
                <small>{messages.account.noMatchingGroupsHint}</small>
            </div>
        {/each}
    </div>
    {#if pageCount > 1}
        <nav class="group-browser-pagination" aria-label={messages.account.groupPages}>
            <button
                class="secondary"
                type="button"
                disabled={page === 0}
                on:click={() => (page -= 1)}>‹ {messages.common.previous}</button
            >
            <span>{page + 1} / {pageCount}</span>
            <button
                class="secondary"
                type="button"
                disabled={page === pageCount - 1}
                on:click={() => (page += 1)}>{messages.common.next} ›</button
            >
        </nav>
    {/if}
</div>
