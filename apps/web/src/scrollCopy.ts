/** Bound long prose to its existing text area, retaining native scrolling and selection. */
export function scrollCopy(node: HTMLElement, lines = 3) {
    const originalTabIndex = node.getAttribute("tabindex");
    const control = node.closest<HTMLElement>("button, a, summary") ?? node;
    node.classList.add("scroll-copy");
    node.style.setProperty("--copy-lines", String(lines));

    function restoreTabIndex(): void {
        if (originalTabIndex === null) node.removeAttribute("tabindex");
        else node.setAttribute("tabindex", originalTabIndex);
    }
    function measure(): void {
        if (node.scrollHeight > node.clientHeight + 1 && control === node) node.tabIndex = 0;
        else restoreTabIndex();
    }
    function keydown(event: KeyboardEvent): void {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (node.scrollHeight <= node.clientHeight + 1) return;
        let top = node.scrollTop;
        switch (event.key) {
            case "ArrowDown":
                top += 24;
                break;
            case "ArrowUp":
                top -= 24;
                break;
            case "PageDown":
                top += node.clientHeight * 0.8;
                break;
            case "PageUp":
                top -= node.clientHeight * 0.8;
                break;
            case "Home":
                top = 0;
                break;
            case "End":
                top = node.scrollHeight;
                break;
            default:
                return;
        }
        event.preventDefault();
        node.scrollTop = top;
    }
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    const mutation = new MutationObserver(() => {
        node.scrollTop = 0;
        measure();
    });
    mutation.observe(node, { childList: true, characterData: true, subtree: true });
    control.addEventListener("keydown", keydown);
    return {
        destroy(): void {
            resize.disconnect();
            mutation.disconnect();
            control.removeEventListener("keydown", keydown);
            node.classList.remove("scroll-copy");
            node.style.removeProperty("--copy-lines");
            restoreTabIndex();
        },
    };
}
