<script lang="ts">
    import { onMount } from "svelte";
    import { messages } from "./i18n";
    import { accountApi } from "./accountApi";
    import type {
        AccountSessionSummary,
        AccountSnapshot,
        AccountStatus,
    } from "../../../packages/protocol";
    import {
        clearAuthenticatedAccount,
        refreshAuthentication,
        setAuthenticatedAccount,
    } from "./authentication";
    import { navigate } from "./router";
    import { dismissNotification, showNotification } from "./notifications";
    import { extractAccountLinkTokens } from "./accountLinkTokens";
    import ResponsiveTabs, { type ResponsiveTab } from "./ResponsiveTabs.svelte";
    import UiIcon from "./UiIcon.svelte";
    import { saveLanguagePreferences } from "./languagePreferences";
    import { reloadWithoutNavigationPrompt } from "./router";
    import GroupManagement from "./GroupManagement.svelte";
    import CardManagement from "./CardManagement.svelte";

    type Screen = "login" | "register" | "activation" | "forgot" | "reset" | "dashboard";
    type DashboardTab = "data-spaces" | "groups" | "cards" | "devices" | "account-data";

    let screen: Screen = "login";
    let dashboardTab: DashboardTab = "data-spaces";
    let status: AccountStatus | null = null;
    let account: AccountSnapshot | null = null;
    let accountSessions: AccountSessionSummary[] = [];
    let username = "";
    let displayName = "";
    let email = "";
    let password = "";
    let confirmation = "";
    let dataSpaceName = "";
    let activeDataSpaceName = "";
    let activeDataSpaceDefault = false;
    let deleteDataSpaceId: string | null = null;
    let deleteDataSpaceConfirmation = "";
    let dataSpaceQuery = "";
    let dataSpacePage = 0;
    let deleteConfirmation = "";
    let resetToken = "";
    let busy = false;
    const dataSpacePageSize = 8;
    const returnTo = safeReturnTo(new URL(location.href).searchParams.get("returnTo"));

    $: configuration = status;
    $: activeDataSpace = account?.dataSpaces.find(({ id }) => id === account?.activeDataSpaceId);
    $: dataSpaceToDelete = account?.dataSpaces.find(({ id }) => id === deleteDataSpaceId);
    $: matchingDataSpaces = (account?.dataSpaces ?? []).filter(({ name }) =>
        name.toLocaleLowerCase().includes(dataSpaceQuery.trim().toLocaleLowerCase()),
    );
    $: dataSpacePageCount = Math.max(1, Math.ceil(matchingDataSpaces.length / dataSpacePageSize));
    $: if (dataSpacePage >= dataSpacePageCount) dataSpacePage = dataSpacePageCount - 1;
    $: visibleDataSpaces = matchingDataSpaces.slice(
        dataSpacePage * dataSpacePageSize,
        dataSpacePage * dataSpacePageSize + dataSpacePageSize,
    );
    $: dashboardTabs = [
        { id: "data-spaces", label: messages.account.dataSpacesTab, icon: "service" },
        { id: "groups", label: messages.account.groupsTab, icon: "group" },
        { id: "cards", label: messages.cardManagement.title, icon: "content" },
        { id: "devices", label: messages.account.devicesTab, icon: "session" },
        { id: "account-data", label: messages.account.accountDataTab, icon: "account" },
    ] satisfies ResponsiveTab[];

    onMount(async () => {
        const link = extractAccountLinkTokens(new URL(location.href));
        resetToken = link.resetToken ?? "";
        if (link.activationToken || link.resetToken) {
            history.replaceState(history.state, "", link.sanitizedPath);
        }
        try {
            status = await refreshAuthentication();
            if (!status.localLoginEnabled && !status.oidcEnabled) {
                navigate("/play/", { replace: true, force: true });
                return;
            }
            if (link.activationToken) {
                await accountApi.activate(link.activationToken);
                showNotification(messages.account.activated, "success");
            }
            status = await refreshAuthentication();
            if (link.resetToken) {
                screen = "reset";
                return;
            }
            if (status.authenticated && status.account) await showDashboard(status.account);
        } catch (cause) {
            showNotification(
                cause instanceof Error ? cause.message : messages.account.requestFailed,
                "error",
            );
        }
    });

    async function perform(action: () => Promise<void>): Promise<void> {
        busy = true;
        dismissNotification();
        try {
            await action();
        } catch (cause) {
            showNotification(
                cause instanceof Error ? cause.message : messages.account.requestFailed,
                "error",
            );
        } finally {
            busy = false;
        }
    }

    function login(): Promise<void> {
        return perform(async () => {
            const snapshot = await accountApi.login(username, password);
            await showDashboard(snapshot);
            password = "";
            if (snapshot.languagePreferences) {
                saveLanguagePreferences(snapshot.languagePreferences);
                if (returnTo) navigate(returnTo, { replace: true, force: true });
                reloadWithoutNavigationPrompt();
            } else if (returnTo) navigate(returnTo, { replace: true, force: true });
        });
    }

    function register(): Promise<void> {
        return perform(async () => {
            if (password !== confirmation) throw new Error(messages.account.passwordsMismatch);
            await accountApi.register({ username, displayName, email, password });
            showNotification(messages.account.activationSent, "success");
            screen = "activation";
        });
    }

    function resetPassword(): Promise<void> {
        return perform(async () => {
            if (password !== confirmation) throw new Error(messages.account.passwordsMismatch);
            await accountApi.reset(resetToken, password);
            resetToken = "";
            account = null;
            accountSessions = [];
            status = await refreshAuthentication();
            showNotification(messages.account.passwordChanged, "success");
            screen = "login";
        });
    }

    async function showDashboard(snapshot: AccountSnapshot): Promise<void> {
        account = snapshot;
        screen = "dashboard";
        const active = snapshot.dataSpaces.find(({ id }) => id === snapshot.activeDataSpaceId);
        activeDataSpaceName = active?.name ?? "";
        activeDataSpaceDefault = active?.defaultForOwner ?? false;
        if (!dataSpaceQuery.trim()) {
            const activeIndex = snapshot.dataSpaces.findIndex(
                ({ id }) => id === snapshot.activeDataSpaceId,
            );
            dataSpacePage = Math.max(0, Math.floor(activeIndex / dataSpacePageSize));
        }
        if (!snapshot.dataSpaces.some(({ id }) => id === deleteDataSpaceId)) {
            cancelDataSpaceDeletion();
        }
        accountSessions = await accountApi.sessions();
        if (status) setAuthenticatedAccount(status, snapshot);
    }

    function selectDataSpace(id: string): Promise<void> {
        return perform(async () => showDashboard(await accountApi.selectDataSpace(id)));
    }

    function createDataSpace(): Promise<void> {
        return perform(async () => {
            await accountApi.createDataSpace(dataSpaceName);
            await showDashboard(await accountApi.current());
            dataSpaceName = "";
            showNotification(messages.account.dataSpaceCreated, "success");
        });
    }

    function updateCurrentDataSpace(): Promise<void> {
        return perform(async () => {
            await showDashboard(
                await accountApi.updateDataSpace(activeDataSpaceName, activeDataSpaceDefault),
            );
            showNotification(messages.account.dataSpaceSaved, "success");
        });
    }

    function beginDataSpaceDeletion(id: string): void {
        deleteDataSpaceId = id;
        deleteDataSpaceConfirmation = "";
    }

    function cancelDataSpaceDeletion(): void {
        deleteDataSpaceId = null;
        deleteDataSpaceConfirmation = "";
    }

    function deleteDataSpace(): Promise<void> {
        if (!dataSpaceToDelete) return Promise.resolve();
        const id = dataSpaceToDelete.id;
        return perform(async () => {
            await showDashboard(await accountApi.deleteDataSpace(id));
            showNotification(messages.account.dataSpaceDeleted, "success");
        });
    }

    function revokeSession(session: AccountSessionSummary): Promise<void> {
        return perform(async () => {
            await accountApi.revokeSession(session.id);
            if (session.current) {
                account = null;
                accountSessions = [];
                screen = "login";
                if (status) clearAuthenticatedAccount(status);
                return;
            }
            accountSessions = await accountApi.sessions();
            showNotification(messages.account.sessionRevoked, "success");
        });
    }

    function logout(): Promise<void> {
        return perform(async () => {
            await accountApi.logout();
            account = null;
            accountSessions = [];
            screen = "login";
            if (status) clearAuthenticatedAccount(status);
        });
    }

    function safeReturnTo(value: string | null): string | null {
        if (!value) return null;
        const parsed = new URL(value, location.origin);
        const applicationPath = parsed.pathname === "/play" || parsed.pathname.startsWith("/play/");
        if (parsed.origin !== location.origin || !applicationPath) return null;
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
</script>

<main class="account-shell">
    <nav class="account-nav" aria-label={messages.account.accountNavigation}>
        <a class="secondary button-link account-back-button" href="/play/">
            <span aria-hidden="true">‹</span>
            {messages.account.backToGame}
        </a>
    </nav>

    <section class:account-dashboard={screen === "dashboard"} class="card-panel account-panel">
        {#if !configuration}
            <div class="account-loading" aria-live="polite" aria-busy="true">
                <span class="account-page-icon" aria-hidden="true"><UiIcon name="account" /></span>
                <strong>{messages.account.loading}</strong>
            </div>
        {:else if screen === "dashboard" && account}
            <header class="account-dashboard-header">
                <span class="account-page-icon" aria-hidden="true"><UiIcon name="account" /></span>
                <div>
                    <span class="eyebrow">{messages.account.title}</span>
                    <h1>{messages.account.greeting(account.user.name)}</h1>
                    <p>{account.user.email}</p>
                </div>
                {#if activeDataSpace}
                    <div class="account-active-space" aria-label={messages.account.activeDataSpace}>
                        <span>{messages.account.activeDataSpace}</span>
                        <strong>{activeDataSpace.name}</strong>
                    </div>
                {/if}
            </header>

            <ResponsiveTabs
                tabs={dashboardTabs}
                selected={dashboardTab}
                label={messages.account.accountSections}
                onSelect={(id) => (dashboardTab = id as DashboardTab)}
            />

            {#if dashboardTab === "data-spaces"}
                <div class="account-tab-panel" role="tabpanel">
                    <section class="account-explainer">
                        <span class="account-section-icon" aria-hidden="true"
                            ><UiIcon name="group" /></span
                        >
                        <div>
                            <span class="eyebrow">{messages.account.dataSpaceExplainerEyebrow}</span
                            >
                            <h2>{messages.account.dataSpaceExplainerTitle}</h2>
                            <p>{messages.account.dataSpaceExplainer}</p>
                            <p class="account-note">{messages.account.quickRoundDataSpaceHint}</p>
                        </div>
                    </section>

                    <section
                        class="settings-section-card account-section-card"
                        aria-labelledby="data-spaces-title"
                    >
                        <div class="account-section-heading">
                            <div>
                                <h2 id="data-spaces-title">{messages.account.dataSpaces}</h2>
                                <p>{messages.account.dataSpacesHint}</p>
                            </div>
                            <span class="account-count-badge">{account.dataSpaces.length}</span>
                        </div>
                        <label class="data-space-search">
                            <span>{messages.account.searchDataSpaces}</span>
                            <span class="data-space-search-control">
                                <UiIcon name="service" />
                                <input
                                    type="search"
                                    value={dataSpaceQuery}
                                    placeholder={messages.account.searchDataSpacesPlaceholder}
                                    on:input={(event) => {
                                        dataSpaceQuery = event.currentTarget.value;
                                        dataSpacePage = 0;
                                    }}
                                />
                            </span>
                        </label>
                        <div class="data-space-list-summary" aria-live="polite">
                            <strong
                                >{messages.account.dataSpaceResults(
                                    matchingDataSpaces.length,
                                )}</strong
                            >
                            <span
                                >{messages.account.dataSpaceResultRange(
                                    matchingDataSpaces.length
                                        ? dataSpacePage * dataSpacePageSize + 1
                                        : 0,
                                    Math.min(
                                        dataSpacePage * dataSpacePageSize + dataSpacePageSize,
                                        matchingDataSpaces.length,
                                    ),
                                )}</span
                            >
                        </div>
                        <div class="data-space-list">
                            {#each visibleDataSpaces as space (space.id)}
                                <article
                                    class:active={space.id === account.activeDataSpaceId}
                                    class="data-space-card"
                                >
                                    <div class="data-space-summary">
                                        <span class="data-space-symbol" aria-hidden="true"
                                            ><UiIcon name="group" /></span
                                        >
                                        <span>
                                            <strong>{space.name}</strong>
                                            <span class="data-space-badges">
                                                {#if space.id === account.activeDataSpaceId}<small
                                                        class="active"
                                                        >{messages.account.active}</small
                                                    >{/if}
                                                {#if space.defaultForOwner}<small
                                                        >{messages.account.defaultLabel}</small
                                                    >{/if}
                                            </span>
                                        </span>
                                    </div>
                                    <div class="data-space-actions">
                                        {#if space.id === account.activeDataSpaceId}
                                            <button
                                                class="secondary"
                                                type="button"
                                                disabled
                                                aria-pressed="true"
                                                >{messages.account.selected}</button
                                            >
                                        {:else}
                                            <button
                                                class="secondary"
                                                type="button"
                                                disabled={busy}
                                                on:click={() => selectDataSpace(space.id)}
                                                >{messages.account.select}</button
                                            >
                                        {/if}
                                        <button
                                            class="danger-outline"
                                            type="button"
                                            disabled={busy || account.dataSpaces.length === 1}
                                            aria-label={messages.account.deleteDataSpaceNamed(
                                                space.name,
                                            )}
                                            on:click={() => beginDataSpaceDeletion(space.id)}
                                            >{messages.common.delete}</button
                                        >
                                    </div>
                                    {#if deleteDataSpaceId === space.id}
                                        <div class="data-space-delete-confirmation">
                                            <div>
                                                <strong
                                                    >{messages.account.deleteDataSpaceTitle(
                                                        space.name,
                                                    )}</strong
                                                >
                                                <p>{messages.account.deleteDataSpaceWarning}</p>
                                            </div>
                                            <label class="account-field">
                                                <span
                                                    >{messages.account.typeDataSpaceName(
                                                        space.name,
                                                    )}</span
                                                >
                                                <input
                                                    class="account-input"
                                                    bind:value={deleteDataSpaceConfirmation}
                                                    autocomplete="off"
                                                />
                                            </label>
                                            <div class="account-inline-actions">
                                                <button
                                                    class="secondary"
                                                    type="button"
                                                    disabled={busy}
                                                    on:click={cancelDataSpaceDeletion}
                                                    >{messages.common.cancel}</button
                                                >
                                                <button
                                                    class="danger"
                                                    type="button"
                                                    disabled={busy ||
                                                        deleteDataSpaceConfirmation !== space.name}
                                                    on:click={deleteDataSpace}
                                                    >{messages.account.deleteDataSpaceFinal}</button
                                                >
                                            </div>
                                        </div>
                                    {/if}
                                </article>
                            {:else}
                                <div class="data-space-empty" role="status">
                                    <span aria-hidden="true"><UiIcon name="search" /></span>
                                    <strong>{messages.account.noMatchingDataSpaces}</strong>
                                    <p>{messages.account.noMatchingDataSpacesHint}</p>
                                </div>
                            {/each}
                        </div>
                        {#if dataSpacePageCount > 1}
                            <nav
                                class="data-space-pagination"
                                aria-label={messages.account.dataSpacePages}
                            >
                                <button
                                    class="secondary"
                                    type="button"
                                    disabled={dataSpacePage === 0}
                                    on:click={() => (dataSpacePage -= 1)}
                                    >‹ {messages.common.previous}</button
                                >
                                <span>{dataSpacePage + 1} / {dataSpacePageCount}</span>
                                <button
                                    class="secondary"
                                    type="button"
                                    disabled={dataSpacePage === dataSpacePageCount - 1}
                                    on:click={() => (dataSpacePage += 1)}
                                    >{messages.common.next} ›</button
                                >
                            </nav>
                        {/if}
                        {#if account.dataSpaces.length === 1}
                            <p class="account-note">{messages.account.lastDataSpaceHint}</p>
                        {/if}
                    </section>

                    {#if account.activeDataSpaceId}
                        <section class="settings-section-card account-section-card">
                            <div class="account-section-heading">
                                <div>
                                    <h2>{messages.account.currentDataSpace}</h2>
                                    <p>{messages.account.currentDataSpaceHint}</p>
                                </div>
                                <span class="account-section-icon small" aria-hidden="true"
                                    ><UiIcon name="service" /></span
                                >
                            </div>
                            <form
                                class="account-form account-form-inline"
                                on:submit|preventDefault={updateCurrentDataSpace}
                            >
                                <label class="account-field">
                                    <span>{messages.account.dataSpaceName}</span>
                                    <input
                                        class="account-input"
                                        bind:value={activeDataSpaceName}
                                        required
                                        maxlength="50"
                                    />
                                </label>
                                <label class="account-checkbox-card">
                                    <input type="checkbox" bind:checked={activeDataSpaceDefault} />
                                    <span
                                        ><strong>{messages.account.makeDefault}</strong><small
                                            >{messages.account.makeDefaultHint}</small
                                        ></span
                                    >
                                </label>
                                <button class="primary" disabled={busy}
                                    >{messages.common.save}</button
                                >
                            </form>
                        </section>
                    {/if}

                    <section class="settings-section-card account-section-card">
                        <div class="account-section-heading">
                            <div>
                                <h2>{messages.account.newDataSpace}</h2>
                                <p>{messages.account.newDataSpaceHint}</p>
                            </div>
                            <span class="account-section-icon small" aria-hidden="true"
                                ><UiIcon name="add" /></span
                            >
                        </div>
                        <form
                            class="account-form account-form-inline"
                            on:submit|preventDefault={createDataSpace}
                        >
                            <label class="account-field">
                                <span>{messages.account.dataSpaceName}</span>
                                <input
                                    class="account-input"
                                    bind:value={dataSpaceName}
                                    required
                                    maxlength="50"
                                    placeholder={messages.account.dataSpacePlaceholder}
                                />
                            </label>
                            <button class="primary" disabled={busy}
                                >{messages.account.create}</button
                            >
                        </form>
                    </section>
                </div>
            {:else if dashboardTab === "groups" && activeDataSpace}
                {#key activeDataSpace.id}
                    <GroupManagement dataSpaceName={activeDataSpace.name} />
                {/key}
            {:else if dashboardTab === "cards" && activeDataSpace}
                <div class="account-tab-panel" role="tabpanel">
                    {#key activeDataSpace.id}
                        <CardManagement embedded />
                    {/key}
                </div>
            {:else if dashboardTab === "devices"}
                <div class="account-tab-panel" role="tabpanel">
                    <section
                        class="settings-section-card account-section-card"
                        aria-labelledby="account-sessions-title"
                    >
                        <div class="account-section-heading">
                            <div>
                                <h2 id="account-sessions-title">{messages.account.sessions}</h2>
                                <p>{messages.account.sessionsHint}</p>
                            </div>
                            <span class="account-section-icon small" aria-hidden="true"
                                ><UiIcon name="session" /></span
                            >
                        </div>
                        <div class="account-session-list">
                            {#each accountSessions as session}
                                <article
                                    class:current={session.current}
                                    class="account-session-row"
                                >
                                    <span class="account-session-icon" aria-hidden="true"
                                        ><UiIcon name="session" /></span
                                    >
                                    <span class="account-session-copy">
                                        <strong
                                            >{session.current
                                                ? messages.account.currentSession
                                                : messages.account.otherSession}</strong
                                        >
                                        <small
                                            >{messages.account.sessionExpires(
                                                new Date(session.expiresAt).toLocaleString(),
                                            )}</small
                                        >
                                    </span>
                                    <button
                                        class="secondary"
                                        type="button"
                                        disabled={busy}
                                        on:click={() => revokeSession(session)}
                                    >
                                        {session.current
                                            ? messages.account.signOutHere
                                            : messages.account.revokeSession}
                                    </button>
                                </article>
                            {/each}
                        </div>
                    </section>
                </div>
            {:else}
                <div class="account-tab-panel" role="tabpanel">
                    <section class="settings-section-card account-section-card">
                        <div class="account-section-heading">
                            <div>
                                <h2>{messages.account.savedGamesAndData}</h2>
                                <p>{messages.account.savedGamesAndDataHint}</p>
                            </div>
                            <span class="account-section-icon small" aria-hidden="true"
                                ><UiIcon name="account" /></span
                            >
                        </div>
                        <div class="account-feature-actions">
                            <a class="account-feature-action primary" href="/play/?setup=group">
                                <span aria-hidden="true"><UiIcon name="host" /></span>
                                <span
                                    ><strong>{messages.account.startSavedGame}</strong><small
                                        >{messages.account.startSavedGameHint}</small
                                    ></span
                                >
                                <b aria-hidden="true">›</b>
                            </a>
                            <a
                                class="account-feature-action secondary"
                                href="/api/v1/account/export"
                                download
                            >
                                <span aria-hidden="true"><UiIcon name="account" /></span>
                                <span
                                    ><strong>{messages.account.exportData}</strong><small
                                        >{messages.account.exportDataHint}</small
                                    ></span
                                >
                                <b aria-hidden="true">↓</b>
                            </a>
                            <button
                                class="account-feature-action secondary"
                                type="button"
                                aria-label={messages.account.logout}
                                disabled={busy}
                                on:click={logout}
                            >
                                <span aria-hidden="true"><UiIcon name="session" /></span>
                                <span
                                    ><strong>{messages.account.logout}</strong><small
                                        >{messages.account.logoutHint}</small
                                    ></span
                                >
                                <b aria-hidden="true">›</b>
                            </button>
                        </div>
                    </section>

                    <section class="account-danger-card" aria-labelledby="delete-account-title">
                        <div class="account-section-heading">
                            <div>
                                <span class="eyebrow">{messages.account.dangerZone}</span>
                                <h2 id="delete-account-title">{messages.account.deleteAccount}</h2>
                                <p>{messages.account.deleteWarning}</p>
                            </div>
                        </div>
                        <label class="account-field">
                            <span>{messages.account.deleteConfirmation(account.user.username)}</span
                            >
                            <input
                                class="account-input"
                                bind:value={deleteConfirmation}
                                autocomplete="off"
                            />
                        </label>
                        <button
                            class="danger"
                            disabled={deleteConfirmation !== account.user.username || busy}
                            on:click={() =>
                                perform(async () => {
                                    await accountApi.delete(deleteConfirmation);
                                    account = null;
                                    accountSessions = [];
                                    screen = "login";
                                    if (status) clearAuthenticatedAccount(status);
                                })}>{messages.account.deleteFinal}</button
                        >
                    </section>
                </div>
            {/if}
        {:else if screen === "register"}
            <header class="account-page-header">
                <span class="account-page-icon" aria-hidden="true"><UiIcon name="add" /></span>
                <span class="eyebrow">{messages.account.title}</span>
                <h1>{messages.account.registerTitle}</h1>
                <p>{messages.account.registerHint}</p>
            </header>
            <section class="account-auth-card">
                <form class="account-form" on:submit|preventDefault={register}>
                    <label class="account-field"
                        ><span>{messages.account.username}</span><input
                            class="account-input"
                            bind:value={username}
                            required
                            minlength="3"
                            maxlength="50"
                            autocomplete="username"
                        /></label
                    >
                    <label class="account-field"
                        ><span>{messages.account.displayName}</span><input
                            class="account-input"
                            bind:value={displayName}
                            required
                            maxlength="50"
                            autocomplete="name"
                        /></label
                    >
                    <label class="account-field"
                        ><span>{messages.account.email}</span><input
                            class="account-input"
                            type="email"
                            bind:value={email}
                            required
                            autocomplete="email"
                        /></label
                    >
                    <label class="account-field"
                        ><span>{messages.account.password}</span><input
                            class="account-input"
                            type="password"
                            bind:value={password}
                            required
                            minlength="8"
                            autocomplete="new-password"
                        /></label
                    >
                    <label class="account-field"
                        ><span>{messages.account.repeatPassword}</span><input
                            class="account-input"
                            type="password"
                            bind:value={confirmation}
                            required
                            minlength="8"
                            autocomplete="new-password"
                        /></label
                    >
                    <button class="primary account-submit" disabled={busy}
                        >{messages.account.register}</button
                    >
                </form>
            </section>
            <button
                class="secondary account-back-action"
                type="button"
                on:click={() => (screen = "login")}>{messages.account.backToLogin}</button
            >
        {:else if screen === "activation"}
            <header class="account-page-header">
                <span class="account-page-icon" aria-hidden="true"><UiIcon name="account" /></span>
                <span class="eyebrow">{messages.account.title}</span>
                <h1>{messages.account.activationTitle}</h1>
                <p>{messages.account.activationHint}</p>
            </header>
            <section class="account-auth-card">
                <form
                    class="account-form"
                    on:submit|preventDefault={() =>
                        perform(async () => {
                            await accountApi.requestActivation(username || email);
                            showNotification(messages.account.activationRequested, "success");
                        })}
                >
                    <label class="account-field"
                        ><span>{messages.account.usernameOrEmail}</span><input
                            class="account-input"
                            bind:value={username}
                            required
                            autocomplete="username"
                        /></label
                    >
                    <button class="primary account-submit" disabled={busy}
                        >{messages.account.resendActivation}</button
                    >
                </form>
            </section>
            <button
                class="secondary account-back-action"
                type="button"
                on:click={() => (screen = "login")}>{messages.account.backToLogin}</button
            >
        {:else if screen === "forgot"}
            <header class="account-page-header">
                <span class="account-page-icon" aria-hidden="true"><UiIcon name="question" /></span>
                <span class="eyebrow">{messages.account.title}</span>
                <h1>{messages.account.forgotTitle}</h1>
                <p>{messages.account.forgotHint}</p>
            </header>
            <section class="account-auth-card">
                <form
                    class="account-form"
                    on:submit|preventDefault={() =>
                        perform(async () => {
                            await accountApi.requestReset(username);
                            showNotification(messages.account.resetRequested, "success");
                        })}
                >
                    <label class="account-field"
                        ><span>{messages.account.usernameOrEmail}</span><input
                            class="account-input"
                            bind:value={username}
                            required
                            autocomplete="username"
                        /></label
                    >
                    <button class="primary account-submit" disabled={busy}
                        >{messages.account.requestLink}</button
                    >
                </form>
            </section>
            <button
                class="secondary account-back-action"
                type="button"
                on:click={() => (screen = "login")}>{messages.account.backToLogin}</button
            >
        {:else if screen === "reset"}
            <header class="account-page-header">
                <span class="account-page-icon" aria-hidden="true"><UiIcon name="account" /></span>
                <span class="eyebrow">{messages.account.title}</span>
                <h1>{messages.account.resetTitle}</h1>
                <p>{messages.account.resetHint}</p>
            </header>
            <section class="account-auth-card">
                <form class="account-form" on:submit|preventDefault={resetPassword}>
                    <label class="account-field"
                        ><span>{messages.account.password}</span><input
                            class="account-input"
                            type="password"
                            bind:value={password}
                            required
                            minlength="8"
                            autocomplete="new-password"
                        /></label
                    >
                    <label class="account-field"
                        ><span>{messages.account.repeat}</span><input
                            class="account-input"
                            type="password"
                            bind:value={confirmation}
                            required
                            minlength="8"
                            autocomplete="new-password"
                        /></label
                    >
                    <button class="primary account-submit" disabled={busy}
                        >{messages.account.save}</button
                    >
                </form>
            </section>
        {:else}
            <header class="account-page-header">
                <span class="account-page-icon" aria-hidden="true"><UiIcon name="account" /></span>
                <span class="eyebrow">{messages.account.title}</span>
                <h1>{messages.account.loginTitle}</h1>
                <p>{messages.account.loginHint}</p>
            </header>

            {#if configuration.localLoginEnabled}
                <div class="account-auth-choice-grid">
                    <section class="account-auth-card account-login-card">
                        <span class="account-auth-card-icon" aria-hidden="true"
                            ><UiIcon name="account" /></span
                        >
                        <h2>{messages.account.existingAccount}</h2>
                        <p>{messages.account.existingAccountHint}</p>
                        <form class="account-form" on:submit|preventDefault={login}>
                            <label class="account-field"
                                ><span>{messages.account.username}</span><input
                                    class="account-input"
                                    bind:value={username}
                                    required
                                    autocomplete="username"
                                /></label
                            >
                            <label class="account-field"
                                ><span>{messages.account.password}</span><input
                                    class="account-input"
                                    type="password"
                                    bind:value={password}
                                    required
                                    autocomplete="current-password"
                                /></label
                            >
                            <button class="primary account-submit" disabled={busy}
                                >{messages.account.loginTitle}</button
                            >
                        </form>
                        <div class="account-support-actions">
                            <button
                                class="account-quiet-action"
                                type="button"
                                on:click={() => (screen = "forgot")}
                                >{messages.account.forgotAction}</button
                            >
                            <button
                                class="account-quiet-action"
                                type="button"
                                on:click={() => (screen = "activation")}
                                >{messages.account.resendActivation}</button
                            >
                        </div>
                    </section>

                    <div class="account-choice-divider" aria-label={messages.common.or}>
                        <span></span><strong>{messages.common.or}</strong><span></span>
                    </div>

                    <section class="account-auth-card account-register-card">
                        <span class="account-auth-card-icon" aria-hidden="true"
                            ><UiIcon name="add" /></span
                        >
                        <h2>{messages.account.newHere}</h2>
                        <p>{messages.account.newHereHint}</p>
                        <button
                            class="secondary account-register-button"
                            type="button"
                            on:click={() => (screen = "register")}
                            >{messages.account.registerTitle}</button
                        >
                    </section>
                </div>
            {/if}

            {#if configuration.oidcEnabled}
                <section class="account-provider-section">
                    {#if configuration.localLoginEnabled}<div class="account-provider-divider">
                            <span></span><strong>{messages.account.orUseProvider}</strong><span
                            ></span>
                        </div>{/if}
                    <a
                        class="account-provider-button"
                        href={`/api/v1/account/oidc/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
                    >
                        <span class="account-provider-icon" aria-hidden="true"
                            ><UiIcon name="service" /></span
                        >
                        <span
                            ><strong>{messages.account.loginWith(configuration.oidcName)}</strong
                            ><small>{messages.account.providerHint}</small></span
                        >
                        <b aria-hidden="true">›</b>
                    </a>
                </section>
            {/if}
        {/if}
    </section>
</main>
