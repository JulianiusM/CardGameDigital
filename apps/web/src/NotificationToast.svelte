<script lang="ts">
    import { onDestroy } from "svelte";
    import { messages } from "./i18n";
    import type { NotificationKind } from "./notifications";
    export let message: string;
    export let notificationId = 0;
    export let onDismiss: () => void;
    export let duration = 5000;
    export let kind: NotificationKind = "info";
    let timer: number | undefined;
    let scheduledId = -1;

    function schedule(): void {
        if (timer) clearTimeout(timer);
        scheduledId = notificationId;
        timer = window.setTimeout(onDismiss, duration);
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
    <span>{message}</span>
    <button class="icon" aria-label={messages.settings.dismiss} on:click={onDismiss}>×</button>
</aside>
