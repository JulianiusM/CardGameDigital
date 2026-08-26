import { cubicOut } from "svelte/easing";
import { slide, type TransitionConfig } from "svelte/transition";

export function reducedMotion(): boolean {
    return (
        document.documentElement.dataset.reducedMotion === "true" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

export function panelTransition(): TransitionConfig {
    if (reducedMotion()) return { duration: 200, css: (t) => `opacity: ${t}` };
    return {
        duration: 280,
        easing: cubicOut,
        css: (t) => `opacity: ${t}; transform: translateY(${(1 - t) * 12}px)`,
    };
}

export function revealTransition(node: Element): TransitionConfig {
    if (reducedMotion()) return { duration: 200, css: (t) => `opacity: ${t}` };
    return slide(node, { duration: 260, easing: cubicOut, axis: "y" });
}

export function animateState(node: HTMLElement, value: unknown) {
    let previous = value;
    return {
        update(next: unknown): void {
            if (Object.is(previous, next)) return;
            previous = next;
            const keyframes = reducedMotion()
                ? [{ opacity: 0 }, { opacity: 1 }]
                : [
                      { opacity: 0, transform: "translateY(8px)" },
                      { opacity: 1, transform: "translateY(0)" },
                  ];
            node.animate(keyframes, {
                duration: reducedMotion() ? 200 : 260,
                easing: "cubic-bezier(0.2, 0.75, 0.2, 1)",
            });
        },
    };
}
