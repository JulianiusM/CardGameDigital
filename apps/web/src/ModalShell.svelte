<script lang="ts">
    import { fade, fly } from "svelte/transition";

    export let open = false;
    export let labelledBy: string;
    export let className = "";

    function duration(normal: number): number {
        if (document.documentElement.dataset.reducedMotion === "true") return 0;
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : normal;
    }
    function close(): void {
        open = false;
    }
    function keydown(event: KeyboardEvent): void {
        if (open && event.key === "Escape") close();
    }
    function deactivateDuringOutro(event: Event): void {
        const backdrop = event.currentTarget as HTMLElement;
        backdrop.inert = true;
        backdrop.setAttribute("aria-hidden", "true");
    }
</script>

<svelte:window on:keydown={keydown} />

{#if open}
    <div
        class="modal-backdrop"
        role="presentation"
        aria-hidden={!open}
        on:click={close}
        on:outrostart={deactivateDuringOutro}
        in:fade={{ duration: duration(180) }}
        out:fade={{ duration: duration(160) }}
    >
        <!-- Dialog consumes pointer events so only the backdrop dismisses it. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role a11y_click_events_have_key_events -->
        <div
            class={`settings-modal ${className}`.trim()}
            role="dialog"
            tabindex="-1"
            aria-modal="true"
            aria-labelledby={labelledBy}
            inert={!open}
            on:click|stopPropagation
            in:fly={{ y: 20, duration: duration(260) }}
            out:fly={{ y: 12, duration: duration(180) }}
        >
            <slot />
        </div>
    </div>
{/if}
