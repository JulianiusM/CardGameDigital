<script lang="ts">
    import { onMount } from "svelte";
    import { messages, gameModes } from "./i18n";
    import { presentation } from "./presentation";
    import {
        createGroup,
        loadHostConfiguration,
        rooms,
        saveJoin,
        updateGroup,
        resetGroupHistory,
        type GroupSummary,
    } from "./multiplayer";
    import { loadSetup, resetSetup, saveSetup, type GameSetupState, type SetupStep } from "./setup";

    const hostSteps: SetupStep[] = ["group", "mode", "profile", "customize", "screen"];
    let screen: "menu" | "wizard" = new URLSearchParams(location.search).has("setup")
        ? "wizard"
        : "menu";
    let setup: GameSetupState = loadSetup();
    let groups: GroupSummary[] = [];
    let groupsAvailable = false;
    let groupName = "";
    let groupMembers = "";
    let joinName = "";
    let roomCode = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
    let error = "";
    let notice = "";
    let busy = false;
    $: currentIndex = hostSteps.indexOf(setup.step);
    $: progressSteps = [
        messages.setup.group,
        messages.setup.mode,
        messages.setup.profile,
        messages.setup.customize,
        messages.setup.screen,
    ];
    $: presentation.setScene(screen === "menu" ? "MENU" : "LOBBY");

    onMount(async () => {
        const requestedStep = new URLSearchParams(location.search).get("setup") as SetupStep | null;
        if (requestedStep && ["intent", ...hostSteps].includes(requestedStep)) {
            setup = { ...setup, step: requestedStep };
            saveSetup(setup);
        }
        try {
            const configuration = await loadHostConfiguration();
            groups = configuration.groups;
            groupsAvailable = true;
            if (setup.groupId === null && configuration.settings.defaultGroupId)
                setup.groupId = configuration.settings.defaultGroupId;
            saveSetup(setup);
        } catch {
            groupsAvailable = false;
        }
    });

    function persist(next: Partial<GameSetupState>): void {
        setup = { ...setup, ...next };
        saveSetup(setup);
    }
    function startNew(): void {
        setup = resetSetup("intent");
        screen = "wizard";
    }
    function continueGroup(): void {
        setup = { ...resetSetup("group"), intent: "HOST" };
        saveSetup(setup);
        screen = "wizard";
    }
    function chooseIntent(intent: "HOST" | "JOIN"): void {
        persist({ intent, step: intent === "HOST" ? "group" : "intent" });
        presentation.playEffect("confirm");
    }
    function chooseGroup(group: GroupSummary | null): void {
        persist({
            groupId: group?.id ?? null,
            groupMembers: group?.members ?? [],
            profileId: group?.preferredProfileId ?? setup.profileId,
        });
    }
    async function createSavedGroup(): Promise<void> {
        if (!groupName.trim()) return;
        busy = true;
        error = "";
        try {
            const created = await createGroup(
                groupName.trim(),
                groupMembers
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                setup.profileId,
            );
            groups = [...groups, created].sort((a, b) => a.name.localeCompare(b.name));
            chooseGroup(created);
            groupName = "";
            groupMembers = "";
        } catch (cause) {
            error = cause instanceof Error ? cause.message : messages.common.requestFailed;
        } finally {
            busy = false;
        }
    }
    async function resetHistory(group: GroupSummary): Promise<void> {
        if (!confirm(messages.setup.resetHistoryConfirm)) return;
        const updated = await resetGroupHistory(group.id);
        groups = groups.map((candidate) => (candidate.id === updated.id ? updated : candidate));
        notice = messages.setup.historyReset;
    }
    async function next(): Promise<void> {
        const index = hostSteps.indexOf(setup.step);
        if (setup.step === "profile" && setup.groupId) {
            const group = groups.find(({ id }) => id === setup.groupId);
            if (group && group.preferredProfileId !== setup.profileId) {
                const updated = await updateGroup({
                    ...group,
                    preferredProfileId: setup.profileId,
                });
                groups = groups.map((candidate) =>
                    candidate.id === updated.id ? updated : candidate,
                );
            }
        }
        if (index < hostSteps.length - 1) {
            persist({ step: hostSteps[index + 1] });
            presentation.playEffect("turn");
            return;
        }
        saveSetup(setup);
        location.href = setup.deviceMode === "couch" ? "/play/couch" : "/play/host";
    }
    function back(): void {
        if (setup.intent === "JOIN") {
            persist({ intent: null });
            return;
        }
        const index = hostSteps.indexOf(setup.step);
        if (index > 0) persist({ step: hostSteps[index - 1] });
        else if (setup.step !== "intent") persist({ step: "intent", intent: null });
        else screen = "menu";
    }
    async function joinRoom(): Promise<void> {
        busy = true;
        error = "";
        try {
            const join = await rooms.join(roomCode.trim().toUpperCase(), joinName.trim(), "PLAYER");
            saveJoin(join);
            location.href = `/play/mobile?room=${join.roomCode}`;
        } catch (cause) {
            error = cause instanceof Error ? cause.message : messages.common.connectionFailed;
            busy = false;
        }
    }
</script>

<main class="home-shell">
    <header class="hero">
        <span class="spark" aria-hidden="true">✦</span>
        <span class="eyebrow">{messages.brand}</span>
        <h1>{messages.menu.title}</h1>
        <p>{messages.menu.subtitle}</p>
    </header>
    {#if screen === "menu"}
        <nav class="main-menu" aria-label={messages.menu.title}>
            <button class="menu-tile primary-tile" on:click={startNew}>
                <span class="tile-symbol" aria-hidden="true">↗</span>
                <strong>{messages.menu.newGame}</strong><small>{messages.menu.newGameHint}</small>
            </button>
            <button class="menu-tile" on:click={continueGroup}>
                <span aria-hidden="true">◎</span><strong>{messages.menu.continueGroup}</strong>
            </button>
            <button class="menu-tile" disabled>
                <span aria-hidden="true">◇</span><strong>{messages.menu.profiles}</strong><small
                    >{messages.menu.comingSoon}</small
                >
            </button>
        </nav>
    {:else}
        <section class="wizard card-panel" aria-labelledby="wizard-title">
            {#if setup.intent === "HOST" && currentIndex >= 0}
                <div
                    class="wizard-progress"
                    aria-label={messages.setup.progress(currentIndex + 1, hostSteps.length)}
                >
                    {#each progressSteps as label, index}<span
                            class:current={index === currentIndex}
                            class:done={index < currentIndex}><i></i>{label}</span
                        >{/each}
                </div>
            {/if}
            <button class="text-action back-link" on:click={back}>← {messages.setup.back}</button>
            {#if error}<p class="error" role="alert">{error}</p>{/if}
            {#if notice}<p class="notice" role="status">{notice}</p>{/if}
            {#if !setup.intent}
                <h2 id="wizard-title">{messages.setup.chooseIntent}</h2>
                <div class="option-grid">
                    <button class="option-card" on:click={() => chooseIntent("HOST")}
                        ><span class="option-symbol">⌂</span><strong>{messages.setup.host}</strong
                        ><small>{messages.setup.hostHint}</small></button
                    >
                    <button class="option-card" on:click={() => chooseIntent("JOIN")}
                        ><span class="option-symbol">→</span><strong>{messages.setup.join}</strong
                        ><small>{messages.setup.joinHint}</small></button
                    >
                </div>
            {:else if setup.intent === "JOIN"}
                <h2 id="wizard-title">{messages.setup.join}</h2>
                <div class="join-form">
                    <label
                        >{messages.setup.joinName}<input
                            bind:value={joinName}
                            maxlength="40"
                        /></label
                    >
                    <label
                        >{messages.setup.roomCode}<input
                            bind:value={roomCode}
                            maxlength="6"
                        /></label
                    >
                    <button
                        class="primary"
                        disabled={busy || !joinName.trim() || roomCode.trim().length !== 6}
                        on:click={joinRoom}>{messages.setup.joinAction}</button
                    >
                </div>
            {:else if setup.step === "group"}
                <h2 id="wizard-title">{messages.setup.chooseGroup}</h2>
                <div class="option-grid group-grid">
                    <button
                        class:selected={setup.groupId === null}
                        class="option-card"
                        on:click={() => chooseGroup(null)}
                        ><span class="option-symbol">⚡</span><strong
                            >{messages.setup.quickGroup}</strong
                        ><small>{messages.setup.quickGroupHint}</small></button
                    >
                    {#each groups as group}
                        <div class:selected={setup.groupId === group.id} class="group-option">
                            <button class="option-card" on:click={() => chooseGroup(group)}
                                ><span class="option-symbol">◎</span><strong>{group.name}</strong
                                ><small>{group.members.join(", ")}</small></button
                            >
                            <button class="text-action" on:click={() => resetHistory(group)}
                                >{messages.setup.resetHistory}</button
                            >
                        </div>
                    {/each}
                </div>
                {#if groupsAvailable}<div class="group-create">
                        <h3>{messages.setup.createGroup}</h3>
                        <label
                            >{messages.setup.groupName}<input
                                bind:value={groupName}
                                maxlength="80"
                            /></label
                        ><label
                            >{messages.setup.groupMembers}<input bind:value={groupMembers} /></label
                        ><button
                            class="secondary"
                            disabled={busy || !groupName.trim()}
                            on:click={createSavedGroup}>{messages.setup.saveGroup}</button
                        >
                    </div>{/if}
            {:else if setup.step === "mode"}
                <h2 id="wizard-title">{messages.setup.chooseMode}</h2>
                <div class="option-grid">
                    {#each gameModes as item, index}<button
                            class:selected={setup.mode === item[0]}
                            class="option-card"
                            on:click={() => persist({ mode: item[0] })}
                            ><span class="option-symbol">{["?", "↝", "✋", "◌"][index]}</span
                            ><strong>{item[1]}</strong><small>{item[2]}</small></button
                        >{/each}
                </div>
            {:else if setup.step === "profile"}
                <h2 id="wizard-title">{messages.setup.chooseProfile}</h2>
                <div class="option-grid profiles">
                    {#each messages.setup.profiles as item}<button
                            class:selected={setup.profileId === item[0]}
                            class="option-card"
                            on:click={() => persist({ profileId: item[0] })}
                            ><strong>{item[1]}</strong><small>{item[2]}</small></button
                        >{/each}
                </div>
                {#if setup.profileId === "PROFILE_COUPLES_SPICY"}<label
                        class="adult-confirmation wizard-confirmation"
                        ><input
                            type="checkbox"
                            checked={setup.adultContentConfirmed}
                            on:change={(event) =>
                                persist({ adultContentConfirmed: event.currentTarget.checked })}
                        />{messages.room.adultConfirmation}</label
                    >{/if}
            {:else if setup.step === "customize"}
                <h2 id="wizard-title">{messages.setup.customizeExperience}</h2>
                <div class="section-grid">
                    <label class="setting-row"
                        ><span
                            ><strong>{messages.room.maximumIntensity}</strong><small
                                >{setup.maximumIntensity} / 5</small
                            ></span
                        ><input
                            type="range"
                            min="1"
                            max="5"
                            value={setup.maximumIntensity}
                            on:input={(event) =>
                                persist({
                                    maximumIntensity: Number(
                                        event.currentTarget.value,
                                    ) as GameSetupState["maximumIntensity"],
                                })}
                        /></label
                    >{#if setup.mode === "RANDOM_TRUTH_OR_DARE"}<label class="setting-row"
                            ><span
                                ><strong>{messages.room.questionRatio}</strong><small
                                    >{Math.round(setup.randomQuestionRatio * 100)}%</small
                                ></span
                            ><input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={setup.randomQuestionRatio}
                                on:input={(event) =>
                                    persist({
                                        randomQuestionRatio: Number(event.currentTarget.value),
                                    })}
                            /></label
                        >{/if}
                </div>
            {:else if setup.step === "screen"}
                <h2 id="wizard-title">{messages.setup.chooseScreen}</h2>
                <div class="option-grid three">
                    {#each messages.setup.deviceOptions as item}<button
                            class:selected={setup.deviceMode === item[0]}
                            class="option-card"
                            on:click={() => persist({ deviceMode: item[0] })}
                            ><span class="option-symbol">{item[1]}</span><strong>{item[2]}</strong
                            ><small>{item[3]}</small></button
                        >{/each}
                </div>
            {/if}
            {#if setup.intent === "HOST"}<button
                    class="primary wizard-next"
                    disabled={setup.step === "profile" &&
                        setup.profileId === "PROFILE_COUPLES_SPICY" &&
                        !setup.adultContentConfirmed}
                    on:click={next}
                    >{setup.step === "screen" ? messages.setup.continue : messages.common.next}
                    <span>→</span></button
                >{/if}
        </section>
    {/if}
</main>
