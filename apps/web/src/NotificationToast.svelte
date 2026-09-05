<script lang="ts">
    import { onDestroy } from "svelte";
    import { scrollNotice } from "./scrollText";
    import { messages } from "./i18n";
    import type { NotificationKind } from "./notifications";
    export let message: string;
    export let notificationId = 0;
    export let onDismiss: () => void;
    export let duration = 5000;
    export let kind: NotificationKind = "info";
    let timer: number | undefined;
    let scheduledId = -1;
    let copy: HTMLElement;

    function dismissWhenRead(): void {
        const readyAt = Number(copy?.dataset.textScrollReadyAt ?? 0);
        if (
            document.hidden ||
            copy?.hasAttribute("data-text-scroll-paused") ||
            performance.now() < readyAt
        ) {
            timer = window.setTimeout(dismissWhenRead, 1000);
            return;
        }
        onDismiss();
    }

    function schedule(): void {
        if (timer) clearTimeout(timer);
        scheduledId = notificationId;
        timer = window.setTimeout(dismissWhenRead, duration);
    }
    $: if (message && notificationId !== scheduledId) schedule();
    onDestroy(() => timer && clearTimeout(timer));
</script>

<aside
    class:notification-error={kind === "error"}
    class:notification-success={kind === "success"}
    class="notification-toast"
    role={kind === "error" ? "alert" : "status"}
    aria-live={kind === "error" ? "assertive" : "polite"}
    aria-atomic="true"
>
    <span class="notification-icon" aria-hidden="true">{kind === "error" ? "!" : "i"}</span>
    <span bind:this={copy} use:scrollNotice>{message}</span>
    <button class="icon" aria-label={messages.settings.dismiss} on:click={onDismiss}>×</button>
</aside>
