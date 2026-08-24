<script lang="ts">
    import { onMount } from "svelte";
    import GameSettingsEditor from "./GameSettingsEditor.svelte";
    import UiIcon from "./UiIcon.svelte";
    import { gameModes, messages } from "./i18n";
    import {
        createGroup,
        loadGameProfiles,
        loadCardLocales,
        loadHostConfiguration,
        resetGroupHistory,
        rooms,
        saveJoin,
        updateGroup,
        type GameProfileSummary,
        type GroupSummary,
        type RoomGameSettings,
        type CardLocaleSummary,
    } from "./multiplayer";
    import { presentation } from "./presentation";
    import { dismissNotification, showNotification } from "./notifications";
    import { navigate } from "./router";
    import {
        loadSetup,
        resetSetup,
        saveSetup,
        setupRoomSettings,
        type GameSetupState,
        type SetupIntent,
        type SetupStep,
    } from "./setup";

    const query = new URLSearchParams(location.search);
    let setup: GameSetupState = loadSetup();
    let screen: "menu" | "wizard" =
        query.has("setup") || query.has("room") || setup.intent !== null ? "wizard" : "menu";
    let groups: GroupSummary[] = [];
    let profiles: GameProfileSummary[] = [];
    let cardLocales: CardLocaleSummary[] = [];
    let groupsAvailable = false;
    let groupName = "";
    let groupMembers = "";
    let joinName = "";
    let roomCode = query.get("room")?.toUpperCase() ?? "";
    let busy = false;
    const hostSteps: SetupStep[] = ["group", "mode", "profile", "customize", "screen"];
    const modeIcons = ["classic", "random", "vote", "talk"];
    $: currentIndex = hostSteps.indexOf(setup.step);
    $: progressSteps = hostSteps.map((step) => messages.setup.stepLabels[step]);
    $: presentation.setScene(screen === "menu" ? "MENU" : "LOBBY");
    $: editorSettings = setupRoomSettings(setup);
    $: homePhaseKey = screen === "menu" ? "menu" : `${setup.intent ?? "setup"}:${setup.step}`;

    onMount(async () => {
        const requestedStep = query.get("setup") as SetupStep | null;
        if (requestedStep === "intent") {
            setup = resetSetup("intent");
            screen = "menu";
            navigate("/play/", { replace: true, force: true });
        } else if (requestedStep && hostSteps.includes(requestedStep) && setup.intent === "HOST") {
            setup = { ...setup, step: requestedStep };
            saveSetup(setup);
        } else if (requestedStep) {
            setup = resetSetup("intent");
            screen = "menu";
            navigate("/play/", { replace: true, force: true });
        }
        if (roomCode && !setup.intent) persist({ intent: "JOIN", step: "intent" });
        try {
            const [loadedProfiles, catalogLocales] = await Promise.all([
                loadGameProfiles(),
                loadCardLocales(),
            ]);
            profiles = loadedProfiles;
            cardLocales = catalogLocales.locales;
            if (!catalogLocales.locales.some(({ id }) => id === setup.cardLocale)) {
                persist({ cardLocale: catalogLocales.defaultLocale });
            }
            const configuration = await loadHostConfiguration();
            groups = configuration.groups;
            groupsAvailable = true;
        } catch {
            if (!profiles.length) profiles = await loadGameProfiles().catch(() => []);
            groupsAvailable = false;
        }
    });

    function persist(next: Partial<GameSetupState>): void {
        setup = { ...setup, ...next };
        saveSetup(setup);
    }
    function openIntent(intent: SetupIntent): void {
        setup = resetSetup(intent === "HOST" ? "group" : "intent");
        setup = { ...setup, intent };
        saveSetup(setup);
        screen = "wizard";
        presentation.playEffect("confirm");
    }
    function continueGroup(): void {
        setup = { ...resetSetup("group"), intent: "HOST", groupChoice: "SELECT" };
        saveSetup(setup);
        screen = "wizard";
        if (groups[0]) chooseGroup(groups[0]);
    }
    function chooseGroup(group: GroupSummary | null): void {
        persist({
            groupChoice: group ? "SELECT" : "NONE",
            groupId: group?.id ?? null,
            groupMembers: group?.members ?? [],
            profileId: group?.preferredProfileId ?? setup.profileId,
        });
        if (group?.preferredProfileId) {
            const profile = profiles.find(({ id }) => id === group.preferredProfileId);
            if (profile) chooseProfile(profile);
        }
    }
    function chooseProfile(profile: GameProfileSummary): void {
        persist({
            profileId: profile.id,
            adultContentConfirmed: false,
            enabledQuestionCategoryIds: [...profile.enabledQuestionCategoryIds],
            enabledDareTypeIds: [...profile.enabledDareTypeIds],
            blockedOperationalFlags: [...profile.blockedOperationalFlags],
            startingIntensity: profile.startingIntensity as GameSetupState["startingIntensity"],
            maximumIntensity: profile.maximumIntensity as GameSetupState["maximumIntensity"],
            intensityProgressionUnit: profile.intensityProgressionUnit,
            intensityProgressionInterval: profile.intensityProgressionInterval,
            intensityProgressionIncrement: profile.intensityProgressionIncrement,
            randomQuestionRatio: profile.randomQuestionRatio,
            maximumTypeStreak: profile.maximumTypeStreak,
            letsTalkMetaInterval: profile.letsTalkMetaInterval,
        });
    }
    function applyEditor(settings: RoomGameSettings): void {
        persist({
            mode: settings.mode,
            profileId: settings.profileId,
            adultContentConfirmed: settings.adultContentConfirmed,
            cardLocale: settings.cardLocale,
            neverHaveIEverRevealMode: settings.neverHaveIEverRevealMode,
            enabledQuestionCategoryIds: [...settings.configuration.enabledQuestionCategoryIds],
            enabledDareTypeIds: [...settings.configuration.enabledDareTypeIds],
            blockedOperationalFlags: [...settings.configuration.blockedOperationalFlags],
            startingIntensity: settings.configuration.startingIntensity,
            maximumIntensity: settings.configuration.maximumIntensity,
            intensityProgressionUnit: settings.configuration.intensityProgressionUnit,
            intensityProgressionInterval: settings.configuration.intensityProgressionInterval,
            intensityProgressionIncrement: settings.configuration.intensityProgressionIncrement,
            randomQuestionRatio: settings.configuration.randomQuestionRatio,
            maximumTypeStreak: settings.configuration.maximumTypeStreak,
            letsTalkMetaInterval: settings.configuration.letsTalkMetaInterval,
        });
    }
    async function refreshGroups(): Promise<void> {
        const configuration = await loadHostConfiguration();
        groups = configuration.groups;
        groupsAvailable = true;
    }
    async function createSavedGroup(): Promise<void> {
        if (!groupName.trim()) return;
        busy = true;
        dismissNotification();
        try {
            const created = await createGroup(
                groupName.trim(),
                groupMembers
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                setup.profileId,
            );
            await refreshGroups();
            chooseGroup(groups.find(({ id }) => id === created.id) ?? created);
            groupName = "";
            groupMembers = "";
        } catch (cause) {
            showNotification(
                cause instanceof Error ? cause.message : messages.common.requestFailed,
                "error",
            );
        } finally {
            busy = false;
        }
    }
    async function resetHistory(group: GroupSummary): Promise<void> {
        if (!confirm(messages.setup.resetHistoryConfirm)) return;
        const updated = await resetGroupHistory(group.id);
        groups = groups.map((candidate) => (candidate.id === updated.id ? updated : candidate));
        showNotification(messages.setup.historyReset, "success");
    }
    async function next(): Promise<void> {
        dismissNotification();
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
        if (setup.deviceMode === "couch") {
            navigate("/play/couch", { force: true });
            return;
        }
        if (!setup.hostName.trim()) return;
        busy = true;
        try {
            const persistence =
                setup.groupChoice === "SELECT" && setup.groupId ? "DATASPACE" : "EPHEMERAL";
            const join = await rooms.create(
                setup.hostName.trim(),
                persistence,
                setupRoomSettings(setup),
            );
            saveJoin(join);
            navigate("/play/room", { force: true });
        } catch (cause) {
            showNotification(
                cause instanceof Error ? cause.message : messages.common.connectionFailed,
                "error",
            );
        } finally {
            busy = false;
        }
    }
    function back(): void {
        const index = hostSteps.indexOf(setup.step);
        if (setup.intent === "HOST" && index > 0) persist({ step: hostSteps[index - 1] });
        else {
            setup = resetSetup("intent");
            screen = "menu";
        }
    }
    async function joinRoom(): Promise<void> {
        if (setup.intent !== "JOIN" && setup.intent !== "DISPLAY") return;
        busy = true;
        dismissNotification();
        try {
            const role = setup.intent === "DISPLAY" ? "DISPLAY" : "PLAYER";
            const displayName =
                role === "DISPLAY" ? joinName.trim() || messages.room.displayName : joinName.trim();
            const join = await rooms.join(roomCode.trim().toUpperCase(), displayName, role);
            saveJoin(join);
            navigate("/play/room", { force: true });
        } catch (cause) {
            showNotification(
                cause instanceof Error ? cause.message : messages.common.connectionFailed,
                "error",
            );
            busy = false;
        }
    }
</script>

<main class="home-shell">
    <header class="hero">
        <span class="spark" aria-hidden="true"><UiIcon name="spark" /></span><span class="eyebrow"
            >{messages.brand}</span
        >
        <h1>{messages.menu.title}</h1>
        <p>{messages.menu.subtitle}</p>
    </header>
    {#key homePhaseKey}
        <div class="home-phase-transition">
            {#if screen === "menu"}
                <nav class="main-menu entry-menu" aria-label={messages.menu.title}>
                    <button class="menu-tile primary-tile" on:click={() => openIntent("HOST")}
                        ><span class="tile-symbol" aria-hidden="true"><UiIcon name="host" /></span
                        ><strong>{messages.menu.hostGame}</strong><small
                            >{messages.setup.hostHint}</small
                        ></button
                    >
                    <button class="menu-tile" on:click={() => openIntent("JOIN")}
                        ><span class="tile-symbol" aria-hidden="true"><UiIcon name="join" /></span
                        ><strong>{messages.menu.joinGame}</strong><small
                            >{messages.setup.joinHint}</small
                        ></button
                    >
                    <button class="menu-tile" on:click={() => openIntent("DISPLAY")}
                        ><span class="tile-symbol" aria-hidden="true"
                            ><UiIcon name="display" /></span
                        ><strong>{messages.menu.displayOnly}</strong><small
                            >{messages.menu.displayOnlyHint}</small
                        ></button
                    >
                    {#if groups.length}<button
                            class="menu-tile continue-tile"
                            on:click={continueGroup}
                            ><span class="tile-symbol" aria-hidden="true"
                                ><UiIcon name="group" /></span
                            ><strong>{messages.menu.continueGroup}: {groups[0].name}</strong
                            ></button
                        >{/if}
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
                                    class:done={index < currentIndex}
                                    aria-label={label}><i></i><b>{label}</b></span
                                >{/each}
                        </div>
                    {/if}
                    <button class="text-action back-link" on:click={back}
                        >← {messages.setup.back}</button
                    >
                    {#if setup.intent === "JOIN" || setup.intent === "DISPLAY"}
                        <h2 id="wizard-title">
                            {setup.intent === "DISPLAY"
                                ? messages.setup.display
                                : messages.setup.join}
                        </h2>
                        <div class="join-form">
                            <label
                                >{messages.setup.joinName}<input
                                    bind:value={joinName}
                                    maxlength="40"
                                /></label
                            ><label
                                >{messages.setup.roomCode}<input
                                    bind:value={roomCode}
                                    maxlength="6"
                                /></label
                            ><button
                                class="primary"
                                disabled={busy ||
                                    (setup.intent === "JOIN" && !joinName.trim()) ||
                                    roomCode.trim().length !== 6}
                                on:click={joinRoom}>{messages.setup.joinAction}</button
                            >
                        </div>
                    {:else if setup.step === "group"}
                        <h2 id="wizard-title">{messages.setup.chooseGroup}</h2>
                        <div class="option-grid three group-choice-grid">
                            <button
                                class:selected={setup.groupChoice === "NONE"}
                                class="option-card"
                                on:click={() => chooseGroup(null)}
                                ><span class="option-symbol"><UiIcon name="quick" /></span><strong
                                    >{messages.setup.noGroup}</strong
                                ><small>{messages.setup.quickGroupHint}</small></button
                            >
                            <button
                                class:selected={setup.groupChoice === "SELECT"}
                                class="option-card"
                                on:click={() => persist({ groupChoice: "SELECT" })}
                                ><span class="option-symbol"><UiIcon name="group" /></span><strong
                                    >{messages.setup.selectGroup}</strong
                                ><small>{messages.setup.selectGroupHint}</small></button
                            >
                            <button
                                class:selected={setup.groupChoice === "NEW"}
                                class="option-card"
                                on:click={() => persist({ groupChoice: "NEW", groupId: null })}
                                ><span class="option-symbol"><UiIcon name="add" /></span><strong
                                    >{messages.setup.newGroup}</strong
                                ><small>{messages.setup.newGroupHint}</small></button
                            >
                        </div>
                        {#if setup.groupChoice === "SELECT"}<div class="group-list" role="list">
                                {#each groups as group}<div
                                        class:selected={setup.groupId === group.id}
                                        class="group-list-row"
                                        role="listitem"
                                    >
                                        <button
                                            class="group-select-action text-button"
                                            aria-pressed={setup.groupId === group.id}
                                            on:click={() => chooseGroup(group)}
                                            ><strong>{group.name}</strong><small
                                                >{group.members.join(", ")}</small
                                            ></button
                                        ><button
                                            class="text-action"
                                            on:click={() => resetHistory(group)}
                                            >{messages.setup.resetHistory}</button
                                        >
                                    </div>{/each}
                            </div>
                        {:else if setup.groupChoice === "NEW" && groupsAvailable}<div
                                class="group-create settings-section-card"
                            >
                                <h3>{messages.setup.createGroup}</h3>
                                <label
                                    >{messages.setup.groupName}<input
                                        bind:value={groupName}
                                        maxlength="80"
                                    /></label
                                ><label
                                    >{messages.setup.groupMembers}<input
                                        bind:value={groupMembers}
                                    /></label
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
                                    ><span class="option-symbol"
                                        ><UiIcon name={modeIcons[index]} /></span
                                    ><strong>{item[1]}</strong><small>{item[2]}</small></button
                                >{/each}
                        </div>
                    {:else if setup.step === "profile"}
                        <h2 id="wizard-title">{messages.setup.chooseProfile}</h2>
                        <div class="option-grid profiles">
                            {#each profiles as profile}<button
                                    class:selected={setup.profileId === profile.id}
                                    class="option-card"
                                    on:click={() => chooseProfile(profile)}
                                    ><strong>{profile.name}</strong><small
                                        >{profile.description}</small
                                    ></button
                                >{/each}
                        </div>
                        {#if profiles.find(({ id }) => id === setup.profileId)?.requiresAdultConfirmation}<label
                                class="adult-confirmation wizard-confirmation"
                                ><input
                                    type="checkbox"
                                    checked={setup.adultContentConfirmed}
                                    on:change={(event) =>
                                        persist({
                                            adultContentConfirmed: event.currentTarget.checked,
                                        })}
                                />{messages.room.adultConfirmation}</label
                            >{/if}
                    {:else if setup.step === "customize"}
                        <div class="wizard-title-row">
                            <h2 id="wizard-title">{messages.setup.customizeExperience}</h2>
                            {#if setup.profileId !== "PROFILE_CUSTOM"}<button
                                    class="primary primary-action wizard-skip"
                                    disabled={busy}
                                    on:click={next}>{messages.common.skip}<span>→</span></button
                                >{/if}
                        </div>
                        <GameSettingsEditor
                            settings={editorSettings}
                            {profiles}
                            {cardLocales}
                            showMode={false}
                            showProfile={false}
                            onChange={applyEditor}
                        />
                    {:else if setup.step === "screen"}
                        <h2 id="wizard-title">{messages.setup.chooseScreen}</h2>
                        <div class="option-grid three">
                            {#each messages.setup.deviceOptions as item}<button
                                    class:selected={setup.deviceMode === item[0]}
                                    class="option-card"
                                    on:click={() => persist({ deviceMode: item[0] })}
                                    ><span class="option-symbol"><UiIcon name={item[1]} /></span
                                    ><strong>{item[2]}</strong><small>{item[3]}</small></button
                                >{/each}
                        </div>
                        {#if setup.deviceMode !== "couch"}<label class="host-name-field"
                                >{messages.setup.hostName}<input
                                    bind:value={setup.hostName}
                                    on:input={() => saveSetup(setup)}
                                    maxlength="40"
                                /></label
                            >{/if}
                    {/if}
                    {#if setup.intent === "HOST"}<button
                            class="primary primary-action wizard-next"
                            disabled={busy ||
                                (setup.step === "group" &&
                                    setup.groupChoice === "SELECT" &&
                                    !setup.groupId) ||
                                (setup.step === "group" && setup.groupChoice === "NEW") ||
                                (setup.step === "screen" &&
                                    setup.deviceMode !== "couch" &&
                                    !setup.hostName.trim()) ||
                                (setup.step === "profile" &&
                                    profiles.find(({ id }) => id === setup.profileId)
                                        ?.requiresAdultConfirmation &&
                                    !setup.adultContentConfirmed)}
                            on:click={next}
                            >{setup.step === "screen"
                                ? messages.setup.continue
                                : messages.common.next}<span>→</span></button
                        >{/if}
                </section>
            {/if}
        </div>
    {/key}
</main>
