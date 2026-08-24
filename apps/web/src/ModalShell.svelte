<script lang="ts">
    import { cubicOut } from "svelte/easing";
    import { onDestroy, tick } from "svelte";
    import { fade, type TransitionConfig } from "svelte/transition";

    export let open = false;
    export let labelledBy: string;
    export let className = "";

    let backdrop: HTMLElement;
    let dialog: HTMLElement;
    let wasOpen = false;
    let returnFocus: HTMLElement | null = null;
    let outsideState: Array<{
        element: HTMLElement;
        inert: boolean;
        ariaHidden: string | null;
    }> = [];

    $: if (open && !wasOpen) {
        wasOpen = true;
        void activateModal();
    }
    $: if (!open && wasOpen) {
        wasOpen = false;
        restoreOutside();
        returnFocus?.focus();
        returnFocus = null;
    }

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
        if (!open) return;
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }
        if (event.key !== "Tab") return;
        const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector())].filter(
            (element) => element.getClientRects().length > 0,
        );
        if (!focusable.length) {
            event.preventDefault();
            dialog.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
    function focusableSelector(): string {
        return [
            "button:not([disabled])",
            "a[href]",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            '[tabindex]:not([tabindex="-1"])',
        ].join(",");
    }
    async function activateModal(): Promise<void> {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        await tick();
        if (!open || !backdrop || !dialog) return;
        disableOutside(backdrop);
        const first = [...dialog.querySelectorAll<HTMLElement>(focusableSelector())].find(
            (element) => element.getClientRects().length > 0,
        );
        (first ?? dialog).focus();
    }
    function disableOutside(branch: HTMLElement): void {
        restoreOutside();
        let current: HTMLElement | null = branch;
        while (current?.parentElement) {
            for (const sibling of current.parentElement.children) {
                if (sibling === current || !(sibling instanceof HTMLElement)) continue;
                outsideState.push({
                    element: sibling,
                    inert: sibling.inert,
                    ariaHidden: sibling.getAttribute("aria-hidden"),
                });
                sibling.inert = true;
                sibling.setAttribute("aria-hidden", "true");
            }
            current = current.parentElement;
            if (current === document.body) break;
        }
    }
    function restoreOutside(): void {
        for (const state of outsideState) {
            state.element.inert = state.inert;
            if (state.ariaHidden === null) state.element.removeAttribute("aria-hidden");
            else state.element.setAttribute("aria-hidden", state.ariaHidden);
        }
        outsideState = [];
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
    onDestroy(restoreOutside);
</script>

<svelte:window on:keydown={keydown} />

{#if open}
    <div
        bind:this={backdrop}
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
            bind:this={dialog}
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
