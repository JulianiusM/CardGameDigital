import { reducedMotion } from "./motion";

/** Keep variable labels inside their text slot, with native touch/keyboard access. */
export function scrollText(node: HTMLElement, passive = false) {
    return createTextScroller(node, passive, false);
}

/** Notifications reveal long copy within two lines, including on passive displays. */
export function scrollNotice(node: HTMLElement) {
    return createTextScroller(node, true, true);
}

function createTextScroller(node: HTMLElement, passive: boolean, vertical: boolean) {
    const originalTabIndex = node.getAttribute("tabindex");
    let frame = 0;
    let measureFrame = 0;
    let visible = false;
    let hovered = false;
    let focused = false;
    let distance = 0;
    let direction = 1;
    let position = 0;
    let previousTime = 0;
    let holdUntil = 0;
    let destroyed = false;
    let inlineDirection = 1;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

    node.classList.add("scroll-text");
    node.classList.toggle("scroll-notice", vertical);

    function visibleSize(): number {
        return vertical ? node.clientHeight : node.clientWidth;
    }
    function scrollDistance(): number {
        if (vertical) return Math.max(0, node.scrollHeight - node.clientHeight);
        return Math.max(0, node.scrollWidth - node.clientWidth);
    }
    function currentPosition(): number {
        return vertical ? node.scrollTop : node.scrollLeft * inlineDirection;
    }
    function moveTo(next: number): void {
        if (vertical) node.scrollTop = next;
        else node.scrollLeft = next * inlineDirection;
    }

    function restoreTabIndex(): void {
        if (originalTabIndex === null) node.removeAttribute("tabindex");
        else node.setAttribute("tabindex", originalTabIndex);
    }

    function restart(): void {
        window.cancelAnimationFrame(frame);
        previousTime = 0;
        holdUntil = performance.now() + 1800;
        const readingTime = reducedMotion()
            ? 1800 + Math.ceil(distance / Math.max(1, visibleSize() * 0.8)) * 4800
            : 3600 + (distance / 28) * 1000;
        node.dataset.textScrollDuration = String(Math.ceil(readingTime));
        node.dataset.textScrollReadyAt = String(performance.now() + readingTime);
        node.toggleAttribute("data-text-scroll-paused", distance > 1 && (hovered || focused));
        if (distance > 1 && visible && !document.hidden && !hovered && !focused) {
            if (passive || !reducedMotion()) frame = window.requestAnimationFrame(advance);
        }
    }

    function advance(time: number): void {
        const elapsed = previousTime ? Math.min(time - previousTime, 100) : 0;
        previousTime = time;
        if (time >= holdUntil) {
            if (reducedMotion()) {
                // Passive displays remain readable without continuous motion or input.
                position = Math.min(distance, position + visibleSize() * 0.8);
                if (direction < 0) position = 0;
                direction = position >= distance ? -1 : 1;
                holdUntil = time + 4800;
            } else {
                position = Math.max(0, Math.min(distance, position + direction * elapsed * 0.028));
                if (position >= distance || position <= 0) {
                    direction *= -1;
                    holdUntil = time + 1800;
                }
            }
            moveTo(position);
        }
        frame = window.requestAnimationFrame(advance);
    }

    function measure(): void {
        inlineDirection = getComputedStyle(node).direction === "rtl" ? -1 : 1;
        distance = scrollDistance();
        node.toggleAttribute("data-text-overflow", distance > 1);
        // Start alignment makes the entire line reachable, including text that
        // initially overflowed both sides of a centered label.
        distance = scrollDistance();
        if (distance > 1 && (!passive || vertical) && !node.closest("button, a, summary"))
            node.tabIndex = 0;
        else restoreTabIndex();
        position = 0;
        direction = 1;
        moveTo(0);
        restart();
    }

    function queueMeasurement(): void {
        window.cancelAnimationFrame(measureFrame);
        measureFrame = window.requestAnimationFrame(measure);
    }

    function pointerEnter(): void {
        hovered = true;
        restart();
    }
    function pointerLeave(): void {
        hovered = false;
        position = currentPosition();
        restart();
    }
    function focusIn(): void {
        focused = true;
        restart();
    }
    function focusOut(): void {
        focused = false;
        position = currentPosition();
        restart();
    }
    function manualScroll(): void {
        position = currentPosition();
        holdUntil = performance.now() + 4800;
    }
    function scrolled(): void {
        if (Math.abs(currentPosition() - position) > 1) manualScroll();
    }
    function keydown(event: KeyboardEvent): void {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        let next = currentPosition();
        switch (event.key) {
            case "ArrowRight":
                if (vertical) return;
                next += visibleSize() * 0.8 * inlineDirection;
                break;
            case "ArrowLeft":
                if (vertical) return;
                next -= visibleSize() * 0.8 * inlineDirection;
                break;
            case "ArrowDown":
            case "PageDown":
                if (!vertical) return;
                next += visibleSize() * 0.8;
                break;
            case "ArrowUp":
            case "PageUp":
                if (!vertical) return;
                next -= visibleSize() * 0.8;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = distance;
                break;
            default:
                return;
        }
        event.preventDefault();
        moveTo(next);
        manualScroll();
    }

    const resizeObserver = new ResizeObserver(queueMeasurement);
    resizeObserver.observe(node);
    const textObserver = new MutationObserver(queueMeasurement);
    textObserver.observe(node, { childList: true, characterData: true, subtree: true });
    const preferenceObserver = new MutationObserver(restart);
    preferenceObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-reduced-motion"],
    });
    const intersectionObserver = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        restart();
    });
    intersectionObserver.observe(node);
    const listeners: [string, EventListener][] = [
        ["pointerenter", pointerEnter],
        ["pointerleave", pointerLeave],
        ["focusin", focusIn],
        ["focusout", focusOut],
        ["pointerdown", manualScroll],
        ["wheel", manualScroll],
        ["scroll", scrolled],
        ["keydown", keydown as EventListener],
    ];
    for (const [event, listener] of listeners) node.addEventListener(event, listener);
    document.addEventListener("visibilitychange", restart);
    motionPreference.addEventListener("change", restart);
    void document.fonts.ready.then(() => {
        if (!destroyed) queueMeasurement();
    });
    queueMeasurement();

    return {
        update(nextPassive: boolean): void {
            passive = nextPassive;
            queueMeasurement();
        },
        destroy(): void {
            destroyed = true;
            window.cancelAnimationFrame(frame);
            window.cancelAnimationFrame(measureFrame);
            resizeObserver.disconnect();
            textObserver.disconnect();
            preferenceObserver.disconnect();
            intersectionObserver.disconnect();
            for (const [event, listener] of listeners) node.removeEventListener(event, listener);
            document.removeEventListener("visibilitychange", restart);
            motionPreference.removeEventListener("change", restart);
            node.classList.remove("scroll-text");
            node.classList.remove("scroll-notice");
            node.removeAttribute("data-text-overflow");
            node.removeAttribute("data-text-scroll-duration");
            node.removeAttribute("data-text-scroll-ready-at");
            node.removeAttribute("data-text-scroll-paused");
            restoreTabIndex();
        },
    };
}
