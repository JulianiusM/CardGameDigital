<script lang="ts">
    import { onMount } from "svelte";
    import { messages } from "./i18n";
    import { accountApi, type AccountConfiguration, type AccountSnapshot } from "./accountApi";
    import { navigate } from "./router";
    import { dismissNotification, showNotification } from "./notifications";
    import { extractAccountLinkTokens } from "./accountLinkTokens";

    type Screen = "login" | "register" | "forgot" | "reset" | "dashboard";
    let screen: Screen = "login";
    let configuration: AccountConfiguration | null = null;
    let account: AccountSnapshot | null = null;
    let username = "";
    let displayName = "";
    let email = "";
    let password = "";
    let confirmation = "";
    let dataSpaceName = "";
    let deleteConfirmation = "";
    let resetToken = "";
    let busy = false;

    onMount(async () => {
        const link = extractAccountLinkTokens(new URL(location.href));
        resetToken = link.resetToken ?? "";
        if (link.activationToken || link.resetToken) {
            history.replaceState(history.state, "", link.sanitizedPath);
        }
        configuration = await accountApi.configuration();
        if (!configuration.localLoginEnabled && !configuration.oidcEnabled) {
            navigate("/play/", { replace: true, force: true });
            return;
        }
        try {
            if (link.activationToken) {
                await accountApi.activate(link.activationToken);
                showNotification(messages.account.activated, "success");
            }
            if (link.resetToken) screen = "reset";
            account = await accountApi.current();
            screen = "dashboard";
        } catch {
            // A missing account session is normal on this public page.
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
            account = await accountApi.login(username, password);
            screen = "dashboard";
            password = "";
        });
    }

    function register(): Promise<void> {
        return perform(async () => {
            if (password !== confirmation) throw new Error(messages.account.passwordsMismatch);
            await accountApi.register({ username, displayName, email, password });
            showNotification(messages.account.activationSent, "success");
            screen = "login";
        });
    }

    function resetPassword(): Promise<void> {
        return perform(async () => {
            if (password !== confirmation) throw new Error(messages.account.passwordsMismatch);
            await accountApi.reset(resetToken, password);
            resetToken = "";
            showNotification(messages.account.passwordChanged, "success");
            screen = "login";
        });
    }

    async function reload(): Promise<void> {
        account = await accountApi.current();
        dataSpaceName = "";
    }
</script>

<main class:account-unavailable={!configuration} class="account-shell">
    <nav class="account-nav">
        <a href="/play/">{messages.account.backToGame}</a>
    </nav>
    <section class="card-panel account-panel">
        <span class="eyebrow">{messages.account.title}</span>
        {#if screen === "dashboard" && account}
            <h1>{messages.account.greeting(account.user.name)}</h1>
            <p>{account.user.email}</p>
            <h2>{messages.account.dataSpaces}</h2>
            <div class="account-list">
                {#each account.dataSpaces as space}
                    <button
                        class:primary={space.id === account.activeDataSpaceId}
                        on:click={() =>
                            perform(async () => {
                                account = await accountApi.selectDataSpace(space.id);
                            })}
                    >
                        {space.name}{space.defaultForOwner ? messages.account.defaultSuffix : ""}
                    </button>
                {/each}
            </div>
            <form
                on:submit|preventDefault={() =>
                    perform(async () => {
                        await accountApi.createDataSpace(dataSpaceName);
                        await reload();
                    })}
            >
                <label
                    >{messages.account.newDataSpace}<input
                        bind:value={dataSpaceName}
                        required
                        maxlength="50"
                    /></label
                >
                <button class="secondary" disabled={busy}>{messages.account.create}</button>
            </form>
            <div class="account-actions">
                <a class="primary button-link" href="/play/?setup=group"
                    >{messages.account.startSavedGame}</a
                >
                <a class="secondary button-link" href="/api/v1/account/export"
                    >{messages.account.exportData}</a
                >
                <button
                    class="secondary"
                    on:click={() =>
                        perform(async () => {
                            await accountApi.logout();
                            account = null;
                            screen = "login";
                        })}>{messages.account.logout}</button
                >
                <details class="danger-zone">
                    <summary>{messages.account.deleteAccount}</summary>
                    <p>{messages.account.deleteWarning}</p>
                    <label>
                        {messages.account.deleteConfirmation(account.user.username)}
                        <input bind:value={deleteConfirmation} />
                    </label>
                    <button
                        class="danger"
                        disabled={deleteConfirmation !== account.user.username || busy}
                        on:click={() =>
                            perform(async () => {
                                await accountApi.delete(deleteConfirmation);
                                account = null;
                                screen = "login";
                            })}>{messages.account.deleteFinal}</button
                    >
                </details>
            </div>
        {:else if screen === "register"}
            <h1>{messages.account.registerTitle}</h1>
            <form on:submit|preventDefault={register}>
                <label
                    >{messages.account.username}<input
                        bind:value={username}
                        required
                        minlength="3"
                        maxlength="50"
                    /></label
                >
                <label
                    >{messages.account.displayName}<input
                        bind:value={displayName}
                        required
                        maxlength="50"
                    /></label
                >
                <label
                    >{messages.account.email}<input
                        type="email"
                        bind:value={email}
                        required
                    /></label
                >
                <label
                    >{messages.account.password}<input
                        type="password"
                        bind:value={password}
                        required
                        minlength="8"
                    /></label
                >
                <label
                    >{messages.account.repeatPassword}<input
                        type="password"
                        bind:value={confirmation}
                        required
                        minlength="8"
                    /></label
                >
                <button class="primary" disabled={busy}>{messages.account.register}</button>
            </form>
            <button class="text-button" on:click={() => (screen = "login")}
                >{messages.account.backToLogin}</button
            >
        {:else if screen === "forgot"}
            <h1>{messages.account.forgotTitle}</h1>
            <form
                on:submit|preventDefault={() =>
                    perform(async () => {
                        await accountApi.requestReset(username);
                        showNotification(messages.account.resetRequested, "success");
                    })}
            >
                <label
                    >{messages.account.usernameOrEmail}<input
                        bind:value={username}
                        required
                    /></label
                >
                <button class="primary" disabled={busy}>{messages.account.requestLink}</button>
            </form>
            <button class="text-button" on:click={() => (screen = "login")}
                >{messages.account.backToLogin}</button
            >
        {:else if screen === "reset"}
            <h1>{messages.account.resetTitle}</h1>
            <form on:submit|preventDefault={resetPassword}>
                <label
                    >{messages.account.password}<input
                        type="password"
                        bind:value={password}
                        required
                        minlength="8"
                    /></label
                >
                <label
                    >{messages.account.repeat}<input
                        type="password"
                        bind:value={confirmation}
                        required
                        minlength="8"
                    /></label
                >
                <button class="primary" disabled={busy}>{messages.account.save}</button>
            </form>
        {:else}
            <h1>{messages.account.loginTitle}</h1>
            {#if configuration?.localLoginEnabled}
                <form on:submit|preventDefault={login}>
                    <label
                        >{messages.account.username}<input bind:value={username} required /></label
                    >
                    <label
                        >{messages.account.password}<input
                            type="password"
                            bind:value={password}
                            required
                        /></label
                    >
                    <button class="primary" disabled={busy}>{messages.account.loginTitle}</button>
                </form>
                <div class="account-links">
                    <button class="text-button" on:click={() => (screen = "register")}
                        >{messages.account.registerTitle}</button
                    ><button class="text-button" on:click={() => (screen = "forgot")}
                        >{messages.account.forgotAction}</button
                    >
                </div>
            {/if}
            {#if configuration?.oidcEnabled}<a
                    class="secondary button-link"
                    href="/api/v1/account/oidc/login"
                    >{messages.account.loginWith(configuration.oidcName)}</a
                >{/if}
        {/if}
    </section>
</main>
