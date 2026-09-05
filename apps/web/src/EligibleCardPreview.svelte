<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { cardPolicyApi } from "./cardPolicyApi";
    import { messages } from "./i18n";
    import { panelTransition } from "./motion";
    import type {
        EligibilityPreview,
        RoomEligibilityAccess,
        RoomGameSettings,
    } from "../../../packages/protocol";
    import UiIcon from "./UiIcon.svelte";

    export let settings: RoomGameSettings;
    export let playerCount = 2;
    export let compact = false;
    export let roomAccess: RoomEligibilityAccess | undefined = undefined;

    let preview: EligibilityPreview | null = null;
    let loading = true;
    let failed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestSequence = 0;

    $: requestKey =
        settings.cardLocale.length >= 2
            ? JSON.stringify({
                  settings,
                  playerCount: Math.max(2, playerCount),
                  roomCode: roomAccess?.roomCode,
              })
            : "";
    $: if (requestKey) schedulePreview();

    onMount(() => {
        const refreshAfterPolicyEdit = () => schedulePreview(0);
        window.addEventListener("focus", refreshAfterPolicyEdit);
        return () => window.removeEventListener("focus", refreshAfterPolicyEdit);
    });

    function schedulePreview(delay = 180): void {
        if (timer) clearTimeout(timer);
        const pendingSettings = structuredClone(settings);
        const pendingPlayerCount = Math.max(2, playerCount);
        const sequence = ++requestSequence;
        loading = true;
        failed = false;
        timer = setTimeout(() => {
            const request = roomAccess
                ? cardPolicyApi.roomEligibilityPreview(roomAccess)
                : cardPolicyApi.eligibilityPreview(pendingSettings, pendingPlayerCount);
            void request
                .then((result) => {
                    if (sequence !== requestSequence) return;
                    preview = result;
                    failed = false;
                })
                .catch(() => {
                    if (sequence !== requestSequence) return;
                    preview = null;
                    failed = true;
                })
                .finally(() => {
                    if (sequence === requestSequence) loading = false;
                });
        }, delay);
    }

    onDestroy(() => {
        requestSequence++;
        if (timer) clearTimeout(timer);
    });
</script>

<section
    class:compact
    class:zero={preview?.total === 0}
    class="eligibility-preview"
    aria-live="polite"
    aria-busy={loading}
    in:panelTransition
>
    <span class="eligibility-preview-icon" aria-hidden="true"><UiIcon name="content" /></span>
    <div class="eligibility-preview-copy">
        {#if preview}
            <div class="eligibility-preview-total">
                <strong>{preview.total}</strong>
                <span>
                    <b>{messages.cardManagement.eligibleCards}</b>
                    <small>{messages.cardManagement.eligibleForPlayers(preview.playerCount)}</small>
                </span>
            </div>
            {#if preview.availableAtStart !== preview.total}
                <small class="eligibility-start-count">
                    {messages.cardManagement.availableAtStart(preview.availableAtStart)}
                </small>
            {/if}
            {#if preview.total === 0}
                <p class="eligibility-warning">{messages.cardManagement.eligibilityZero}</p>
            {/if}
        {:else if failed}
            <div>
                <strong>{messages.cardManagement.eligibilityUnavailable}</strong>
                <button class="text-action" type="button" on:click={() => schedulePreview(0)}>
                    {messages.cardManagement.eligibilityRetry}
                </button>
            </div>
        {:else}
            <strong>{messages.cardManagement.eligibilityLoading}</strong>
        {/if}
    </div>
    {#if loading}<span class="eligibility-loading-mark" aria-hidden="true"></span>{/if}
</section>
