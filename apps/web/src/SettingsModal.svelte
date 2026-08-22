<script lang="ts">
    import { onMount } from "svelte";
    import BoundarySetup, { type BoundarySelection } from "./BoundarySetup.svelte";
    import { messages } from "./i18n";
    import { presentation } from "./presentation";
    import { loadServerInfo } from "./multiplayer";
    import ResponsiveTabs from "./ResponsiveTabs.svelte";

    export let open = false;
    export let showContent = false;
    export let showPlayers = false;
    export let showGame = false;
    export let showAdvanced = false;
    export let onBoundaries: ((value: BoundarySelection) => void) | undefined;
    export let onShowPlayers: (() => void) | undefined;
    export let onEnd: (() => void) | undefined;
    export let onLeave: (() => void) | undefined;
    export let roomCode = "";
    export let qr = "";
    let preferences = presentation.preferences;
    let tab: "game" | "audio" | "display" | "content" | "session" | "services" | "advanced" =
        showGame ? "game" : "audio";
    let authenticationAvailable = false;
    $: if (!showGame && tab === "game") tab = "audio";
    $: if (!showAdvanced && tab === "advanced") tab = "audio";
    $: availableTabs = [
        ...(showGame ? [{ id: "game", label: messages.settings.game, icon: "♠" }] : []),
        { id: "audio", label: messages.settings.audio, icon: "♫" },
        { id: "display", label: messages.settings.display, icon: "✦" },
        ...(showContent ? [{ id: "content", label: messages.settings.content, icon: "◇" }] : []),
        ...(onEnd ? [{ id: "session", label: messages.settings.session, icon: "•••" }] : []),
        { id: "services", label: messages.settings.services, icon: "?" },
        ...(showAdvanced
            ? [{ id: "advanced", label: messages.settings.advanced, icon: "•••" }]
            : []),
    ];

    onMount(async () => {
        try {
            authenticationAvailable = (await loadServerInfo()).authenticationAvailable;
        } catch {
            authenticationAvailable = false;
        }
    });

    function update(key: keyof typeof preferences, value: boolean | number): void {
        preferences = presentation.update({ [key]: value });
    }
</script>

{#if open}
    <div class="modal-backdrop" role="presentation" on:click={() => (open = false)}>
        <!-- Dialog contains controls; click propagation keeps backdrop dismissal separate. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role a11y_click_events_have_key_events -->
        <div
            class="settings-modal"
            role="dialog"
            tabindex="-1"
            aria-modal="true"
            aria-labelledby="settings-title"
            on:click|stopPropagation
        >
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
                    <p>{messages.settings.endHint}</p>
                    <button class="danger wide" on:click={onEnd}>{messages.common.end}</button>
                {:else if tab === "services"}
                    {#if roomCode}<div class="settings-join-info">
                            <strong>{messages.setup.roomCode}: {roomCode}</strong>
                            {#if qr}<img
                                    src={qr}
                                    alt={messages.accessibility.roomQrCode(roomCode)}
                                />{/if}
                        </div>{/if}
                    <div class="service-actions">
                        <a
                            class="secondary button-link action-link"
                            href="/play/help"
                            target="_blank"
                            rel="noopener noreferrer">{messages.settings.help}</a
                        >
                        {#if authenticationAvailable}<a
                                class="secondary button-link"
                                href="/play/account">{messages.settings.account}</a
                            >{/if}
                    </div>
                    {#if onLeave}<p>{messages.settings.leaveHint}</p>
                        <button class="danger wide" on:click={onLeave}
                            >{messages.settings.leave}</button
                        >{/if}
                {:else if tab === "advanced"}
                    <slot name="advanced" />
                {/if}
            </div>
        </div>
    </div>
{/if}
