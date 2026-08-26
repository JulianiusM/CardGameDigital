<script lang="ts">
    import { onMount } from "svelte";
    import GameSettingsEditor from "./GameSettingsEditor.svelte";
    import UiIcon from "./UiIcon.svelte";
    import LegalLinks from "./LegalLinks.svelte";
    import GroupBrowser from "./GroupBrowser.svelte";
    import { gameModes, locale, messages } from "./i18n";
    import {
        createGroup,
        loadGameProfiles,
        loadCardLocales,
        loadHostConfiguration,
        rooms,
        saveGameSettings,
        saveJoin,
        updateGroup,
        type GameProfileSummary,
        type GroupSummary,
        type RoomGameSettings,
        type CardLocaleSummary,
        type CardLanguageSettings,
        type GameSettings,
    } from "./multiplayer";
    import { authentication, refreshAuthentication } from "./authentication";
    import { presentation } from "./presentation";
    import { dismissNotification, showNotification } from "./notifications";
    import { navigate } from "./router";
    import {
        loadSetup,
        applyCardLanguageSettings,
        applyGameProfile,
        resetSetup,
        repairUnavailableGameProfile,
        saveSetup,
        setupConfiguration,
        setupRoomSettings,
        type GameSetupState,
        type SetupIntent,
        type SetupStep,
    } from "./setup";
    import {
        loadLanguagePreferences,
        matchSupportedLanguage,
        updateLocalLanguagePreferences,
    } from "./languagePreferences";
    import { accountApi } from "./accountApi";
    import { setAuthenticatedAccount } from "./authentication";
    import { announceGroupChange, subscribeToGroupChanges } from "./groupChanges";
    import EligibleCardPreview from "./EligibleCardPreview.svelte";

    const query = new URLSearchParams(location.search);
    let setup: GameSetupState = loadSetup();
    let screen: "menu" | "wizard" =
        query.has("setup") || query.has("room") || setup.intent !== null ? "wizard" : "menu";
    let groups: GroupSummary[] = [];
    let profiles: GameProfileSummary[] = [];
    let cardLocales: CardLocaleSummary[] = [];
    let defaultCardLocale = "";
    let groupsAvailable = false;
    let authenticationLoaded = false;
    let authenticationResolved = false;
    let savedGameSettings: GameSettings | null = null;
    let activeDataSpace: { id: string; name: string } | null = null;
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
    $: eligiblePreviewPlayerCount = Math.max(
        2,
        setup.groupMembers.filter((name) => name.trim()).length,
    );
    $: dataSpaceRelevant = Boolean(
        activeDataSpace && (screen === "menu" || setup.intent === "HOST"),
    );
    $: homePhaseKey = screen === "menu" ? "menu" : `${setup.intent ?? "setup"}:${setup.step}`;
    $: persistenceAvailable =
        authenticationResolved &&
        ($authentication.deploymentMode === "local" || $authentication.authenticated);
    $: continueGroupTarget =
        groups.find(({ id }) => id === savedGameSettings?.defaultGroupId) ?? groups[0];

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
            const [loadedProfiles, catalogLocales, authStatus] = await Promise.all([
                loadGameProfiles(),
                loadCardLocales(),
                refreshAuthentication(),
            ]);
            authenticationLoaded = true;
            authenticationResolved = true;
            profiles = loadedProfiles;
            const repairedSetup = repairUnavailableGameProfile(setup, profiles);
            if (repairedSetup !== setup) {
                setup = repairedSetup;
                saveSetup(setup);
            }
            cardLocales = catalogLocales.locales;
            defaultCardLocale = catalogLocales.defaultLocale;
            if (!catalogLocales.locales.some(({ id }) => id === setup.cardLocale)) {
                const preferences = loadLanguagePreferences();
                const preferred = preferences.cardLocale
                    ? [preferences.cardLocale]
                    : [locale, ...preferences.fallbackLocales];
                const cardLocale = matchSupportedLanguage(
                    preferred,
                    catalogLocales.locales.map(({ id }) => id),
                    catalogLocales.defaultLocale,
                );
                persist({
                    cardLocale,
                    cardFallbackLocales: setup.cardFallbackLocales.filter(
                        (entry) =>
                            entry !== cardLocale &&
                            catalogLocales.locales.some(({ id }) => id === entry),
                    ),
                });
            }
            if (authStatus.deploymentMode === "local" || authStatus.authenticated) {
                const configuration = await loadHostConfiguration();
                groups = configuration.groups;
                savedGameSettings = configuration.settings;
                activeDataSpace = configuration.dataSpace;
                groupsAvailable = true;
                if (!groups.length && setup.groupChoice === "SELECT") chooseGroup(null);
            }
            const accountName = authStatus.account?.user.name.trim();
            if (accountName) {
                joinName = accountName;
                if (!setup.hostName.trim()) persist({ hostName: accountName });
            }
        } catch {
            authenticationLoaded = true;
            if (!profiles.length) profiles = await loadGameProfiles().catch(() => []);
            groupsAvailable = false;
            showNotification(messages.common.connectionFailed, "error");
        }
    });
    onMount(() =>
        subscribeToGroupChanges(() => {
            if (!persistenceAvailable) return;
            void refreshGroups().catch((cause) =>
                showNotification(
                    cause instanceof Error ? cause.message : messages.common.connectionFailed,
                    "error",
                ),
            );
        }),
    );

    function persist(next: Partial<GameSetupState>): void {
        setup = { ...setup, ...next };
        saveSetup(setup);
    }
    function withPreferredCardLanguage(state: GameSetupState): GameSetupState {
        if (!cardLocales.length) return state;
        const preferences = loadLanguagePreferences();
        const candidates = preferences.cardLocale
            ? [preferences.cardLocale]
            : [locale, ...preferences.fallbackLocales];
        const cardLocale = matchSupportedLanguage(
            candidates,
            cardLocales.map(({ id }) => id),
            defaultCardLocale,
        );
        return {
            ...state,
            cardLocale,
            cardFallbackLocales: preferences.fallbackLocales.filter(
                (entry) => entry !== cardLocale && cardLocales.some(({ id }) => id === entry),
            ),
        };
    }
    function openIntent(intent: SetupIntent): void {
        const reset = withPreferredCardLanguage(resetSetup(intent === "HOST" ? "group" : "intent"));
        setup = intent === "HOST" ? applySavedDefaults(reset) : reset;
        const accountName = $authentication.account?.user.name.trim() ?? "";
        setup = {
            ...setup,
            intent,
            hostName: intent === "HOST" ? accountName : setup.hostName,
            groupChoice: "NONE",
            groupId: null,
            groupMembers: [],
        };
        saveSetup(setup);
        if (intent === "JOIN" && accountName) joinName = accountName;
        screen = "wizard";
        presentation.playEffect("confirm");
    }
    function continueGroup(): void {
        setup = {
            ...applySavedDefaults(withPreferredCardLanguage(resetSetup("group"))),
            intent: "HOST",
            groupChoice: "SELECT",
        };
        saveSetup(setup);
        screen = "wizard";
        const preferred = groups.find(({ id }) => id === setup.groupId) ?? continueGroupTarget;
        if (preferred) chooseGroup(preferred);
    }
    function chooseGroup(group: GroupSummary | null): void {
        let next: GameSetupState = {
            ...setup,
            groupChoice: group ? "SELECT" : "NONE",
            groupId: group?.id ?? null,
            groupMembers: group?.members ?? [],
            profileId: group?.preferredProfileId ?? setup.profileId,
        };
        const profile = profiles.find(({ id }) => id === next.profileId);
        if (profile) {
            const customConfiguration = customConfigurationFor(profile, group);
            next = applyGameProfile(next, profile, customConfiguration);
        } else next = repairUnavailableGameProfile(next, profiles);
        next = group?.cardLanguageSettings
            ? applyAvailableCardLanguageSettings(next, group.cardLanguageSettings)
            : quickRoundCardLanguageSettings(next);
        setup = next;
        saveSetup(setup);
    }
    function chooseProfile(profile: GameProfileSummary): void {
        const group = groups.find(({ id }) => id === setup.groupId);
        setup = applyGameProfile(setup, profile, customConfigurationFor(profile, group));
        saveSetup(setup);
    }
    function customConfigurationFor(
        profile: GameProfileSummary,
        group: GroupSummary | undefined | null,
    ) {
        if (profile.id !== "PROFILE_CUSTOM") return undefined;
        if (group) return group.customConfiguration ?? undefined;
        return savedGameSettings?.customConfiguration;
    }
    function quickRoundCardLanguageSettings(state: GameSetupState): GameSetupState {
        const saved = savedGameSettings?.cardLanguageSettings;
        if (saved) return applyAvailableCardLanguageSettings(state, saved);
        return preferredCardLanguageSettings(state);
    }
    function preferredCardLanguageSettings(state: GameSetupState): GameSetupState {
        return { ...withPreferredCardLanguage(state), cardFallbackEnabled: false };
    }
    function applyAvailableCardLanguageSettings(
        state: GameSetupState,
        saved: CardLanguageSettings,
    ): GameSetupState {
        const available = new Set(cardLocales.map(({ id }) => id));
        if (!available.has(saved.cardLocale)) return preferredCardLanguageSettings(state);
        const cardFallbackLocales = saved.cardFallbackLocales.filter(
            (entry) => entry !== saved.cardLocale && available.has(entry),
        );
        return applyCardLanguageSettings(state, {
            cardLocale: saved.cardLocale,
            cardFallbackEnabled: saved.cardFallbackEnabled && cardFallbackLocales.length > 0,
            cardFallbackLocales,
        });
    }
    function applyEditor(settings: RoomGameSettings): void {
        persist({
            mode: settings.mode,
            profileId: settings.profileId,
            adultContentConfirmed: settings.adultContentConfirmed,
            cardLocale: settings.cardLocale,
            cardFallbackEnabled: settings.cardFallbackEnabled,
            cardFallbackLocales: [...settings.cardFallbackLocales],
            neverHaveIEverRevealMode: settings.neverHaveIEverRevealMode,
            cardPolicy: structuredClone(settings.cardPolicy),
            enabledQuestionCategoryIds: [...settings.configuration.enabledQuestionCategoryIds],
            enabledDareTypeIds: [...settings.configuration.enabledDareTypeIds],
            blockedOperationalFlags: [...settings.configuration.blockedOperationalFlags],
            maximumSocialSensitivity: settings.configuration.maximumSocialSensitivity,
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
    function rememberCardLocale(cardLocale: string): void {
        if (setup.groupChoice === "SELECT" && setup.groupId) return;
        updateLocalLanguagePreferences({ cardLocale });
        if (!$authentication.authenticated) return;
        void accountApi
            .updateLanguagePreferences({ cardLocale })
            .then((account) => setAuthenticatedAccount($authentication, account))
            .catch((cause) =>
                showNotification(
                    cause instanceof Error ? cause.message : messages.common.requestFailed,
                    "error",
                ),
            );
    }
    async function refreshGroups(): Promise<void> {
        const configuration = await loadHostConfiguration();
        groups = configuration.groups;
        savedGameSettings = configuration.settings;
        activeDataSpace = configuration.dataSpace;
        groupsAvailable = true;
        if (setup.groupChoice !== "SELECT") return;
        const selected = groups.find(({ id }) => id === setup.groupId);
        if (!selected) chooseGroup(null);
        else persist({ groupMembers: [...selected.members] });
    }
    function applySavedDefaults(state: GameSetupState): GameSetupState {
        if (!savedGameSettings) return state;
        const profile = profiles.find(({ id }) => id === savedGameSettings?.preferredProfileId);
        const fromProfile = profile
            ? applyGameProfile(
                  state,
                  profile,
                  profile.id === "PROFILE_CUSTOM"
                      ? savedGameSettings.customConfiguration
                      : undefined,
              )
            : state;
        const defaultGroup = groups.find(({ id }) => id === savedGameSettings?.defaultGroupId);
        const selectedGroup = {
            ...fromProfile,
            groupChoice: defaultGroup ? "SELECT" : "NONE",
            groupId: defaultGroup?.id ?? null,
            groupMembers: defaultGroup?.members ?? [],
        };
        let configured = selectedGroup;
        if (profile?.id !== "PROFILE_CUSTOM") {
            configured = {
                ...selectedGroup,
                startingIntensity:
                    savedGameSettings.startingIntensity as GameSetupState["startingIntensity"],
                maximumIntensity:
                    savedGameSettings.maximumIntensity as GameSetupState["maximumIntensity"],
                maximumSocialSensitivity: savedGameSettings.maximumSocialSensitivity,
                intensityProgressionUnit: savedGameSettings.intensityProgressionUnit,
                intensityProgressionInterval: savedGameSettings.intensityProgressionInterval,
                intensityProgressionIncrement: savedGameSettings.intensityProgressionIncrement,
                randomQuestionRatio: savedGameSettings.randomQuestionRatio,
                letsTalkMetaInterval: savedGameSettings.letsTalkMetaInterval,
            };
        }
        if (savedGameSettings.cardLanguageSettings) {
            return applyAvailableCardLanguageSettings(
                configured,
                savedGameSettings.cardLanguageSettings,
            );
        }
        return configured;
    }
    async function persistAccountDefaults(): Promise<void> {
        if (!persistenceAvailable) return;
        const group = groups.find(
            ({ id }) => setup.groupChoice === "SELECT" && id === setup.groupId,
        );
        if (group) {
            const updated = await updateGroup({
                ...group,
                preferredProfileId: setup.profileId,
                customConfiguration:
                    setup.profileId === "PROFILE_CUSTOM"
                        ? setupConfiguration(setup)
                        : group.customConfiguration,
                cardLanguageSettings: {
                    cardLocale: setup.cardLocale,
                    cardFallbackEnabled: setup.cardFallbackEnabled,
                    cardFallbackLocales: [...setup.cardFallbackLocales],
                },
            });
            groups = groups.map((candidate) => (candidate.id === updated.id ? updated : candidate));
            announceGroupChange();
            if (savedGameSettings) {
                savedGameSettings = await saveGameSettings({
                    ...savedGameSettings,
                    defaultGroupId: updated.id,
                });
            }
            return;
        }
        savedGameSettings = await saveGameSettings({
            preferredProfileId: setup.profileId,
            startingIntensity: setup.startingIntensity,
            maximumIntensity: setup.maximumIntensity,
            maximumSocialSensitivity: setup.maximumSocialSensitivity,
            intensityProgressionUnit: setup.intensityProgressionUnit,
            intensityProgressionInterval: setup.intensityProgressionInterval,
            intensityProgressionIncrement: setup.intensityProgressionIncrement,
            randomQuestionRatio: setup.randomQuestionRatio,
            letsTalkMetaInterval: setup.letsTalkMetaInterval,
            defaultGroupId:
                setup.groupChoice === "SELECT" && setup.groupId
                    ? setup.groupId
                    : (savedGameSettings?.defaultGroupId ?? null),
            customConfiguration:
                setup.profileId === "PROFILE_CUSTOM"
                    ? setupConfiguration(setup)
                    : (savedGameSettings?.customConfiguration ?? setupConfiguration(setup)),
            cardLanguageSettings: {
                cardLocale: setup.cardLocale,
                cardFallbackEnabled: setup.cardFallbackEnabled,
                cardFallbackLocales: [...setup.cardFallbackLocales],
            },
        });
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
            announceGroupChange();
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
    async function next(): Promise<void> {
        if (busy) return;
        busy = true;
        dismissNotification();
        try {
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
                    announceGroupChange();
                }
            }
            if (index < hostSteps.length - 1) {
                const nextStep = hostSteps[index + 1];
                if (nextStep === "profile") {
                    const profile = profiles.find(({ id }) => id === setup.profileId);
                    if (profile) chooseProfile(profile);
                }
                persist({ step: nextStep });
                presentation.playEffect("turn");
                return;
            }
            await persistAccountDefaults();
            if (setup.deviceMode === "couch") {
                navigate("/play/couch", { force: true });
                return;
            }
            if (!setup.hostName.trim()) return;
            const persistence = persistenceAvailable ? "DATASPACE" : "EPHEMERAL";
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
        } finally {
            busy = false;
        }
    }
</script>

<main class="home-shell">
    {#if (authenticationLoaded && $authentication.authenticationAvailable) || dataSpaceRelevant}
        <div class="home-context-status">
            {#if authenticationLoaded && $authentication.authenticationAvailable}
                <a
                    class="account-status-pill"
                    href="/play/account?returnTo=%2Fplay%2F"
                    on:click|preventDefault={() =>
                        navigate("/play/account?returnTo=%2Fplay%2F", { force: true })}
                    aria-label={$authentication.authenticated
                        ? messages.account.openAccount
                        : messages.account.loginTitle}
                >
                    <UiIcon name="account" />
                    <span
                        >{$authentication.authenticated && $authentication.account
                            ? $authentication.account.user.name
                            : messages.account.login}</span
                    >
                </a>
            {/if}
            {#if dataSpaceRelevant && activeDataSpace}
                {#if $authentication.authenticationAvailable && $authentication.authenticated}
                    <a
                        class="active-dataspace-indicator"
                        href="/play/account?returnTo=%2Fplay%2F"
                        on:click|preventDefault={() =>
                            navigate("/play/account?returnTo=%2Fplay%2F", { force: true })}
                    >
                        <span aria-hidden="true"><UiIcon name="group" /></span>
                        <small>{messages.menu.activeDataSpace}</small>
                        <strong>{activeDataSpace.name}</strong>
                    </a>
                {:else}
                    <div class="active-dataspace-indicator" role="status">
                        <span aria-hidden="true"><UiIcon name="group" /></span>
                        <small>{messages.menu.activeDataSpace}</small>
                        <strong>{activeDataSpace.name}</strong>
                    </div>
                {/if}
            {/if}
        </div>
    {/if}
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
                    {#if continueGroupTarget}<button
                            class="menu-tile continue-tile"
                            on:click={continueGroup}
                            ><span class="tile-symbol" aria-hidden="true"
                                ><UiIcon name="group" /></span
                            ><strong
                                >{messages.menu.continueGroup}: {continueGroupTarget.name}</strong
                            ></button
                        >{/if}
                    {#if persistenceAvailable}<a class="menu-tile" href="/play/cards"
                            ><span class="tile-symbol" aria-hidden="true"
                                ><UiIcon name="content" /></span
                            ><strong>{messages.cardManagement.title}</strong><small
                                >{messages.cardManagement.menuHint}</small
                            ></a
                        >{/if}
                </nav>
                {#if authenticationLoaded}<LegalLinks
                        imprintUrl={$authentication.imprintUrl}
                        privacyPolicyUrl={$authentication.privacyPolicyUrl}
                        compact
                    />{/if}
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
                            {#if persistenceAvailable}
                                <button
                                    class:selected={setup.groupChoice === "SELECT"}
                                    class="option-card"
                                    disabled={!groups.length}
                                    on:click={() => persist({ groupChoice: "SELECT" })}
                                    ><span class="option-symbol"><UiIcon name="group" /></span
                                    ><strong>{messages.setup.selectGroup}</strong><small
                                        >{groups.length
                                            ? messages.setup.selectGroupHint
                                            : messages.setup.noSavedGroupsHint}</small
                                    ></button
                                >
                                <button
                                    class:selected={setup.groupChoice === "NEW"}
                                    class="option-card"
                                    on:click={() => persist({ groupChoice: "NEW", groupId: null })}
                                    ><span class="option-symbol"><UiIcon name="add" /></span><strong
                                        >{messages.setup.newGroup}</strong
                                    ><small>{messages.setup.newGroupHint}</small></button
                                >
                            {:else if authenticationLoaded && $authentication.authenticationAvailable}
                                <a
                                    class="option-card sign-in-option"
                                    href="/play/account?returnTo=%2Fplay%2F%3Fsetup%3Dgroup"
                                    on:click|preventDefault={() =>
                                        navigate(
                                            "/play/account?returnTo=%2Fplay%2F%3Fsetup%3Dgroup",
                                            { force: true },
                                        )}
                                    ><span class="option-symbol"><UiIcon name="account" /></span
                                    ><strong>{messages.setup.signInForGroups}</strong><small
                                        >{messages.setup.signInForGroupsHint}</small
                                    ></a
                                >
                            {/if}
                        </div>
                        {#if setup.groupChoice === "SELECT" && groups.length}
                            <GroupBrowser
                                {groups}
                                selectedId={setup.groupId}
                                onSelect={chooseGroup}
                                pageSize={12}
                            />
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
                            sessionManagementHref="/play/cards?scope=session&returnTo=%2Fplay%2F%3Fsetup%3Dcustomize"
                            showMode={false}
                            showProfile={false}
                            showEligibility={false}
                            playerCount={eligiblePreviewPlayerCount}
                            onChange={applyEditor}
                            onCardLocaleSelect={rememberCardLocale}
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
                    {#if setup.intent === "HOST"}
                        <footer class="wizard-footer">
                            <EligibleCardPreview
                                settings={editorSettings}
                                playerCount={eligiblePreviewPlayerCount}
                                compact
                            />
                            <button
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
                            >
                        </footer>
                    {/if}
                </section>
            {/if}
        </div>
    {/key}
</main>
