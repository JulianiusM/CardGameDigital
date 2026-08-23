<script lang="ts">
    import { messages } from "./i18n";
    export let onOpen: () => void;
</script>

<button class="settings-trigger" aria-label={messages.settings.title} on:click={onOpen}>
    <svg class="gear-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
            d="M12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25ZM19.4 13.5c.05-.49.05-1.01 0-1.5l2-1.56-1.9-3.3-2.36.96a8.1 8.1 0 0 0-1.3-.75L15.5 4.8h-3.8l-.36 2.55c-.46.2-.9.45-1.3.75l-2.36-.96-1.9 3.3 2 1.56a7.4 7.4 0 0 0 0 1.5l-2 1.56 1.9 3.3 2.36-.96c.4.3.84.55 1.3.75l.36 2.55h3.8l.36-2.55c.46-.2.9-.45 1.3-.75l2.36.96 1.9-3.3-2-1.56Z"
        />
    </svg>
</button>
