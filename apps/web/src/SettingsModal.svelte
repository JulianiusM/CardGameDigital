<script lang="ts">
    import { onMount } from "svelte";
    import BoundarySetup, { type BoundarySelection } from "./BoundarySetup.svelte";
    import {
        availableLocales,
        locale,
        localeDefinitions,
        messages,
        selectLocale,
        selectSystemLocale,
        type Locale,
    } from "./i18n";
    import { presentation } from "./presentation";
    import { authentication, refreshAuthentication } from "./authentication";
    import ResponsiveTabs from "./ResponsiveTabs.svelte";
    import SettingsAction from "./SettingsAction.svelte";
    import LegalLinks from "./LegalLinks.svelte";
    import GameSettingsSummary from "./GameSettingsSummary.svelte";
    import ModalShell from "./ModalShell.svelte";
    import type { CardLocaleSummary, GameProfileSummary, PublicGameSettings } from "./multiplayer";
    import { loadCardLocales } from "./multiplayer";
    import LanguageSelector, { type LanguageOption } from "./LanguageSelector.svelte";
    import LanguageOrderEditor from "./LanguageOrderEditor.svelte";
    import {
        loadLanguagePreferences,
        updateLocalLanguagePreferences,
        type LanguagePreferences,
    } from "./languagePreferences";
    import { accountApi } from "./accountApi";
    import { setAuthenticatedAccount } from "./authentication";
    import { showNotification } from "./notifications";
    import type { RoomEligibilityAccess } from "./cardPolicyApi";

    export let open = false;
    export let showContent = false;
    export let showPlayers = false;
    export let showGame = false;
    export let showAdvanced = false;
    export let onBoundaries: ((value: BoundarySelection) => void) | undefined;
    export let onShowPlayers: (() => void) | undefined;
    export let onEnd: (() => void) | undefined;
    export let onLeave: (() => void) | undefined;
    export let onCloseRoom: (() => void) | undefined;
    export let currentGameSettings: PublicGameSettings | undefined;
    export let gameProfiles: readonly GameProfileSummary[] = [];
    export let cardLocales: readonly CardLocaleSummary[] = [];
    export let roomCode = "";
    export let qr = "";
    export let currentGamePlayerCount = 2;
    export let roomAccess: RoomEligibilityAccess | undefined = undefined;
    export let defaultTab = "audio";
    let preferences = presentation.preferences;
    let languagePreferences: LanguagePreferences = loadLanguagePreferences();
    let tab:
        | "game"
        | "currentGame"
        | "audio"
        | "display"
        | "content"
        | "session"
        | "services"
        | "advanced" = "audio";
    let wasOpen = false;
    $: availableTabs = [
        ...(showGame ? [{ id: "game", label: messages.settings.game, icon: "host" }] : []),
        ...(currentGameSettings
            ? [{ id: "currentGame", label: messages.room.currentSettings, icon: "content" }]
            : []),
        { id: "audio", label: messages.settings.audio, icon: "audio" },
        { id: "display", label: messages.settings.display, icon: "display" },
        ...(showContent
            ? [{ id: "content", label: messages.settings.content, icon: "content" }]
            : []),
        ...(onEnd || onCloseRoom
            ? [{ id: "session", label: messages.settings.session, icon: "session" }]
            : []),
        {
            id: "services",
            label: roomCode ? messages.settings.roomDetails : messages.settings.services,
            icon: roomCode ? "host" : "service",
        },
        ...(showAdvanced
            ? [{ id: "advanced", label: messages.settings.advanced, icon: "advanced" }]
            : []),
    ];
    $: interfaceLanguageOptions = availableLocales().map((id) => ({
        id,
        nativeName: localeDefinitions[id].nativeName,
    }));
    $: fallbackLanguageOptions = languageOptionsForFallbacks(
        cardLocales,
        interfaceLanguageOptions,
        languagePreferences.fallbackLocales,
    );
    $: if (!availableTabs.some(({ id }) => id === tab)) {
        tab = (availableTabs[0]?.id ?? "audio") as typeof tab;
    }
    $: if (open && !wasOpen) {
        const requested = availableTabs.find(({ id }) => id === defaultTab)?.id;
        tab = (requested ?? availableTabs[0]?.id ?? "audio") as typeof tab;
        wasOpen = true;
    }
    $: if (!open) wasOpen = false;

    onMount(async () => {
        try {
            await refreshAuthentication();
            if (!cardLocales.length) cardLocales = (await loadCardLocales()).locales;
        } catch {
            // Gameplay settings remain usable if account status cannot be loaded.
        }
    });

    function update(key: keyof typeof preferences, value: boolean | number): void {
        preferences = presentation.update({ [key]: value });
    }
    function endSession(): void {
        onEnd?.();
        open = false;
    }
    function closeRoom(): void {
        onCloseRoom?.();
        open = false;
    }

    async function persistLanguagePatch(patch: Partial<LanguagePreferences>): Promise<void> {
        languagePreferences = updateLocalLanguagePreferences(patch);
        if (!$authentication.authenticated) return;
        try {
            const account = await accountApi.updateLanguagePreferences(patch);
            setAuthenticatedAccount($authentication, account);
        } catch (cause) {
            showNotification(
                cause instanceof Error ? cause.message : messages.common.requestFailed,
                "error",
            );
        }
    }

    async function chooseInterfaceLanguage(next: string): Promise<void> {
        await persistLanguagePatch({ useSystemLanguage: false, interfaceLocale: next });
        selectLocale(next as Locale);
    }

    async function chooseSystemLanguage(): Promise<void> {
        await persistLanguagePatch({ useSystemLanguage: true });
        selectSystemLocale();
    }

    function languageOptionsForFallbacks(
        catalog: readonly CardLocaleSummary[],
        interfaces: readonly LanguageOption[],
        selected: readonly string[],
    ): LanguageOption[] {
        const result = new Map<string, LanguageOption>();
        for (const option of catalog) result.set(option.id, option);
        for (const option of interfaces) {
            const tag = localeDefinitions[option.id as Locale].languageTag;
            if (!result.has(tag)) result.set(tag, { id: tag, nativeName: option.nativeName });
        }
        for (const id of selected) {
            if (!result.has(id)) result.set(id, { id, nativeName: id });
        }
        return [...result.values()];
    }
</script>

<ModalShell bind:open labelledBy="settings-title">
    <header class="modal-header">
        <div>
            <span class="eyebrow">{messages.settings.eyebrow}</span>
            <h2 id="settings-title">{messages.settings.title}</h2>
        </div>
        <button
            class="icon close"
            aria-label={messages.settings.close}
            on:click={() => (open = false)}>×</button
        >
    </header>
    <ResponsiveTabs
        tabs={availableTabs}
        selected={tab}
        label={messages.settings.title}
        onSelect={(value) => (tab = value as typeof tab)}
    />
    <div class="modal-content">
        {#if tab === "game"}
            <slot name="game" />
        {:else if tab === "currentGame" && currentGameSettings}
            <GameSettingsSummary
                settings={currentGameSettings}
                profiles={gameProfiles}
                {cardLocales}
                playerCount={currentGamePlayerCount}
                {roomAccess}
                showEligibility
            />
        {:else if tab === "audio"}
            <label class="setting-row"
                ><span
                    ><strong>{messages.presentation.music}</strong><small
                        >{messages.settings.musicHint}</small
                    ></span
                ><input
                    type="checkbox"
                    checked={preferences.musicEnabled}
                    on:change={(e) => update("musicEnabled", e.currentTarget.checked)}
                /></label
            >
            <label class="setting-row"
                ><span><strong>{messages.settings.musicVolume}</strong></span><input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={preferences.musicVolume}
                    on:input={(e) => update("musicVolume", Number(e.currentTarget.value))}
                /></label
            >
            <label class="setting-row"
                ><span
                    ><strong>{messages.presentation.effects}</strong><small
                        >{messages.settings.effectsHint}</small
                    ></span
                ><input
                    type="checkbox"
                    checked={preferences.effectsEnabled}
                    on:change={(e) => update("effectsEnabled", e.currentTarget.checked)}
                /></label
            >
        {:else if tab === "display"}
            <section class="settings-section-card interface-language-setting">
                <div>
                    <h3>{messages.settings.interfaceLanguage}</h3>
                    <p>{messages.settings.interfaceLanguageHint}</p>
                </div>
                <LanguageSelector
                    options={interfaceLanguageOptions}
                    selected={locale}
                    label={messages.settings.interfaceLanguage}
                    onSelect={chooseInterfaceLanguage}
                />
            </section>
            <label class="setting-row system-language-setting">
                <span
                    ><strong>{messages.settings.useSystemLanguage}</strong><small
                        >{messages.settings.useSystemLanguageHint}</small
                    ></span
                ><input
                    type="checkbox"
                    checked={languagePreferences.useSystemLanguage}
                    on:change={(event) =>
                        event.currentTarget.checked
                            ? chooseSystemLanguage()
                            : chooseInterfaceLanguage(locale)}
                />
            </label>
            <section class="settings-section-card language-fallback-setting">
                <div>
                    <h3>{messages.settings.languageFallbacks}</h3>
                    <p>{messages.settings.languageFallbacksHint}</p>
                </div>
                <LanguageOrderEditor
                    options={fallbackLanguageOptions}
                    order={languagePreferences.fallbackLocales}
                    onChange={(fallbackLocales) => persistLanguagePatch({ fallbackLocales })}
                />
            </section>
            <label class="setting-row"
                ><span
                    ><strong>{messages.presentation.reducedMotion}</strong><small
                        >{messages.settings.motionHint}</small
                    ></span
                ><input
                    type="checkbox"
                    checked={preferences.reducedMotion}
                    on:change={(e) => update("reducedMotion", e.currentTarget.checked)}
                /></label
            >
            <label class="setting-row"
                ><span
                    ><strong>{messages.settings.largeText}</strong><small
                        >{messages.settings.largeTextHint}</small
                    ></span
                ><input
                    type="checkbox"
                    checked={preferences.largeText}
                    on:change={(e) => update("largeText", e.currentTarget.checked)}
                /></label
            >
        {:else if tab === "content" && onBoundaries}
            <BoundarySetup
                onSave={(value) => {
                    onBoundaries?.(value);
                    open = false;
                }}
            />
            {#if showPlayers}<button class="secondary wide" on:click={onShowPlayers}
                    >{messages.settings.managePlayers}</button
                >{/if}
        {:else if tab === "session"}
            {#if onEnd}<p>{messages.settings.endHint}</p>
                <button class="danger wide" on:click={endSession}>{messages.common.end}</button
                >{/if}
            {#if onCloseRoom}<div class="danger-zone room-close-zone">
                    <strong>{messages.settings.closeRoom}</strong>
                    <p>{messages.settings.closeRoomHint}</p>
                    <button class="danger wide" on:click={closeRoom}
                        >{messages.settings.closeRoom}</button
                    >
                </div>{/if}
        {:else if tab === "services"}
            {#if roomCode}<div class="settings-join-info">
                    <strong>{messages.setup.roomCode}: {roomCode}</strong>
                    {#if qr}<img src={qr} alt={messages.accessibility.roomQrCode(roomCode)} />{/if}
                </div>{/if}
            <div class="service-actions">
                <SettingsAction
                    href="/play/help"
                    label={messages.settings.help}
                    icon="service"
                    newTab
                />
                {#if $authentication.authenticationAvailable}<SettingsAction
                        href={`/play/account?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
                        label={$authentication.authenticated && $authentication.account
                            ? messages.account.openAs($authentication.account.user.name)
                            : messages.settings.account}
                        icon="account"
                        newTab
                    />{/if}
            </div>
            <LegalLinks
                imprintUrl={$authentication.imprintUrl}
                privacyPolicyUrl={$authentication.privacyPolicyUrl}
            />
            {#if onLeave}<p>{messages.settings.leaveHint}</p>
                <button class="danger wide" on:click={onLeave}>{messages.settings.leave}</button
                >{/if}
        {:else if tab === "advanced"}
            <slot name="advanced" />
        {/if}
    </div>
</ModalShell>
