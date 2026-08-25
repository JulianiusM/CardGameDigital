<script lang="ts">
    import SettingsAction from "./SettingsAction.svelte";
    import UiIcon from "./UiIcon.svelte";
    import { messages } from "./i18n";

    export let imprintUrl = "";
    export let privacyPolicyUrl = "";
    export let compact = false;
</script>

{#if imprintUrl || privacyPolicyUrl}
    {#if compact}
        <nav class="legal-links compact" aria-label={messages.settings.legal}>
            {#if imprintUrl}<a href={imprintUrl} target="_blank" rel="noopener noreferrer">
                    <UiIcon name="legal" />
                    <span>{messages.settings.imprint}</span>
                </a>{/if}
            {#if privacyPolicyUrl}<a
                    href={privacyPolicyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <UiIcon name="privacy" />
                    <span>{messages.settings.privacyPolicy}</span>
                </a>{/if}
        </nav>
    {:else}
        <section class="legal-actions" aria-labelledby="legal-actions-title">
            <div class="legal-actions-heading">
                <span class="eyebrow">{messages.settings.legalEyebrow}</span>
                <h3 id="legal-actions-title">{messages.settings.legal}</h3>
            </div>
            <div class="service-actions">
                {#if imprintUrl}<SettingsAction
                        href={imprintUrl}
                        label={messages.settings.imprint}
                        icon="legal"
                        newTab
                    />{/if}
                {#if privacyPolicyUrl}<SettingsAction
                        href={privacyPolicyUrl}
                        label={messages.settings.privacyPolicy}
                        icon="privacy"
                        newTab
                    />{/if}
            </div>
        </section>
    {/if}
{/if}
