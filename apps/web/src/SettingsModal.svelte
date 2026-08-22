<script lang="ts">
    import BoundarySetup, { type BoundarySelection } from "./BoundarySetup.svelte";
    import { messages } from "./i18n";
    import { presentation } from "./presentation";

    export let open = false;
    export let showContent = false;
    export let showPlayers = false;
    export let onBoundaries: ((value: BoundarySelection) => void) | undefined;
    export let onShowPlayers: (() => void) | undefined;
    export let onEnd: (() => void) | undefined;
    let preferences = presentation.preferences;
    let tab: "audio" | "display" | "content" | "session" = "audio";

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
            <nav class="modal-tabs" aria-label={messages.settings.title}>
                <button class:active={tab === "audio"} on:click={() => (tab = "audio")}
                    >♫ {messages.settings.audio}</button
                >
                <button class:active={tab === "display"} on:click={() => (tab = "display")}
                    >✦ {messages.settings.display}</button
                >
                {#if showContent}<button
                        class:active={tab === "content"}
                        on:click={() => (tab = "content")}>◇ {messages.settings.content}</button
                    >{/if}
                {#if onEnd}<button
                        class:active={tab === "session"}
                        on:click={() => (tab = "session")}>••• {messages.settings.session}</button
                    >{/if}
            </nav>
            <div class="modal-content">
                {#if tab === "audio"}
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
                {/if}
            </div>
        </div>
    </div>
{/if}
