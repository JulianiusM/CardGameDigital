<script lang="ts">
    import { cubicOut } from "svelte/easing";
    import { fade, type TransitionConfig } from "svelte/transition";

    export let open = false;
    export let labelledBy: string;
    export let className = "";

    function reducedMotion(): boolean {
        return (
            document.documentElement.dataset.reducedMotion === "true" ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
    }
    function duration(normal: number): number {
        return reducedMotion() ? 200 : normal;
    }
    function modalIn(): TransitionConfig {
        if (reducedMotion()) return { duration: 200, css: (t) => `opacity: ${t}` };
        return {
            duration: 260,
            easing: cubicOut,
            css: (t) =>
                `opacity: ${t}; transform: translateY(${(1 - t) * 20}px) scale(${0.97 + t * 0.03})`,
        };
    }
    function modalOut(): TransitionConfig {
        if (reducedMotion()) return { duration: 200, css: (t) => `opacity: ${t}` };
        return {
            duration: 180,
            easing: cubicOut,
            css: (t) =>
                `opacity: ${t}; transform: translateY(${(1 - t) * 12}px) scale(${0.98 + t * 0.02})`,
        };
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
    function activateDuringIntro(event: Event): void {
        const backdrop = event.currentTarget as HTMLElement;
        backdrop.inert = false;
        backdrop.setAttribute("aria-hidden", "false");
    }
</script>

<svelte:window on:keydown={keydown} />

{#if open}
    <div
        class="modal-backdrop"
        role="presentation"
        aria-hidden={!open}
        on:click={close}
        on:introstart={activateDuringIntro}
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
            in:modalIn
            out:modalOut
        >
            <slot />
        </div>
    </div>
{/if}
