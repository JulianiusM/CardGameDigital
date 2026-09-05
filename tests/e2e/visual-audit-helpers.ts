import type { Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type VisualAuditOptions = {
    allowSmallTargetSelectors?: string[];
    allowTruncationSelectors?: string[];
    fullPage?: boolean;
    ignoreSelectors?: string[];
};

export type VisualAuditFinding = {
    detail: string;
    selector: string;
};

export type VisualAuditReport = {
    horizontalOverflow: number;
    outOfBounds: VisualAuditFinding[];
    overlaps: VisualAuditFinding[];
    screenshotPath: string;
    smallTargets: VisualAuditFinding[];
    truncations: VisualAuditFinding[];
};

const auditDirectory = path.resolve(".tmp", "visual-audit");

export async function captureVisualAudit(
    page: Page,
    name: string,
    options: VisualAuditOptions = {},
): Promise<VisualAuditReport> {
    await mkdir(auditDirectory, { recursive: true });
    const screenshotPath = path.join(auditDirectory, `${name}.png`);
    await page.screenshot({
        animations: "disabled",
        fullPage: options.fullPage ?? true,
        path: screenshotPath,
    });

    const findings = await page.evaluate((auditOptions) => {
        const interactiveCandidates = [
            "button",
            "a[href]",
            "input",
            "select",
            "textarea",
            "summary",
            "[role='button']",
            "[role='tab']",
        ].join(",");

        const matchesAny = (element: Element, selectors: string[] | undefined): boolean =>
            Boolean(selectors?.some((selector) => element.matches(selector)));
        const isVisible = (element: Element): element is HTMLElement => {
            if (!(element instanceof HTMLElement)) return false;
            let closedDetails = element.closest("details:not([open])");
            while (closedDetails) {
                const summary = [...closedDetails.children].find(
                    (child) => child instanceof HTMLElement && child.matches("summary"),
                );
                if (!(summary instanceof HTMLElement) || !summary.contains(element)) return false;
                closedDetails = closedDetails.parentElement?.closest("details:not([open])") ?? null;
            }
            const style = getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            if (
                style.display === "none" ||
                style.visibility === "hidden" ||
                Number.parseFloat(style.opacity) === 0 ||
                bounds.width <= 0 ||
                bounds.height <= 0
            )
                return false;
            if (element.closest("[aria-hidden='true']")) return false;
            return true;
        };
        const isTopLayerVisible = (element: HTMLElement): boolean => {
            const bounds = element.getBoundingClientRect();
            const x = Math.min(innerWidth - 1, Math.max(0, bounds.left + bounds.width / 2));
            const y = Math.min(innerHeight - 1, Math.max(0, bounds.top + bounds.height / 2));
            const hit = document.elementFromPoint(x, y);
            return Boolean(hit && (element.contains(hit) || hit.contains(element)));
        };
        const selectorFor = (element: HTMLElement): string => {
            if (element.id) return `#${CSS.escape(element.id)}`;
            const className = [...element.classList]
                .slice(0, 3)
                .map((value) => `.${CSS.escape(value)}`)
                .join("");
            const role = element.getAttribute("role");
            const rawName = element.getAttribute("aria-label") ?? element.textContent ?? "";
            const name = rawName.replace(/\s+/g, " ").trim().slice(0, 70);
            const roleSuffix = role ? `[role=${JSON.stringify(role)}]` : "";
            const nameSuffix = name ? ` (${JSON.stringify(name)})` : "";
            return `${element.tagName.toLowerCase()}${className}${roleSuffix}${nameSuffix}`;
        };
        const insideHorizontalScroller = (element: HTMLElement): boolean => {
            let ancestor = element.parentElement;
            while (ancestor) {
                const style = getComputedStyle(ancestor);
                if (
                    /auto|scroll/.test(style.overflowX) &&
                    ancestor.scrollWidth > ancestor.clientWidth + 1
                )
                    return true;
                ancestor = ancestor.parentElement;
            }
            return false;
        };
        const scrollingAncestor = (element: HTMLElement): HTMLElement | undefined => {
            let ancestor = element.parentElement;
            while (ancestor) {
                const style = getComputedStyle(ancestor);
                const scrollsHorizontally =
                    /auto|scroll/.test(style.overflowX) &&
                    ancestor.scrollWidth > ancestor.clientWidth + 1;
                const scrollsVertically =
                    /auto|scroll/.test(style.overflowY) &&
                    ancestor.scrollHeight > ancestor.clientHeight + 1;
                if (scrollsHorizontally || scrollsVertically) return ancestor;
                ancestor = ancestor.parentElement;
            }
            return undefined;
        };
        const intersectsPaintedScrollRegion = (element: HTMLElement): boolean => {
            const bounds = element.getBoundingClientRect();
            let ancestor = element.parentElement;
            while (ancestor) {
                const style = getComputedStyle(ancestor);
                const ancestorBounds = ancestor.getBoundingClientRect();
                if (
                    /auto|scroll|hidden|clip/.test(style.overflowX) &&
                    (bounds.right <= ancestorBounds.left || bounds.left >= ancestorBounds.right)
                )
                    return false;
                if (
                    /auto|scroll|hidden|clip/.test(style.overflowY) &&
                    (bounds.bottom <= ancestorBounds.top || bounds.top >= ancestorBounds.bottom)
                )
                    return false;
                ancestor = ancestor.parentElement;
            }
            return true;
        };
        const directTextNodes = (element: HTMLElement): Text[] =>
            [...element.childNodes].filter(
                (node): node is Text =>
                    node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
            );
        const textRects = (element: HTMLElement): DOMRect[] =>
            directTextNodes(element).flatMap((node) => {
                const range = document.createRange();
                range.selectNodeContents(node);
                return [...range.getClientRects()].filter(
                    ({ width, height }) => width > 0.5 && height > 0.5,
                );
            });
        const descendantTextRects = (element: HTMLElement): DOMRect[] => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const rects: DOMRect[] = [];
            let node = walker.nextNode();
            while (node) {
                const parent = node.parentElement;
                if (node.textContent?.trim() && parent && isVisible(parent)) {
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    for (const rect of range.getClientRects()) {
                        let left = rect.left;
                        let right = rect.right;
                        let top = rect.top;
                        let bottom = rect.bottom;
                        let ancestor: HTMLElement | null = parent;
                        // Text scrolled inside a control is intentionally outside the
                        // reading window; its painted portion must still fit the control.
                        while (ancestor && ancestor !== element) {
                            const style = getComputedStyle(ancestor);
                            const bounds = ancestor.getBoundingClientRect();
                            if (/auto|scroll/.test(style.overflowX)) {
                                left = Math.max(left, bounds.left);
                                right = Math.min(right, bounds.right);
                            }
                            if (/auto|scroll/.test(style.overflowY)) {
                                top = Math.max(top, bounds.top);
                                bottom = Math.min(bottom, bounds.bottom);
                            }
                            ancestor = ancestor.parentElement;
                        }
                        if (right > left && bottom > top)
                            rects.push(new DOMRect(left, top, right - left, bottom - top));
                    }
                }
                node = walker.nextNode();
            }
            return rects;
        };
        const paintedTextRects = (element: HTMLElement): DOMRect[] =>
            textRects(element).flatMap((rect) => {
                let left = rect.left;
                let right = rect.right;
                let top = rect.top;
                let bottom = rect.bottom;
                let current: HTMLElement | null = element;
                while (current && current !== document.body) {
                    const style = getComputedStyle(current);
                    const bounds = current.getBoundingClientRect();
                    if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
                        left = Math.max(left, bounds.left + current.clientLeft);
                        right = Math.min(
                            right,
                            bounds.left + current.clientLeft + current.clientWidth,
                        );
                    }
                    if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
                        top = Math.max(top, bounds.top + current.clientTop);
                        bottom = Math.min(
                            bottom,
                            bounds.top + current.clientTop + current.clientHeight,
                        );
                    }
                    current = current.parentElement;
                }
                if (right <= left || bottom <= top) return [];
                return [new DOMRect(left, top, right - left, bottom - top)];
            });
        const clips = (overflow: string): boolean => /hidden|clip/.test(overflow);
        const clippingAncestors = (element: HTMLElement): HTMLElement[] => {
            const ancestors: HTMLElement[] = [];
            let current: HTMLElement | null = element;
            while (current && current !== document.body) {
                const style = getComputedStyle(current);
                const pager = current.closest<HTMLElement>(".auto-page-text[data-page-count]");
                const isMeasuredPageViewport =
                    current.matches(".auto-page-text-viewport") &&
                    Number(pager?.dataset.pageCount ?? "1") > 1;
                if (!isMeasuredPageViewport && (clips(style.overflowX) || clips(style.overflowY)))
                    ancestors.push(current);
                current = current.parentElement;
            }
            return ancestors;
        };
        const rectEscapes = (rect: DOMRect, container: DOMRect): boolean =>
            rect.left < container.left - 2 ||
            rect.right > container.right + 2 ||
            rect.top < container.top - 2 ||
            rect.bottom > container.bottom + 2;

        const outOfBounds: VisualAuditFinding[] = [];
        const truncations: VisualAuditFinding[] = [];
        const smallTargets: VisualAuditFinding[] = [];
        const allVisible = [...document.querySelectorAll("body *")].filter(
            (element): element is HTMLElement =>
                isVisible(element) &&
                intersectsPaintedScrollRegion(element) &&
                !matchesAny(element, auditOptions.ignoreSelectors),
        );
        const visible = allVisible.filter(
            (element) =>
                directTextNodes(element).length > 0 || element.matches(interactiveCandidates),
        );
        const visibleSet = new Set(visible);
        for (const element of allVisible) {
            const bounds = element.getBoundingClientRect();
            if (
                (bounds.left < -1 || bounds.right > innerWidth + 1) &&
                !insideHorizontalScroller(element)
            ) {
                outOfBounds.push({
                    selector: selectorFor(element),
                    detail: `left=${bounds.left.toFixed(1)}, right=${bounds.right.toFixed(1)}, viewport=${innerWidth}`,
                });
            }

            if (!visibleSet.has(element)) continue;

            const style = getComputedStyle(element);
            const ownsIntentionalScroller =
                (/auto|scroll/.test(style.overflowX) &&
                    element.scrollWidth > element.clientWidth + 1) ||
                (/auto|scroll/.test(style.overflowY) &&
                    element.scrollHeight > element.clientHeight + 1);
            const horizontallyClipped =
                element.scrollWidth > element.clientWidth + 2 && clips(style.overflowX);
            const verticallyClipped =
                element.scrollHeight > element.clientHeight + 2 && clips(style.overflowY);
            const ownTextRects = textRects(element);
            const escapedClippingAncestor =
                ownsIntentionalScroller || scrollingAncestor(element)
                    ? undefined
                    : clippingAncestors(element).find((ancestor) => {
                          const ancestorBounds = ancestor.getBoundingClientRect();
                          return ownTextRects.some((textRect) =>
                              rectEscapes(textRect, ancestorBounds),
                          );
                      });
            const lineClamped =
                style.webkitLineClamp !== "none" &&
                Number.parseInt(style.webkitLineClamp, 10) > 0 &&
                element.scrollHeight > element.clientHeight + 2;
            if (
                ownTextRects.length > 0 &&
                (horizontallyClipped ||
                    verticallyClipped ||
                    lineClamped ||
                    Boolean(escapedClippingAncestor)) &&
                !matchesAny(element, auditOptions.allowTruncationSelectors) &&
                !element.matches("input, textarea, select")
            ) {
                truncations.push({
                    selector: selectorFor(element),
                    detail: `client=${element.clientWidth}x${element.clientHeight}, scroll=${element.scrollWidth}x${element.scrollHeight}, overflow=${style.overflowX}/${style.overflowY}, clippedBy=${escapedClippingAncestor ? selectorFor(escapedClippingAncestor) : "self"}`,
                });
            }
        }

        const interactives = [...document.querySelectorAll(interactiveCandidates)].filter(
            (element): element is HTMLElement =>
                isVisible(element) &&
                isTopLayerVisible(element) &&
                !element.matches(".visually-hidden-input, [type='hidden']") &&
                !matchesAny(element, auditOptions.ignoreSelectors),
        );
        for (const element of interactives) {
            const bounds = element.getBoundingClientRect();
            const wrappingLabel = element.matches("input[type='checkbox'], input[type='radio']")
                ? element.closest("label")
                : null;
            const wrappingLabelBounds = wrappingLabel?.getBoundingClientRect();
            const labelSuppliesTarget = Boolean(
                wrappingLabelBounds &&
                wrappingLabelBounds.width >= 44 &&
                wrappingLabelBounds.height >= 44,
            );
            if (
                (bounds.width < 44 || bounds.height < 44) &&
                !labelSuppliesTarget &&
                !matchesAny(element, auditOptions.allowSmallTargetSelectors)
            ) {
                smallTargets.push({
                    selector: selectorFor(element),
                    detail: `${bounds.width.toFixed(1)}x${bounds.height.toFixed(1)}`,
                });
            }
            if (
                element.matches("button, a[href], summary, [role='button'], [role='tab']") &&
                !matchesAny(element, auditOptions.allowTruncationSelectors)
            ) {
                const escapedTextRects = descendantTextRects(element).filter((rect) =>
                    rectEscapes(rect, bounds),
                );
                if (escapedTextRects.length > 0) {
                    const paintedLeft = Math.min(...escapedTextRects.map((rect) => rect.left));
                    const paintedTop = Math.min(...escapedTextRects.map((rect) => rect.top));
                    const paintedRight = Math.max(...escapedTextRects.map((rect) => rect.right));
                    const paintedBottom = Math.max(...escapedTextRects.map((rect) => rect.bottom));
                    truncations.push({
                        selector: selectorFor(element),
                        detail: `painted text escapes control: control=${bounds.left.toFixed(1)},${bounds.top.toFixed(1)},${bounds.right.toFixed(1)},${bounds.bottom.toFixed(1)}, escaped=${paintedLeft.toFixed(1)},${paintedTop.toFixed(1)},${paintedRight.toFixed(1)},${paintedBottom.toFixed(1)}`,
                    });
                }
            }
        }

        for (const selectedTab of document.querySelectorAll<HTMLElement>(
            "[role='tab'][aria-selected='true']",
        )) {
            if (!isVisible(selectedTab)) continue;
            const tabViewport = selectedTab.closest<HTMLElement>(".responsive-tabs");
            if (!tabViewport) continue;
            const viewportBounds = tabViewport.getBoundingClientRect();
            const visibleLeft = viewportBounds.left + tabViewport.clientLeft;
            const visibleRight = visibleLeft + tabViewport.clientWidth;
            const selectedBounds = selectedTab.getBoundingClientRect();
            const selectedTextRects = descendantTextRects(selectedTab);
            const buttonEscapes =
                selectedBounds.left < visibleLeft - 1 || selectedBounds.right > visibleRight + 1;
            const textEscapes = selectedTextRects.some(
                (rect) => rect.left < visibleLeft - 1 || rect.right > visibleRight + 1,
            );
            if (buttonEscapes || textEscapes) {
                truncations.push({
                    selector: selectorFor(selectedTab),
                    detail: `selected tab escapes scroll viewport: tab=${selectedBounds.left.toFixed(1)}..${selectedBounds.right.toFixed(1)}, ink=${selectedTextRects
                        .map((rect) => `${rect.left.toFixed(1)}..${rect.right.toFixed(1)}`)
                        .join(
                            ",",
                        )}, viewport=${visibleLeft.toFixed(1)}..${visibleRight.toFixed(1)}`,
                });
            }
        }

        const placeholderCanvas = document.createElement("canvas");
        const placeholderContext = placeholderCanvas.getContext("2d");
        for (const control of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            "input[placeholder], textarea[placeholder]",
        )) {
            if (!isVisible(control) || control.value || !control.placeholder.trim()) continue;
            const style = getComputedStyle(control);
            const paddingInline =
                Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
            const availableWidth = Math.max(0, control.clientWidth - paddingInline);
            const letterSpacing = Number.parseFloat(style.letterSpacing);

            if (control instanceof HTMLInputElement && placeholderContext) {
                placeholderContext.font = style.font;
                const spacingWidth = Number.isFinite(letterSpacing)
                    ? Math.max(0, control.placeholder.length - 1) * letterSpacing
                    : 0;
                const placeholderWidth =
                    placeholderContext.measureText(control.placeholder).width + spacingWidth;
                if (placeholderWidth > availableWidth + 1) {
                    truncations.push({
                        selector: selectorFor(control),
                        detail: `placeholder cannot fully paint: text=${placeholderWidth.toFixed(1)}, available=${availableWidth.toFixed(1)}, placeholder=${JSON.stringify(control.placeholder)}`,
                    });
                }
                continue;
            }

            const mirror = document.createElement("div");
            mirror.textContent = control.placeholder;
            Object.assign(mirror.style, {
                boxSizing: "border-box",
                font: style.font,
                letterSpacing: style.letterSpacing,
                lineHeight: style.lineHeight,
                overflowWrap: style.overflowWrap,
                padding: "0",
                position: "fixed",
                visibility: "hidden",
                whiteSpace: style.whiteSpace === "pre" ? "pre-wrap" : style.whiteSpace,
                width: `${availableWidth}px`,
            });
            document.body.append(mirror);
            const paddingBlock =
                Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
            const availableHeight = Math.max(0, control.clientHeight - paddingBlock);
            const placeholderHeight = mirror.getBoundingClientRect().height;
            mirror.remove();
            if (placeholderHeight > availableHeight + 1) {
                truncations.push({
                    selector: selectorFor(control),
                    detail: `placeholder cannot fully paint: height=${placeholderHeight.toFixed(1)}, available=${availableHeight.toFixed(1)}, placeholder=${JSON.stringify(control.placeholder)}`,
                });
            }
        }

        const overlapCandidates = visible.filter(isTopLayerVisible);
        const overlaps: VisualAuditFinding[] = [];
        for (let index = 0; index < overlapCandidates.length; index += 1) {
            const first = overlapCandidates[index];
            const firstIsInteractive = first.matches(interactiveCandidates);
            const firstRects = firstIsInteractive
                ? [first.getBoundingClientRect()]
                : paintedTextRects(first);
            for (let peerIndex = index + 1; peerIndex < overlapCandidates.length; peerIndex += 1) {
                const second = overlapCandidates[peerIndex];
                if (first.contains(second) || second.contains(first)) continue;
                if (insideHorizontalScroller(first) || insideHorizontalScroller(second)) continue;
                const firstScroller = scrollingAncestor(first);
                const secondScroller = scrollingAncestor(second);
                if (firstScroller !== secondScroller && (firstScroller || secondScroller)) continue;
                const secondIsInteractive = second.matches(interactiveCandidates);
                const secondRects = secondIsInteractive
                    ? [second.getBoundingClientRect()]
                    : paintedTextRects(second);
                let overlapWidth = 0;
                let overlapHeight = 0;
                for (const firstBounds of firstRects) {
                    for (const secondBounds of secondRects) {
                        const candidateWidth =
                            Math.min(firstBounds.right, secondBounds.right) -
                            Math.max(firstBounds.left, secondBounds.left);
                        const candidateHeight =
                            Math.min(firstBounds.bottom, secondBounds.bottom) -
                            Math.max(firstBounds.top, secondBounds.top);
                        if (candidateWidth > overlapWidth && candidateHeight > overlapHeight) {
                            overlapWidth = candidateWidth;
                            overlapHeight = candidateHeight;
                        }
                    }
                }
                const minimumOverlap = firstIsInteractive || secondIsInteractive ? 2 : 4;
                if (overlapWidth <= minimumOverlap || overlapHeight <= minimumOverlap) continue;
                overlaps.push({
                    selector: `${selectorFor(first)} <> ${selectorFor(second)}`,
                    detail: `${overlapWidth.toFixed(1)}x${overlapHeight.toFixed(1)}`,
                });
            }
        }

        return {
            horizontalOverflow: Math.max(
                0,
                (document.scrollingElement?.scrollWidth ?? document.documentElement.scrollWidth) -
                    innerWidth,
            ),
            outOfBounds,
            overlaps,
            smallTargets,
            truncations,
        };
    }, options);

    const report = { ...findings, screenshotPath };
    await writeFile(
        path.join(auditDirectory, `${name}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
    );
    return report;
}
