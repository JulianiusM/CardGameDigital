<script lang="ts">
    import { onMount } from "svelte";
    import GroupBrowser from "./GroupBrowser.svelte";
    import { messages } from "./i18n";
    import {
        createGroup,
        deleteGroup,
        loadHostConfiguration,
        resetGroupHistory,
        updateGroup,
    } from "./multiplayer";
    import type { GroupSummary } from "../../../packages/protocol";
    import { dismissNotification, showNotification } from "./notifications";
    import UiIcon from "./UiIcon.svelte";
    import { announceGroupChange } from "./groupChanges";

    export let dataSpaceName: string;

    let groups: GroupSummary[] = [];
    let selectedId: string | null = null;
    let preferredProfileId = "PROFILE_FRIENDS";
    let editName = "";
    let editMembers = "";
    let createName = "";
    let createMembers = "";
    let pendingAction: "reset" | "delete" | null = null;
    let deleteConfirmation = "";
    let loading = true;
    let busy = false;

    $: selectedGroup = groups.find(({ id }) => id === selectedId) ?? null;

    onMount(async () => {
        try {
            const configuration = await loadHostConfiguration();
            groups = configuration.groups;
            preferredProfileId = configuration.settings.preferredProfileId;
            if (groups.length) selectGroup(groups[0]);
        } catch (cause) {
            showNotification(messageFor(cause), "error");
        } finally {
            loading = false;
        }
    });

    function messageFor(cause: unknown): string {
        return cause instanceof Error ? cause.message : messages.common.requestFailed;
    }

    function membersFrom(value: string): string[] {
        return value
            .split(",")
            .map((member) => member.trim())
            .filter(Boolean);
    }

    function sortGroups(next: GroupSummary[]): GroupSummary[] {
        return [...next].sort((left, right) => left.name.localeCompare(right.name));
    }

    function selectGroup(group: GroupSummary): void {
        selectedId = group.id;
        editName = group.name;
        editMembers = group.members.join(", ");
        pendingAction = null;
        deleteConfirmation = "";
    }

    async function perform(action: () => Promise<void>): Promise<void> {
        if (busy) return;
        busy = true;
        dismissNotification();
        try {
            await action();
        } catch (cause) {
            showNotification(messageFor(cause), "error");
        } finally {
            busy = false;
        }
    }

    function createSavedGroup(): Promise<void> {
        if (!createName.trim()) return Promise.resolve();
        return perform(async () => {
            const created = await createGroup(
                createName.trim(),
                membersFrom(createMembers),
                preferredProfileId,
            );
            groups = sortGroups([...groups, created]);
            announceGroupChange();
            selectGroup(created);
            createName = "";
            createMembers = "";
            showNotification(messages.account.groupCreated, "success");
        });
    }

    function saveSelectedGroup(): Promise<void> {
        if (!selectedGroup || !editName.trim()) return Promise.resolve();
        return perform(async () => {
            const updated = await updateGroup({
                ...selectedGroup,
                name: editName.trim(),
                members: membersFrom(editMembers),
            });
            groups = sortGroups(groups.map((group) => (group.id === updated.id ? updated : group)));
            announceGroupChange();
            selectGroup(updated);
            showNotification(messages.account.groupSaved, "success");
        });
    }

    function resetSelectedHistory(): Promise<void> {
        if (!selectedGroup) return Promise.resolve();
        return perform(async () => {
            const updated = await resetGroupHistory(selectedGroup.id);
            groups = groups.map((group) => (group.id === updated.id ? updated : group));
            announceGroupChange();
            selectGroup(updated);
            showNotification(messages.setup.historyReset, "success");
        });
    }

    function deleteSelectedGroup(): Promise<void> {
        if (!selectedGroup || deleteConfirmation !== selectedGroup.name) return Promise.resolve();
        const deletedId = selectedGroup.id;
        return perform(async () => {
            await deleteGroup(deletedId);
            groups = groups.filter(({ id }) => id !== deletedId);
            announceGroupChange();
            if (groups.length) selectGroup(groups[0]);
            else {
                selectedId = null;
                editName = "";
                editMembers = "";
                pendingAction = null;
                deleteConfirmation = "";
            }
            showNotification(messages.setup.groupDeleted, "success");
        });
    }
</script>

<div class="account-tab-panel group-management-panel" role="tabpanel">
    <section class="account-explainer">
        <span class="account-section-icon" aria-hidden="true"><UiIcon name="group" /></span>
        <div>
            <span class="eyebrow">{messages.account.groupsEyebrow}</span>
            <h2>{messages.account.groupsTitle}</h2>
            <p>{messages.account.groupsExplainer(dataSpaceName)}</p>
        </div>
    </section>

    <section class="settings-section-card account-section-card" aria-labelledby="group-list-title">
        <div class="account-section-heading">
            <div>
                <h2 id="group-list-title">{messages.account.manageGroups}</h2>
                <p>{messages.account.manageGroupsHint}</p>
            </div>
            <span class="account-count-badge">{groups.length}</span>
        </div>
        {#if loading}
            <div class="group-management-loading" aria-live="polite" aria-busy="true">
                <span aria-hidden="true"><UiIcon name="group" /></span>
                <strong>{messages.account.loadingGroups}</strong>
            </div>
        {:else if groups.length}
            <div class="group-management-workspace">
                <GroupBrowser {groups} {selectedId} onSelect={selectGroup} />
                {#if selectedGroup}
                    <div class="group-editor-card">
                        <header>
                            <span class="group-editor-symbol" aria-hidden="true"
                                ><UiIcon name="group" /></span
                            >
                            <div>
                                <span class="eyebrow">{messages.account.selectedGroup}</span>
                                <h3>{selectedGroup.name}</h3>
                            </div>
                        </header>
                        <form class="account-form" on:submit|preventDefault={saveSelectedGroup}>
                            <label class="account-field">
                                <span>{messages.setup.groupName}</span>
                                <input
                                    class="account-input"
                                    bind:value={editName}
                                    required
                                    maxlength="80"
                                />
                            </label>
                            <label class="account-field">
                                <span>{messages.setup.groupMembers}</span>
                                <textarea
                                    class="account-input group-members-input"
                                    bind:value={editMembers}
                                    rows="4"></textarea>
                                <small>{messages.account.groupMembersHint}</small>
                            </label>
                            <button class="primary" disabled={busy || !editName.trim()}
                                >{messages.account.saveGroupChanges}</button
                            >
                        </form>

                        <section
                            class="group-maintenance-actions"
                            aria-label={messages.account.groupMaintenance}
                        >
                            <div>
                                <strong>{messages.setup.resetHistory}</strong>
                                <small>{messages.account.resetHistoryHint}</small>
                                <button
                                    class="secondary"
                                    type="button"
                                    disabled={busy}
                                    on:click={() => {
                                        pendingAction = "reset";
                                        deleteConfirmation = "";
                                    }}>{messages.setup.resetHistory}</button
                                >
                            </div>
                            <div class="destructive">
                                <strong>{messages.setup.deleteGroup}</strong>
                                <small>{messages.account.deleteGroupHint}</small>
                                <button
                                    class="danger-outline"
                                    type="button"
                                    disabled={busy}
                                    on:click={() => {
                                        pendingAction = "delete";
                                        deleteConfirmation = "";
                                    }}>{messages.setup.deleteGroup}</button
                                >
                            </div>
                        </section>

                        {#if pendingAction === "reset"}
                            <div class="group-action-confirmation" role="alert">
                                <strong
                                    >{messages.account.resetHistoryTitle(
                                        selectedGroup.name,
                                    )}</strong
                                >
                                <p>{messages.account.resetHistoryWarning}</p>
                                <div class="account-inline-actions">
                                    <button
                                        class="secondary"
                                        type="button"
                                        disabled={busy}
                                        on:click={() => (pendingAction = null)}
                                        >{messages.common.cancel}</button
                                    >
                                    <button
                                        class="danger"
                                        type="button"
                                        disabled={busy}
                                        on:click={resetSelectedHistory}
                                        >{messages.account.resetHistoryFinal}</button
                                    >
                                </div>
                            </div>
                        {:else if pendingAction === "delete"}
                            <div class="group-action-confirmation destructive" role="alert">
                                <strong
                                    >{messages.account.deleteGroupTitle(selectedGroup.name)}</strong
                                >
                                <p>{messages.account.deleteGroupWarning}</p>
                                <label class="account-field">
                                    <span>{messages.account.typeGroupName(selectedGroup.name)}</span
                                    >
                                    <input
                                        class="account-input"
                                        bind:value={deleteConfirmation}
                                        autocomplete="off"
                                    />
                                </label>
                                <div class="account-inline-actions">
                                    <button
                                        class="secondary"
                                        type="button"
                                        disabled={busy}
                                        on:click={() => (pendingAction = null)}
                                        >{messages.common.cancel}</button
                                    >
                                    <button
                                        class="danger"
                                        type="button"
                                        disabled={busy || deleteConfirmation !== selectedGroup.name}
                                        on:click={deleteSelectedGroup}
                                        >{messages.account.deleteGroupFinal}</button
                                    >
                                </div>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        {:else}
            <div class="group-management-empty">
                <span aria-hidden="true"><UiIcon name="group" /></span>
                <strong>{messages.account.noGroups}</strong>
                <p>{messages.account.noGroupsHint}</p>
            </div>
        {/if}
    </section>

    <section
        class="settings-section-card account-section-card"
        aria-labelledby="create-group-title"
    >
        <div class="account-section-heading">
            <div>
                <h2 id="create-group-title">{messages.setup.createGroup}</h2>
                <p>{messages.account.createGroupHint}</p>
            </div>
            <span class="account-section-icon small" aria-hidden="true"><UiIcon name="add" /></span>
        </div>
        <form
            class="account-form account-group-create-form"
            on:submit|preventDefault={createSavedGroup}
        >
            <label class="account-field">
                <span>{messages.setup.groupName}</span>
                <input class="account-input" bind:value={createName} required maxlength="80" />
            </label>
            <label class="account-field">
                <span>{messages.setup.groupMembers}</span>
                <input class="account-input" bind:value={createMembers} />
                <small>{messages.account.groupMembersHint}</small>
            </label>
            <button class="primary" disabled={busy || !createName.trim()}
                >{messages.setup.saveGroup}</button
            >
        </form>
    </section>
</div>
