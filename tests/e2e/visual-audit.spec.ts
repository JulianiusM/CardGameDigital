import {
    expect,
    test,
    type Browser,
    type Locator,
    type Page,
    type TestInfo,
} from "@playwright/test";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION, type RoomJoinResponse } from "../../packages/protocol";
import {
    captureVisualAudit,
    waitForPaint,
    type VisualAuditOptions,
    type VisualAuditReport,
} from "./visual-audit-helpers";

test.beforeEach(async ({ context, page }) => {
    await context.addInitScript(() => {
        localStorage.setItem("party-game.locale", "de");
        localStorage.setItem("party-game.reduced-motion", "true");
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
});

async function audit(
    page: Page,
    testInfo: TestInfo,
    name: string,
    options: VisualAuditOptions = {},
): Promise<VisualAuditReport> {
    await waitForPaint(page);
    const report = await captureVisualAudit(page, name, options);
    await testInfo.attach(`${name}-geometry`, {
        body: Buffer.from(JSON.stringify(report, null, 2)),
        contentType: "application/json",
    });
    console.log(`[visual-audit] ${name}\n${JSON.stringify(report, null, 2)}`);
    expect.soft(report.horizontalOverflow, `${name}: document horizontal overflow`).toBe(0);
    expect.soft(report.outOfBounds, `${name}: visible content outside viewport`).toEqual([]);
    expect.soft(report.overlaps, `${name}: overlapping visible content`).toEqual([]);
    expect.soft(report.truncations, `${name}: clipped or truncated text`).toEqual([]);
    expect
        .soft(report.smallTargets, `${name}: interactive targets below 44 CSS pixels`)
        .toEqual([]);
    return report;
}

async function auditViewportSegment(
    page: Page,
    testInfo: TestInfo,
    anchor: Locator,
    name: string,
    block: ScrollLogicalPosition = "start",
): Promise<VisualAuditReport> {
    await anchor.evaluate(
        (element, requestedBlock) =>
            element.scrollIntoView({ block: requestedBlock, inline: "nearest" }),
        block,
    );
    await expect(anchor).toBeInViewport({ ratio: 0.001 });
    return audit(page, testInfo, name, { fullPage: false });
}

async function auditTextScrollSegment(
    page: Page,
    testInfo: TestInfo,
    element: Locator,
    name: string,
    fraction: number,
): Promise<VisualAuditReport> {
    await element.evaluate((node, requestedFraction) => {
        node.scrollIntoView({ block: "center" });
        node.scrollTop = (node.scrollHeight - node.clientHeight) * requestedFraction;
    }, fraction);
    await expect(element).toBeInViewport({ ratio: 0.001 });
    return audit(page, testInfo, name, { fullPage: false });
}

async function expectRenderedRosterItemsContained(page: Page): Promise<void> {
    const failures = await page
        .locator(".public-stage-lobby .stage-player")
        .evaluateAll((players) =>
            players.flatMap((player) => {
                const content = player.closest(".auto-page-content");
                const roster = player.closest(".stage-player-roster");
                if (!(content instanceof HTMLElement) || !(roster instanceof HTMLElement)) {
                    return ["missing roster containers"];
                }
                const item = player.getBoundingClientRect();
                return [content, roster].flatMap((container) => {
                    const bounds = container.getBoundingClientRect();
                    const contained =
                        item.left >= bounds.left - 0.5 &&
                        item.right <= bounds.right + 0.5 &&
                        item.top >= bounds.top - 0.5 &&
                        item.bottom <= bounds.bottom + 0.5;
                    if (contained) return [];
                    return [
                        `${player.textContent?.trim()}: ${item.left},${item.top},${item.right},${item.bottom} outside ${container.className}: ${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`,
                    ];
                });
            }),
        );
    expect(failures).toEqual([]);
}

function maximumName(index: number): string {
    // Character limits alone do not bound painted width: wide glyphs must fit too.
    const glyph = index % 2 === 0 ? "界" : "W";
    return `${String(index).padStart(2, "0")}-`.padEnd(40, glyph).slice(0, 40);
}

const cardEndMarker = "_CARD_END";
const roomUrlEndMarker = "ROOM_URL_END";
const ruleEndMarker = "_RULE_END";
const searchEndMarker = "_SEARCH_END";
const localeEndMarker = "_LOCALE_END";
const ordinaryCardText = "Welche kleine Entscheidung würdest du heute rückblickend anders treffen?";

function maximumMarkedText(length: number, prefix: string, marker: string): string {
    return prefix
        .padEnd(length - marker.length, "X")
        .slice(0, length - marker.length)
        .concat(marker);
}

function maximumRuleName(index: number): string {
    return maximumMarkedText(100, `Regel-${String(index).padStart(4, "0")}-`, ruleEndMarker);
}

function maximumSearchText(): string {
    return maximumMarkedText(200, "Kartensuche-", searchEndMarker);
}

function maximumLocaleName(): string {
    return maximumMarkedText(80, "Karteninhaltssprache-", localeEndMarker);
}

function maximumCardText(): string {
    const prefix =
        "Diese visuelle Extremfallkarte muss mit vollständigen zehntausend Zeichen lesbar bleiben. ";
    const unbreakable =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const repeated = `${prefix}${unbreakable} `;
    const body = repeated
        .repeat(Math.ceil(10_000 / repeated.length))
        .slice(0, 10_000 - cardEndMarker.length);
    return `${body}${cardEndMarker}`;
}

function maximumRoomUrl(): string {
    const prefix = "https://party.example.test/";
    return `${prefix}${"sehr-langer-pfad/".repeat(110)}?room=ABCDEF#${roomUrlEndMarker}`;
}

const visibleAutoPageCopy = ".auto-page-copy:not(.auto-page-measure)";

async function injectAutoPageSource(copy: Locator, source: string): Promise<void> {
    await copy.evaluate((element, nextSource) => {
        const textNode = element.firstChild;
        if (textNode instanceof Text) {
            textNode.data = nextSource;
            return;
        }
        element.append(document.createTextNode(nextSource));
    }, source);
}

async function expectMeasuredPages(pager: Locator): Promise<number> {
    await expect
        .poll(async () => Number(await pager.getAttribute("data-page-count")))
        .toBeGreaterThan(1);
    let previousLayout = "";
    let stableSamples = 0;
    for (let sample = 0; sample < 30 && stableSamples < 3; sample += 1) {
        await pager.evaluate(() => new Promise<void>((resolve) => window.setTimeout(resolve, 80)));
        const layout = await pager.evaluate((element) =>
            [
                element.getAttribute("data-page-count"),
                element.getAttribute("data-page-size"),
                element.getAttribute("data-maximum-page-size"),
            ].join(":"),
        );
        if (layout === previousLayout) stableSamples += 1;
        else stableSamples = 0;
        previousLayout = layout;
    }
    expect(stableSamples, `pager layout did not settle: ${previousLayout}`).toBeGreaterThanOrEqual(
        3,
    );
    const pageCount = Number(await pager.getAttribute("data-page-count"));
    expect(pageCount).toBeGreaterThan(1);
    return pageCount;
}

async function selectMeasuredPage(pager: Locator, page: number): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const pageCount = Number(await pager.getAttribute("data-page-count"));
        const boundedPage = Math.min(Math.max(0, page), Math.max(0, pageCount - 1));
        await pager.evaluate((element, requestedPage) => {
            element.dispatchEvent(
                new CustomEvent("autopage-request", {
                    bubbles: false,
                    detail: { page: requestedPage },
                }),
            );
        }, boundedPage);
        await pager.evaluate(
            () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
        );
        if ((await pager.getAttribute("data-page")) === String(boundedPage)) return;
        await expectMeasuredPages(pager);
    }
    expect(await pager.getAttribute("data-page")).toBe(String(page));
}

async function expectAutoPageCopyPainted(pager: Locator): Promise<void> {
    const copy = pager.locator(visibleAutoPageCopy);
    if ((await copy.count()) === 0) return;
    const paint = await copy.evaluate((element) => {
        const viewport = element.closest<HTMLElement>(".auto-page-text-viewport");
        const textNode = Array.from(element.childNodes).find(
            (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
        );
        const range = document.createRange();
        if (textNode) range.selectNodeContents(textNode);
        const textRects = textNode
            ? Array.from(range.getClientRects()).filter(
                  ({ width, height }) => width > 0.5 && height > 0.5,
              )
            : [];
        const bounds = viewport?.getBoundingClientRect();
        return {
            clientHeight: (element as HTMLElement).clientHeight,
            text: element.textContent ?? "",
            textRectCount: textRects.length,
            withinViewport:
                bounds !== undefined &&
                textRects.every(
                    (rect) =>
                        rect.left >= bounds.left - 0.5 &&
                        rect.right <= bounds.right + 0.5 &&
                        rect.top >= bounds.top - 0.5 &&
                        rect.bottom <= bounds.bottom + 0.5,
                ),
        };
    });
    expect(paint.text.trim()).not.toBe("");
    expect(paint.clientHeight).toBeGreaterThan(0);
    expect(paint.textRectCount).toBeGreaterThan(0);
    expect(paint.withinViewport).toBe(true);
}

async function expectDisplayGameplayVisible(page: Page, result = false): Promise<void> {
    await expect(page.locator(".reconnect-panel")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator(".never-voting")).toBeVisible({ timeout: 20_000 });
    if (result) {
        await expect(page.locator(".never-result-columns")).toBeVisible({ timeout: 20_000 });
    }
}

async function expectPaintedAutoPageItem(page: Page, selector: string): Promise<void> {
    const item = page.locator(selector).first();
    await expect(item).toBeVisible({ timeout: 20_000 });
    const paint = await item.evaluate((element) => {
        const content = element.closest<HTMLElement>(".auto-page-content");
        const textRects: DOMRect[] = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode();
        while (textNode) {
            if (textNode.textContent?.trim()) {
                const range = document.createRange();
                range.selectNodeContents(textNode);
                const scroller = textNode.parentElement?.closest<HTMLElement>(".scroll-text");
                collectPaintedText(range, scroller);
            }
            textNode = walker.nextNode();
        }
        const bounds = content?.getBoundingClientRect();
        return {
            contentBounds: bounds
                ? { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }
                : null,
            itemBounds: (() => {
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            })(),
            text: element.textContent ?? "",
            textRectCount: textRects.length,
            textRects: textRects.map(({ left, right, top, bottom }) => ({
                left,
                right,
                top,
                bottom,
            })),
            withinContent:
                bounds !== undefined &&
                textRects.every(
                    (rect) =>
                        rect.left >= bounds.left - 0.5 &&
                        rect.right <= bounds.right + 0.5 &&
                        rect.top >= bounds.top - 0.5 &&
                        rect.bottom <= bounds.bottom + 0.5,
                ),
        };

        function collectPaintedText(range: Range, scroller: HTMLElement | null | undefined) {
            for (const rect of range.getClientRects()) {
                if (!scroller) {
                    textRects.push(rect);
                    continue;
                }
                const slot = scroller.getBoundingClientRect();
                const left = Math.max(rect.left, slot.left);
                const right = Math.min(rect.right, slot.right);
                if (right > left)
                    textRects.push(new DOMRect(left, rect.top, right - left, rect.height));
            }
        }
    });
    expect(paint.text.trim()).not.toBe("");
    expect(paint.textRectCount).toBeGreaterThan(0);
    expect(paint.withinContent, JSON.stringify(paint)).toBe(true);
}

async function expectMarkerPaintedWithin(
    locator: Locator,
    marker: string,
    boundarySelector: string,
): Promise<void> {
    await expect(locator).toContainText(marker);
    await locator.scrollIntoViewIfNeeded();
    const paint = await locator.evaluate(
        (element, { boundarySelector: selector, marker: expectedMarker }) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let node: Node | null = walker.nextNode();
            while (node && !(node.textContent ?? "").includes(expectedMarker)) {
                node = walker.nextNode();
            }
            if (!node) return null;
            const text = node.textContent ?? "";
            const markerStart = text.indexOf(expectedMarker);
            const range = document.createRange();
            range.setStart(node, markerStart);
            range.setEnd(node, markerStart + expectedMarker.length);
            const rects = Array.from(range.getClientRects()).filter(
                ({ width, height }) => width > 0.5 && height > 0.5,
            );
            const boundary = element.closest<HTMLElement>(selector)?.getBoundingClientRect();
            const topmost = rects.every((rect) => {
                const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
                const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
                const painted = document.elementFromPoint(x, y);
                return painted === element || (painted !== null && element.contains(painted));
            });
            return {
                rectCount: rects.length,
                topmost,
                withinBoundary:
                    boundary !== undefined &&
                    rects.every(
                        (rect) =>
                            rect.left >= boundary.left - 0.5 &&
                            rect.right <= boundary.right + 0.5 &&
                            rect.top >= boundary.top - 0.5 &&
                            rect.bottom <= boundary.bottom + 0.5,
                    ),
                withinViewport: rects.every(
                    (rect) =>
                        rect.left >= -0.5 &&
                        rect.right <= window.innerWidth + 0.5 &&
                        rect.top >= -0.5 &&
                        rect.bottom <= window.innerHeight + 0.5,
                ),
            };
        },
        { boundarySelector, marker },
    );
    expect(paint).not.toBeNull();
    expect(paint?.rectCount).toBeGreaterThan(0);
    expect(paint?.withinBoundary, JSON.stringify(paint)).toBe(true);
    expect(paint?.withinViewport, JSON.stringify(paint)).toBe(true);
    expect(paint?.topmost, JSON.stringify(paint)).toBe(true);
}

async function expectElementsDoNotIntersect(first: Locator, second: Locator): Promise<void> {
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    const [firstBounds, secondBounds] = await Promise.all([
        first.boundingBox(),
        second.boundingBox(),
    ]);
    expect(firstBounds).not.toBeNull();
    expect(secondBounds).not.toBeNull();
    const intersection = {
        height: Math.max(
            0,
            Math.min(firstBounds!.y + firstBounds!.height, secondBounds!.y + secondBounds!.height) -
                Math.max(firstBounds!.y, secondBounds!.y),
        ),
        width: Math.max(
            0,
            Math.min(firstBounds!.x + firstBounds!.width, secondBounds!.x + secondBounds!.width) -
                Math.max(firstBounds!.x, secondBounds!.x),
        ),
    };
    expect(
        Math.min(intersection.width, intersection.height),
        JSON.stringify(intersection),
    ).toBeLessThanOrEqual(0.5);
}

async function expectControlTextPaintedWithin(controls: Locator): Promise<void> {
    const failures = await controls.evaluateAll((elements) =>
        elements.flatMap((element) => {
            if (!(element instanceof HTMLElement)) return ["control is not an HTMLElement"];
            const bounds = element.getBoundingClientRect();
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const escaped: string[] = [];
            let node = walker.nextNode();
            while (node) {
                if (node.textContent?.trim()) {
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    collectEscapedText(range, node);
                }
                node = walker.nextNode();
            }
            return escaped.length
                ? [
                      `${element.textContent?.replace(/\s+/g, " ").trim()}: ${escaped.join(" | ")} outside ${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`,
                  ]
                : [];

            function collectEscapedText(range: Range, textNode: Node) {
                for (const rect of range.getClientRects()) {
                    if (rect.width <= 0.5 || rect.height <= 0.5) continue;
                    const contained =
                        rect.left >= bounds.left - 0.5 &&
                        rect.right <= bounds.right + 0.5 &&
                        rect.top >= bounds.top - 0.5 &&
                        rect.bottom <= bounds.bottom + 0.5;
                    if (!contained) {
                        escaped.push(
                            `${textNode.textContent?.trim()}: ${rect.left},${rect.top},${rect.right},${rect.bottom}`,
                        );
                    }
                }
            }
        }),
    );
    expect(failures).toEqual([]);
}

async function expectElementContainedWithin(element: Locator, container: Locator): Promise<void> {
    await expect(element).toBeVisible();
    await expect(container).toBeVisible();
    const [elementBounds, containerBounds] = await Promise.all([
        element.boundingBox(),
        container.boundingBox(),
    ]);
    expect(elementBounds).not.toBeNull();
    expect(containerBounds).not.toBeNull();
    expect(elementBounds!.x).toBeGreaterThanOrEqual(containerBounds!.x - 0.5);
    expect(elementBounds!.y).toBeGreaterThanOrEqual(containerBounds!.y - 0.5);
    expect(elementBounds!.x + elementBounds!.width).toBeLessThanOrEqual(
        containerBounds!.x + containerBounds!.width + 0.5,
    );
    expect(elementBounds!.y + elementBounds!.height).toBeLessThanOrEqual(
        containerBounds!.y + containerBounds!.height + 0.5,
    );
}

async function expectWizardProgressLabelsOnOneLine(page: Page): Promise<void> {
    const lineCounts = await page.locator(".wizard-progress b").evaluateAll((labels) =>
        labels.map((label) => {
            const range = document.createRange();
            range.selectNodeContents(label);
            return range.getClientRects().length;
        }),
    );
    expect(lineCounts.length).toBeGreaterThan(0);
    expect(lineCounts).toEqual(lineCounts.map(() => 1));
}

async function expectElementTopmost(locator: Locator): Promise<void> {
    await expect(locator).toBeVisible();
    const result = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
        const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
        const painted = document.elementFromPoint(x, y);
        return {
            height: rect.height,
            topmost: painted === element || (painted !== null && element.contains(painted)),
            width: rect.width,
        };
    });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.topmost).toBe(true);
}

async function expectModalPaintedAndTopmost(page: Page): Promise<void> {
    const backdrop = page.locator('.modal-backdrop[aria-hidden="false"]');
    const dialog = backdrop.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const backdropCoverage = await backdrop.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth,
        };
    });
    expect(backdropCoverage.left).toBeLessThanOrEqual(0.5);
    expect(backdropCoverage.top).toBeLessThanOrEqual(0.5);
    expect(backdropCoverage.right).toBeGreaterThanOrEqual(backdropCoverage.viewportWidth - 0.5);
    expect(backdropCoverage.bottom).toBeGreaterThanOrEqual(backdropCoverage.viewportHeight - 0.5);
    const dialogCoverage = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth,
        };
    });
    expect(dialogCoverage.left).toBeGreaterThanOrEqual(-0.5);
    expect(dialogCoverage.top).toBeGreaterThanOrEqual(-0.5);
    expect(dialogCoverage.right).toBeLessThanOrEqual(dialogCoverage.viewportWidth + 0.5);
    expect(dialogCoverage.bottom).toBeLessThanOrEqual(dialogCoverage.viewportHeight + 0.5);

    const close = dialog.locator(".close");
    await expect(close).toBeVisible();
    const closeCoverage = await close.evaluate((element) => {
        const buttonBounds = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const inkBounds = range.getBoundingClientRect();
        return {
            buttonBottom: buttonBounds.bottom,
            buttonLeft: buttonBounds.left,
            buttonRight: buttonBounds.right,
            buttonTop: buttonBounds.top,
            inkBottom: inkBounds.bottom,
            inkLeft: inkBounds.left,
            inkRight: inkBounds.right,
            inkTop: inkBounds.top,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth,
        };
    });
    expect(closeCoverage.buttonLeft).toBeGreaterThanOrEqual(-0.5);
    expect(closeCoverage.buttonTop).toBeGreaterThanOrEqual(-0.5);
    expect(closeCoverage.buttonRight).toBeLessThanOrEqual(closeCoverage.viewportWidth + 0.5);
    expect(closeCoverage.buttonBottom).toBeLessThanOrEqual(closeCoverage.viewportHeight + 0.5);
    expect(closeCoverage.inkLeft).toBeGreaterThanOrEqual(closeCoverage.buttonLeft - 0.5);
    expect(closeCoverage.inkTop).toBeGreaterThanOrEqual(closeCoverage.buttonTop - 0.5);
    expect(closeCoverage.inkRight).toBeLessThanOrEqual(closeCoverage.buttonRight + 0.5);
    expect(closeCoverage.inkBottom).toBeLessThanOrEqual(closeCoverage.buttonBottom + 0.5);
    await expectElementTopmost(dialog);
}

async function expectImagePaintedAndTopmost(image: Locator): Promise<void> {
    await expect(image).toBeVisible();
    await image.scrollIntoViewIfNeeded();
    const result = await image.evaluate((element) => {
        if (!(element instanceof HTMLImageElement)) return null;
        const rect = element.getBoundingClientRect();
        const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
        const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
        const painted = document.elementFromPoint(x, y);
        return {
            complete: element.complete,
            height: rect.height,
            naturalHeight: element.naturalHeight,
            naturalWidth: element.naturalWidth,
            topmost: painted === element,
            width: rect.width,
        };
    });
    expect(result).not.toBeNull();
    expect(result?.complete).toBe(true);
    expect(result?.naturalWidth).toBeGreaterThan(0);
    expect(result?.naturalHeight).toBeGreaterThan(0);
    expect(result?.width).toBeGreaterThan(0);
    expect(result?.height).toBeGreaterThan(0);
    expect(result?.topmost).toBe(true);
}

async function auditFirstMiddleLastPages(
    page: Page,
    testInfo: TestInfo,
    pager: Locator,
    namePrefix: string,
    options: VisualAuditOptions = {},
): Promise<void> {
    const captures = ["first", "middle", "last"] as const;
    for (const capture of captures) {
        let capturedRequestedPage = false;
        for (
            let captureAttempt = 0;
            captureAttempt < 4 && !capturedRequestedPage;
            captureAttempt += 1
        ) {
            let selected = false;
            for (let attempt = 0; attempt < 6 && !selected; attempt += 1) {
                const pageCount = await expectMeasuredPages(pager);
                const requestedPage = capturedPageIndex(capture, pageCount);
                await selectMeasuredPage(pager, requestedPage);
                const settledPageCount = await expectMeasuredPages(pager);
                const settledRequestedPage = capturedPageIndex(capture, settledPageCount);
                selected =
                    settledPageCount === pageCount &&
                    (await pager.getAttribute("data-page")) === String(settledRequestedPage);
            }
            if (!selected) continue;
            await expectAutoPageCopyPainted(pager);
            await audit(page, testInfo, `${namePrefix}-${capture}`, options);
            const finalPageCount = Number(await pager.getAttribute("data-page-count"));
            const expectedPage = capturedPageIndex(capture, finalPageCount);
            capturedRequestedPage =
                (await pager.getAttribute("data-page")) === String(expectedPage);
        }
        expect(
            capturedRequestedPage,
            `${namePrefix}-${capture}: screenshot did not preserve the requested page`,
        ).toBe(true);
    }
}

async function expectCompleteTextPages(
    pager: Locator,
    expectedSource: string,
    maximumPageCount?: number,
    expectWordBoundaries = false,
): Promise<number> {
    const pageCount = await expectMeasuredPages(pager);
    if (maximumPageCount !== undefined) expect(pageCount).toBeLessThanOrEqual(maximumPageCount);
    const copy = pager.locator(visibleAutoPageCopy);
    let collected = "";
    const pageTexts: string[] = [];
    const graphemeBoundaries = new Set([0, expectedSource.length]);
    for (const { index } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        expectedSource,
    )) {
        graphemeBoundaries.add(index);
    }
    for (let page = 0; page < pageCount; page += 1) {
        await selectMeasuredPage(pager, page);
        await expectAutoPageCopyPainted(pager);
        const pageText = (await copy.textContent()) ?? "";
        expect(pageText.trim(), `measured page ${page + 1} must paint visible text`).not.toBe("");
        pageTexts.push(pageText);
        collected += pageText;
        expect(graphemeBoundaries.has(collected.length), `page ${page + 1} splits a grapheme`).toBe(
            true,
        );
    }
    expect(await copy.getAttribute("aria-label")).toBe(expectedSource);
    expect(collected).toBe(expectedSource);
    if (expectWordBoundaries) {
        for (let page = 0; page < pageTexts.length - 1; page += 1) {
            const current = pageTexts[page] ?? "";
            const next = pageTexts[page + 1] ?? "";
            expect(
                /\s$/u.test(current) || /^\s/u.test(next),
                `page ${page + 1}/${pageCount} split an ordinary word`,
            ).toBe(true);
        }
    }
    return pageCount;
}

async function chooseStandardHostSetup(page: Page, mode: RegExp): Promise<void> {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: mode }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Gute Freunde / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
}

async function finishHostSetup(
    page: Page,
    device: "couch" | "personal" | "party",
    hostName = "Host Anna",
): Promise<void> {
    await page.getByRole("button", { name: /^Weiter/ }).click();
    const labels = {
        couch: /Nur dieser Bildschirm/,
        party: /TV \+ Smartphones/,
        personal: /Alle mit eigenem Gerät/,
    };
    const name = labels[device];
    await page.getByRole("button", { name }).click();
    if (device === "personal") await page.getByLabel("Name des Hosts").fill(hostName);
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await expect(
        page.getByRole("heading", { name: device === "couch" ? /Wer spielt mit/ : "Lobby" }),
    ).toBeVisible();
}

async function joinDisplay(page: Page, code: string): Promise<void> {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Nur anzeigen/ }).click();
    await page.getByLabel("Raumcode").fill(code);
    await page.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
}

async function joinPlayer(page: Page, code: string, name: string): Promise<void> {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel beitreten/ }).click();
    await page.getByLabel("Dein Name").fill(name);
    await page.getByLabel("Raumcode").fill(code);
    await page.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
}

async function waitForSocketMessage(
    socket: WebSocket,
    predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off("message", onMessage);
            reject(new Error("Timed out waiting for the synthetic Room client"));
        }, 10_000);
        const onMessage = (raw: WebSocket.RawData) => {
            const message = JSON.parse(raw.toString()) as Record<string, unknown>;
            if (!predicate(message)) return;
            clearTimeout(timeout);
            socket.off("message", onMessage);
            resolve(message);
        };
        socket.on("message", onMessage);
    });
}

async function addSyntheticParticipantWithDevicePlayers(
    baseURL: string,
    code: string,
    participantIndex: number,
): Promise<void> {
    const response = await fetch(new URL(`/api/v1/rooms/${code}/participants`, baseURL), {
        method: "POST",
        headers: { "content-type": "application/json", "accept-language": "de-DE" },
        body: JSON.stringify({
            displayName: maximumName(participantIndex * 20 + 1),
            role: "PLAYER",
        }),
    });
    if (!response.ok) {
        throw new Error(
            `Synthetic participant ${participantIndex} failed: ${await response.text()}`,
        );
    }
    const participant = (await response.json()) as RoomJoinResponse;
    const socketUrl = new URL("/ws", baseURL);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(socketUrl);
    await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
    });
    const hello = waitForSocketMessage(socket, (message) => message.type === "server.hello");
    socket.send(
        JSON.stringify({
            protocol: PROTOCOL_VERSION,
            type: "client.hello",
            requestId: `synthetic-hello-${participantIndex}`,
            revision: null,
            payload: {
                supportedProtocolVersions: [PROTOCOL_VERSION],
                applicationVersion: "visual-audit",
                role: participant.role,
                capabilities: [],
                roomCode: code,
                participantCredential: participant.participantCredential,
            },
        }),
    );
    await hello;
    const requestId = `synthetic-device-players-${participantIndex}`;
    const snapshot = waitForSocketMessage(socket, (message) => {
        if (message.type !== "room.snapshot") return false;
        const payload = message.payload as
            { participants?: Array<{ id?: string; devicePlayers?: unknown[] }> } | undefined;
        const current = payload?.participants?.find(({ id }) => id === participant.participantId);
        return current?.devicePlayers?.length === 19;
    });
    socket.send(
        JSON.stringify({
            protocol: PROTOCOL_VERSION,
            type: "command.setDevicePlayers",
            requestId,
            revision: null,
            payload: {
                names: Array.from({ length: 19 }, (_, deviceIndex) =>
                    maximumName(participantIndex * 20 + deviceIndex + 2),
                ),
            },
        }),
    );
    await snapshot;
    socket.terminate();
}

async function populateMaximumCouchRoster(page: Page): Promise<void> {
    const rows = page.locator(".player-name-row");
    await rows.nth(0).getByRole("textbox").fill(maximumName(1));
    await rows.nth(1).getByRole("textbox").fill(maximumName(2));
    for (let index = 3; index <= 20; index += 1) {
        await page.getByRole("button", { name: /Person hinzufügen/ }).click();
        await rows
            .nth(index - 1)
            .getByRole("textbox")
            .fill(maximumName(index));
    }
}

async function hostPartyWithMaximumRoster(
    browser: Browser,
    playerCount = 20,
    wideTaxonomy = false,
): Promise<{
    display: Page;
    displayContext: Awaited<ReturnType<Browser["newContext"]>>;
    host: Page;
    hostContext: Awaited<ReturnType<Browser["newContext"]>>;
}> {
    const hostContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 390, height: 844 },
    });
    const displayContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 800, height: 600 },
    });
    for (const context of [hostContext, displayContext]) {
        if (wideTaxonomy) {
            await context.routeWebSocket(
                () => true,
                (socket) => {
                    const server = socket.connectToServer();
                    server.onMessage((message) => {
                        const envelope = JSON.parse(message.toString());
                        if (
                            envelope.type === "room.snapshot" &&
                            envelope.payload.session?.currentCard
                        ) {
                            envelope.payload.session.currentCard.cardText = maximumCardText();
                        }
                        socket.send(JSON.stringify(envelope));
                    });
                },
            );
            await context.route("**/api/v1/catalog/taxonomies?*", async (route) => {
                const response = await route.fetch();
                const taxonomy = await response.json();
                for (const entry of [...taxonomy.questionCategories, ...taxonomy.dareTypes]) {
                    entry.label = "W".repeat(73) + "CAT_END";
                }
                await route.fulfill({ response, json: taxonomy });
            });
        }
        await context.addInitScript(() => {
            localStorage.setItem("party-game.locale", "de");
            localStorage.setItem("party-game.reduced-motion", "true");
        });
    }
    const host = await hostContext.newPage();
    const display = await displayContext.newPage();
    await host.emulateMedia({ reducedMotion: "reduce" });
    await display.emulateMedia({ reducedMotion: "reduce" });
    await chooseStandardHostSetup(host, /Ich hab noch nie/);
    await host.getByRole("button", { name: /^Antworten offen/ }).click();
    await finishHostSetup(host, "personal", maximumName(1));
    const code = (await host.locator("main > header h1").textContent())!.trim();
    for (let index = 2; index <= playerCount; index += 1) {
        await host.getByRole("button", { name: /Person auf diesem Gerät/ }).click();
        await host.locator(".player-name-row").last().locator("input").fill(maximumName(index));
    }
    await expect(host.getByText("Personen auf diesem Gerät sind gespeichert")).toBeVisible();
    await joinDisplay(display, code);
    return { display, displayContext, host, hostContext };
}

test("visually audits menu, complete setup, Couch play, settings, and summary", async ({
    page,
}, testInfo) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/play/");
    await audit(page, testInfo, "01-home-desktop", { fullPage: false });

    await page.setViewportSize({ width: 320, height: 568 });
    await audit(page, testInfo, "02-home-phone-320x568", { fullPage: true });
    await page.getByRole("button", { name: /Spiel beitreten/ }).click();
    await page.getByLabel("Dein Name").fill(maximumName(1));
    await page.getByLabel("Raumcode").fill("ABCDEF");
    await audit(page, testInfo, "03-join-phone-max-name", { fullPage: true });

    await page.getByRole("button", { name: /Zurück/ }).click();
    await expect(page.getByRole("button", { name: /Spiel hosten/ })).toBeVisible();
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await expectWizardProgressLabelsOnOneLine(page);
    await audit(page, testInfo, "04-setup-group-phone", { fullPage: true });
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await audit(page, testInfo, "05-setup-mode-phone", { fullPage: true });
    await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await audit(page, testInfo, "06-setup-profile-phone", { fullPage: true });
    await page.getByRole("button", { name: /^Gute Freunde / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await audit(page, testInfo, "07-setup-customize-phone", { fullPage: true });
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.locator(".language-results button").first().focus();
    await audit(page, testInfo, "07a-setup-language-phone-forced-colors-focus", {
        fullPage: true,
    });
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.setViewportSize({ width: 844, height: 390 });
    await audit(page, testInfo, "08-setup-screen-short-landscape", { fullPage: true });
    await page.getByRole("button", { name: /Nur dieser Bildschirm/ }).click();
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();

    await page.setViewportSize({ width: 320, height: 568 });
    await populateMaximumCouchRoster(page);
    await audit(page, testInfo, "09-couch-lobby-20-max-names", { fullPage: true });
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await audit(page, testInfo, "10-couch-choice-max-active-name", { fullPage: false });
    await page.getByRole("button", { name: "Wahrheit", exact: true }).click();
    await expect(page.locator(".game-card")).toBeVisible();
    const cardPager = page.locator(".game-card .auto-page-text");
    await injectAutoPageSource(
        page.locator(`.game-card ${visibleAutoPageCopy}`),
        maximumCardText(),
    );
    await expect(cardPager).toHaveAttribute("data-source-length", "10000");
    await expect
        .poll(async () => Number(await cardPager.getAttribute("data-page-count")))
        .toBeGreaterThan(2);
    const hostileCardBounds = await cardPager.evaluate((pager) => {
        const gameCard = pager.closest<HTMLElement>(".game-card");
        return {
            cardHeight: gameCard?.clientHeight ?? 0,
            documentHeight: document.documentElement.scrollHeight,
            pagerHeight: (pager as HTMLElement).clientHeight,
        };
    });
    expect(hostileCardBounds.cardHeight).toBeLessThanOrEqual(720);
    expect(hostileCardBounds.pagerHeight).toBeLessThanOrEqual(640);
    expect(hostileCardBounds.cardHeight).toBeLessThan(hostileCardBounds.documentHeight);
    await auditFirstMiddleLastPages(page, testInfo, cardPager, "11-couch-card-hostile-copy-phone", {
        fullPage: true,
    });
    await expect(page.locator(`.game-card ${visibleAutoPageCopy}`)).toContainText(cardEndMarker);
    const hostileCardPageCount = await expectCompleteTextPages(cardPager, maximumCardText());
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await selectMeasuredPage(cardPager, 0);
    await cardPager.getByRole("button", { name: "Weiter", exact: true }).focus();
    await audit(page, testInfo, "11a-couch-card-next-page-phone-forced-colors-focus", {
        fullPage: true,
    });
    const lastPageButton = cardPager.getByRole("button", { name: "Letzte Seite", exact: true });
    await lastPageButton.focus();
    await audit(page, testInfo, "11a2-couch-card-last-page-phone-forced-colors-focus", {
        fullPage: true,
    });
    await lastPageButton.click();
    await expect(cardPager).toHaveAttribute("data-page", String(hostileCardPageCount - 1));
    await expect(page.locator(`.game-card ${visibleAutoPageCopy}`)).toContainText(cardEndMarker);
    await selectMeasuredPage(cardPager, hostileCardPageCount - 1);
    await cardPager.getByRole("button", { name: "Zurück", exact: true }).focus();
    await audit(page, testInfo, "11b-couch-card-previous-page-phone-forced-colors-focus", {
        fullPage: true,
    });
    await cardPager.getByRole("button", { name: "Erste Seite", exact: true }).click();
    await expect(cardPager).toHaveAttribute("data-page", "0");
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    await page.getByLabel("Einstellungen").click();
    await expectModalPaintedAndTopmost(page);
    await audit(page, testInfo, "12-couch-settings-phone", { fullPage: false });
    await page.getByRole("tab", { name: "Session" }).click();
    await audit(page, testInfo, "13-couch-session-danger-phone", { fullPage: false });
    await page.getByRole("button", { name: "Spiel beenden" }).click();
    await expect(page.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    await audit(page, testInfo, "14-couch-summary-phone", { fullPage: true });
});

test("visually audits Help and Card management with hostile collection names", async ({
    page,
}, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/play/help");
    await expect(page.locator(".help-content")).toContainText(/\S/);
    await expect.poll(async () => page.getByRole("tab").count()).toBeGreaterThan(1);
    await audit(page, testInfo, "15-help-phone-overview", { fullPage: true });
    await page.getByRole("tab", { name: /Schnellstart und Spielaufbau/ }).click();
    await expect(page.locator(".help-content")).toContainText(/\S/);
    await audit(page, testInfo, "16-help-phone-quick-start", { fullPage: true });

    const stableId = (index: number) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const longStem = "SehrLangerNameOhneNatuerlicheUmbruchstelle";
    const longLocale = maximumLocaleName();
    const questionEndMarker = "_QUESTION_END";
    const dareEndMarker = "_DARE_END";
    const longQuestionCategory = `${longStem}-Fragenkategorie-${longStem}`
        .padEnd(80, "Q")
        .slice(0, 80 - questionEndMarker.length)
        .concat(questionEndMarker);
    const longDareType = `${longStem}-Pflichtkategorie-${longStem}`
        .padEnd(80, "D")
        .slice(0, 80 - dareEndMarker.length)
        .concat(dareEndMarker);
    expect(longQuestionCategory).toHaveLength(80);
    expect(longDareType).toHaveLength(80);
    const groups = Array.from({ length: 1_000 }, (_, index) => ({
        id: stableId(index + 1),
        name: `${longStem}-${String(index + 1).padStart(4, "0")}-${longStem}`.slice(0, 80),
        members: [maximumName((index % 20) + 1)],
    }));
    const rules = Array.from({ length: 1_000 }, (_, index) => ({
        id: stableId(index + 2_000),
        name: maximumRuleName(index + 1),
        order: (index + 1) * 10,
        enabled: false,
        predicate: {},
        directives:
            index === 0
                ? {
                      availability: "INCLUDE",
                      alwaysEligible: "ENABLE",
                      repeatableInSession: "ENABLE",
                      repeatCooldown: { mode: "SET", value: 9999 },
                      intensity: { mode: "SET", value: 5 },
                      weight: { mode: "SET", value: 9999.9 },
                      socialSensitivity: { mode: "SET", value: "EXPLICIT" },
                      playerCount: { mode: "SET", value: { minimum: 2, maximum: 1000 } },
                  }
                : {},
        revision: 0,
    }));
    await page.route("**/api/v1/catalog/locales", async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as {
            defaultLocale: string;
            locales: Array<{ id: string; nativeName: string; coverage: number }>;
        };
        if (body.locales[0]) body.locales[0].nativeName = longLocale;
        await route.fulfill({ response, json: body });
    });
    await page.route("**/api/v1/groups", (route) =>
        route.fulfill({ contentType: "application/json", body: JSON.stringify({ groups }) }),
    );
    await page.route("**/api/v1/card-policy/rules", (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ rules }) });
    });
    await page.route("**/api/v1/card-policy/cards**", async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        const response = await route.fetch();
        const body = (await response.json()) as {
            cards: Array<{
                text: string;
                localDirectives: Record<string, unknown>;
                localRevision: number;
            }>;
        };
        if (body.cards[0]) {
            body.cards[0].text = maximumCardText();
            body.cards[0].localDirectives = structuredClone(rules[0]!.directives);
            body.cards[0].localRevision = 1;
        }
        await route.fulfill({ response, json: body });
    });
    await page.route("**/api/v1/catalog/taxonomies?*", async (route) => {
        const response = await route.fetch();
        const taxonomy = (await response.json()) as {
            questionCategories: Array<{ label: string }>;
            dareTypes: Array<{ label: string }>;
        };
        if (taxonomy.questionCategories[0])
            taxonomy.questionCategories[0].label = longQuestionCategory;
        if (taxonomy.dareTypes[0]) taxonomy.dareTypes[0].label = longDareType;
        await route.fulfill({ response, json: taxonomy });
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/play/cards");
    await expect(page.locator(".card-management-loading")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Kartenausnahmen" })).toBeVisible();
    await audit(page, testInfo, "17-card-management-desktop", { fullPage: true });
    await page.getByRole("button", { name: "DataSpace / Gruppe wählen" }).click();
    await audit(page, testInfo, "18-card-scope-1000-long-groups-desktop", { fullPage: true });
    await page.setViewportSize({ width: 320, height: 568 });
    const scopeGroupOptions = page.locator(".policy-scope-group-list .policy-scope-option");
    await expectControlTextPaintedWithin(scopeGroupOptions);
    await audit(page, testInfo, "19-card-scope-1000-long-groups-phone", { fullPage: true });
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.locator(".policy-scope-group-list .policy-scope-option").first().focus();
    await audit(page, testInfo, "19a-card-scope-row-phone-forced-colors-focus", {
        fullPage: true,
    });
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    await page.getByRole("button", { name: "DataSpace / Gruppe wählen" }).click();
    await page.getByRole("tab", { name: "Bedingte Regeln" }).click();
    await expect(page.locator(".policy-detail-heading h2")).toContainText(ruleEndMarker);
    await expect(page.getByLabel("Regelname")).toHaveValue(maximumRuleName(1));
    await expect(page.locator(".policy-editor-reveal")).toHaveCount(2);
    await expect(page.locator(".policy-range-fields")).toBeVisible();
    await expect(page.getByLabel("Karten dazwischen")).toHaveValue("9999");
    await expect(page.getByLabel("Relatives Gewicht")).toHaveValue("9999.9");
    await audit(page, testInfo, "20-card-rules-1000-long-names-phone", { fullPage: true });
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.locator(".policy-rule-select").first().focus();
    await audit(page, testInfo, "20a-card-rule-row-phone-forced-colors-focus", {
        fullPage: true,
    });
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    const firstRuleDrawer = page.locator(".policy-filter-section").first();
    await firstRuleDrawer.locator(":scope > summary").click();
    await firstRuleDrawer.locator(":scope > summary").focus();
    await audit(page, testInfo, "20a-card-rule-drawer-open-phone-focus", { fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await audit(page, testInfo, "21-card-rules-1000-long-names-desktop", { fullPage: true });
    await page.getByRole("tab", { name: "Kartenausnahmen" }).click();
    const selectedManagedCardTitle = page.locator(".managed-card-header h2");
    await expect(selectedManagedCardTitle).toHaveText(maximumCardText());
    await expect(selectedManagedCardTitle).toContainText(cardEndMarker);
    await expect(page.locator(".card-policy-detail .policy-editor-reveal")).toHaveCount(2);
    await audit(page, testInfo, "22-card-results-desktop", { fullPage: true });
    await page.setViewportSize({ width: 320, height: 568 });
    await audit(page, testInfo, "23-card-results-phone", { fullPage: true });
    await auditTextScrollSegment(
        page,
        testInfo,
        selectedManagedCardTitle,
        "23-card-text-10000-phone-first",
        0,
    );
    await auditTextScrollSegment(
        page,
        testInfo,
        selectedManagedCardTitle,
        "23-card-text-10000-phone-middle",
        0.5,
    );
    await auditTextScrollSegment(
        page,
        testInfo,
        selectedManagedCardTitle,
        "23-card-text-10000-phone-last",
        1,
    );
    await expect(selectedManagedCardTitle).toContainText(cardEndMarker);
    await expectMarkerPaintedWithin(selectedManagedCardTitle, cardEndMarker, ".scroll-copy");
    await selectedManagedCardTitle.focus();
    await page.keyboard.press("Home");
    expect(await selectedManagedCardTitle.evaluate((node) => node.scrollTop)).toBe(0);
    const firstCardRow = page.locator(".managed-card-list > button").first();
    await firstCardRow.focus();
    await page.keyboard.press("End");
    await expectMarkerPaintedWithin(firstCardRow.locator("strong"), cardEndMarker, ".scroll-copy");
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.locator(".managed-card-list > button").first().focus();
    await audit(page, testInfo, "23-card-row-phone-forced-colors-focus", { fullPage: true });
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });

    const cardFilterDrawer = page.locator(".card-filter-drawer");
    await cardFilterDrawer.locator(":scope > summary").click();
    await cardFilterDrawer.locator(":scope > summary").focus();
    const categoryPicker = cardFilterDrawer
        .locator(".wrapping-select")
        .filter({ has: page.locator('summary[aria-label="Fragekategorie"]') });
    const darePicker = cardFilterDrawer
        .locator(".wrapping-select")
        .filter({ has: page.locator('summary[aria-label="Pflichtart"]') });
    await categoryPicker.locator(":scope > summary").click();
    await categoryPicker
        .locator(".wrapping-select-options")
        .getByRole("button", { name: longQuestionCategory, exact: true })
        .click();
    await darePicker.locator(":scope > summary").click();
    await darePicker
        .locator(".wrapping-select-options")
        .getByRole("button", { name: longDareType, exact: true })
        .click();
    await expect(categoryPicker.locator(":scope > summary")).toContainText(questionEndMarker);
    await expect(darePicker.locator(":scope > summary")).toContainText(dareEndMarker);
    await audit(page, testInfo, "23-card-taxonomy-long-labels-phone", { fullPage: true });
    await categoryPicker.locator(":scope > summary").click();
    await categoryPicker.locator(":scope > summary").focus();
    await audit(page, testInfo, "23-card-taxonomy-options-phone-focus", { fullPage: true });
    const selectedCategoryOption = categoryPicker
        .locator(".wrapping-select-options")
        .getByRole("button", { name: longQuestionCategory, exact: true });
    await expectMarkerPaintedWithin(selectedCategoryOption, questionEndMarker, "button");
    await auditViewportSegment(
        page,
        testInfo,
        selectedCategoryOption,
        "23-card-taxonomy-selected-option-phone-detail",
        "center",
    );
    await categoryPicker.locator(":scope > summary").click();

    const maximumSearch = maximumSearchText();
    const cardSearch = page.getByRole("textbox", { name: "Kartentext durchsuchen" });
    await cardSearch.fill(maximumSearch);
    await expect(cardSearch).toHaveValue(maximumSearch);
    await expect(cardSearch).toHaveAttribute("maxlength", "200");
    await audit(page, testInfo, "23g-card-search-200-characters-phone", { fullPage: true });
    await auditViewportSegment(
        page,
        testInfo,
        cardSearch,
        "23g1-card-search-200-characters-phone-detail",
        "center",
    );

    await page.locator("html").evaluate((root) => (root.style.fontSize = "200%"));
    await audit(page, testInfo, "23a-card-results-phone-200-percent-text-zoom", {
        fullPage: true,
    });
    await auditViewportSegment(
        page,
        testInfo,
        page.locator(".card-management-header"),
        "23a1-card-results-phone-200-percent-top",
    );
    await auditViewportSegment(
        page,
        testInfo,
        page.locator(".managed-card-header"),
        "23a2-card-results-phone-200-percent-middle",
    );
    await auditViewportSegment(
        page,
        testInfo,
        page.locator(".card-policy-actions"),
        "23a3-card-results-phone-200-percent-bottom",
        "end",
    );
    const clearOverride = page.getByRole("button", {
        name: "Ausnahme entfernen",
        exact: true,
    });
    await expectMarkerPaintedWithin(clearOverride, "Ausnahme entfernen", "button");
    await expectControlTextPaintedWithin(page.locator(".card-policy-actions button"));
    await page.locator("html").evaluate((root) => (root.style.fontSize = ""));
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.getByRole("tab", { name: "Kartenausnahmen" }).focus();
    await audit(page, testInfo, "23b-card-results-phone-forced-colors-focus", {
        fullPage: false,
    });
    const managementTabs = page.getByRole("tab");
    await page.keyboard.press("Home");
    await expect(managementTabs.first()).toHaveAttribute("aria-selected", "true");
    await audit(page, testInfo, "23c-card-first-tab-phone-forced-colors-focus", {
        fullPage: false,
    });
    const nextTabArrow = page.locator(".tab-scroll-arrow.next");
    await expect(nextTabArrow).toBeVisible();
    await nextTabArrow.focus();
    await audit(page, testInfo, "23d-card-next-arrow-phone-forced-colors-focus", {
        fullPage: false,
    });
    await managementTabs.first().focus();
    await page.keyboard.press("End");
    await expect(managementTabs.last()).toHaveAttribute("aria-selected", "true");
    await audit(page, testInfo, "23e-card-last-tab-phone-forced-colors-focus", {
        fullPage: false,
    });
    const previousTabArrow = page.locator(".tab-scroll-arrow.previous");
    await expect(previousTabArrow).toBeVisible();
    await previousTabArrow.focus();
    await audit(page, testInfo, "23f-card-previous-arrow-phone-forced-colors-focus", {
        fullPage: false,
    });
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
});

test("visually audits join failure and a 500-character notification", async ({
    page,
}, testInfo) => {
    test.setTimeout(60_000);
    await page.clock.install();
    const errorEndMarker = "_ERROR_END";
    const longError = `Fehler: ${"X".repeat(500 - "Fehler: ".length - errorEndMarker.length)}${errorEndMarker}`;
    expect(longError).toHaveLength(500);
    await page.route("**/api/v1/help", (route) =>
        route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "VISUAL_TEST", message: longError } }),
        }),
    );
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/play/help");
    const toastCopy = page.locator(".notification-toast > span:not(.notification-icon)");
    const notificationLane = page.locator(".notification-lane");
    const appLocation = page.locator(".app-location");
    await expect(toastCopy).toHaveText(longError);
    await toastCopy.focus();
    await page.clock.runFor(5500);
    await expect(toastCopy).toBeVisible();
    await expectElementTopmost(page.locator(".notification-toast"));
    await expectElementsDoNotIntersect(notificationLane, appLocation);
    await audit(page, testInfo, "23c-toast-500-characters-phone", { fullPage: false });
    await toastCopy.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expectMarkerPaintedWithin(toastCopy, errorEndMarker, ".notification-toast");
    await page.keyboard.press("Home");
    expect(await toastCopy.evaluate((element) => element.scrollTop)).toBe(0);
    await page.keyboard.press("End");
    await expectMarkerPaintedWithin(toastCopy, errorEndMarker, ".notification-toast");
    await audit(page, testInfo, "23c1-toast-500-characters-phone-endpoint", {
        fullPage: false,
    });
    await toastCopy.evaluate((element) => element.scrollTo({ top: 0 }));
    await page.setViewportSize({ width: 844, height: 390 });
    await expectElementsDoNotIntersect(notificationLane, appLocation);
    await audit(page, testInfo, "23d-toast-500-characters-short-landscape", {
        fullPage: false,
    });
    await toastCopy.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expectMarkerPaintedWithin(toastCopy, errorEndMarker, ".notification-toast");
    await audit(page, testInfo, "23d1-toast-500-characters-short-landscape-endpoint", {
        fullPage: false,
    });
    await page.getByLabel("Hinweis schließen").click();
    await page.unroute("**/api/v1/help");

    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel beitreten/ }).click();
    await page.getByLabel("Dein Name").fill(maximumName(1));
    await page.getByLabel("Raumcode").fill("ABCDEF");
    await page.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await audit(page, testInfo, "23e-join-room-not-found-phone", { fullPage: true });
});

test("visually audits waiting, Conversation Meta, and exhausted Couch states", async ({
    page,
}, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Let's Talk/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Custom\b/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("slider", { name: /Gesprächsimpuls nach Fragen/ }).fill("1");
    for (const activateAll of await page.getByRole("button", { name: "Alle aktiv" }).all()) {
        await activateAll.click();
    }
    await finishHostSetup(page, "couch");
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await expect(page.locator(".turn-ready")).toBeVisible();
    await audit(page, testInfo, "23f-couch-waiting-for-player-phone", { fullPage: true });
    await page.getByRole("button", { name: "Karte aufdecken" }).click();
    await expect(page.locator('.game-card[data-type="QUESTION"]')).toBeVisible();
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(page.locator(".turn-ready")).toBeVisible();
    await page.getByRole("button", { name: "Karte aufdecken" }).click();
    await expect(page.locator('.game-card[data-type="CONVERSATION_META"]')).toBeVisible();
    await audit(page, testInfo, "23g-couch-conversation-meta-phone", { fullPage: true });

    await page.route("**/api/v1/couch/sessions/*/advance", (route) =>
        route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
                error: {
                    code: "CARD_POOL_EXHAUSTED",
                    message: "Keine passenden Karten mehr.",
                },
            }),
        }),
    );
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(page.locator(".exhausted-state")).toBeVisible();
    await audit(page, testInfo, "23h-couch-card-pool-exhausted-phone", { fullPage: true });
});

test("visually audits the configured 1000-player ceiling on the production roster", async ({
    baseURL,
    browser,
}, testInfo) => {
    test.setTimeout(300_000);
    if (!baseURL) throw new Error("The visual audit requires a Playwright base URL");
    const { display, displayContext, host, hostContext } =
        await hostPartyWithMaximumRoster(browser);
    const code = (await host.locator("main > header h1").textContent())!.trim();

    for (let participantIndex = 1; participantIndex <= 49; participantIndex += 1) {
        await addSyntheticParticipantWithDevicePlayers(baseURL, code, participantIndex);
    }

    await expect(display.locator(".stage-player-roster > header span")).toHaveText("1000", {
        timeout: 30_000,
    });
    await expect(host.locator(".room-size")).toContainText("1000 / 1000");
    const initialUrlPager = display.locator(".room-availability-urls .auto-page-text");
    const initialUrlCopy = initialUrlPager.locator(visibleAutoPageCopy);
    await expect(initialUrlCopy).toHaveText(/\S/);
    const initialUrlSource = await initialUrlCopy.getAttribute("aria-label");
    if (!initialUrlSource) throw new Error("The display URL pager must expose its full source");
    await expectCompleteTextPages(initialUrlPager, initialUrlSource);
    await auditFirstMiddleLastPages(
        display,
        testInfo,
        initialUrlPager,
        "24a0-party-display-urls-800x600",
        { fullPage: false },
    );
    const rosterPager = display.locator(".stage-player-roster .auto-page-region");
    await expectMeasuredPages(rosterPager);
    await expect(rosterPager.locator(".auto-page-dots i")).toHaveCount(7);
    await auditFirstMiddleLastPages(
        display,
        testInfo,
        rosterPager,
        "24a-party-display-1000-player-roster-800x600",
        { fullPage: false },
    );
    await expectRenderedRosterItemsContained(display);
    await expect(display.locator(".stage-player strong")).toContainText(maximumName(1_000));
    await display.setViewportSize({ width: 844, height: 390 });
    await selectMeasuredPage(rosterPager, 0);
    await audit(display, testInfo, "24b-party-display-1000-player-roster-844x390", {
        fullPage: false,
    });
    await expectRenderedRosterItemsContained(display);
    await display.setViewportSize({ width: 1920, height: 1080 });
    await selectMeasuredPage(rosterPager, 0);
    await audit(display, testInfo, "24c-party-display-1000-player-roster-tv", {
        fullPage: false,
    });
    await expectRenderedRosterItemsContained(display);

    await hostContext.close();
    await displayContext.close();
});

test("visually audits a maximum-name Party Screen roster, voting, and results", async ({
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    const { display, displayContext, host, hostContext } =
        await hostPartyWithMaximumRoster(browser);
    await audit(host, testInfo, "24-party-host-lobby-phone-max-roster", { fullPage: true });
    const urlPager = display.locator(".room-availability-urls .auto-page-text");
    await injectAutoPageSource(
        display.locator(`.room-availability-urls ${visibleAutoPageCopy}`),
        maximumRoomUrl(),
    );
    await expect(urlPager).toHaveAttribute("data-source-length", String(maximumRoomUrl().length));
    await expect
        .poll(async () => Number(await urlPager.getAttribute("data-page-count")))
        .toBeGreaterThan(1);
    await auditFirstMiddleLastPages(
        display,
        testInfo,
        urlPager,
        "25-party-display-lobby-url-800x600",
        { fullPage: false },
    );
    const hostileUrlPageCount = Number(await urlPager.getAttribute("data-page-count"));
    await selectMeasuredPage(urlPager, hostileUrlPageCount - 1);
    expect(
        await display.locator(`.room-availability-urls ${visibleAutoPageCopy}`).textContent(),
    ).toContain(roomUrlEndMarker);
    await expectCompleteTextPages(urlPager, maximumRoomUrl());
    const lobbyRosterPager = display.locator(".stage-player-roster .auto-page-region");
    await selectMeasuredPage(lobbyRosterPager, 0);
    const firstName = display.locator(".stage-player strong[data-text-overflow]").first();
    await expect(firstName).toBeVisible();
    const firstNameSource = await firstName.textContent();
    const readingTime = Number(await firstName.getAttribute("data-text-scroll-duration"));
    await expect
        .poll(
            () =>
                firstName.evaluate(
                    (label) => label.scrollWidth - label.clientWidth - label.scrollLeft,
                ),
            { timeout: readingTime + 7000 },
        )
        .toBeLessThanOrEqual(1);
    await expect(lobbyRosterPager).toHaveAttribute("data-page", "0");
    await expect(firstName).toHaveText(firstNameSource!);
    await audit(display, testInfo, "25a-party-roster-full-name-endpoint", { fullPage: false });
    await expect
        .poll(() => lobbyRosterPager.getAttribute("data-page"), { timeout: 12000 })
        .not.toBe("0");
    await auditFirstMiddleLastPages(
        display,
        testInfo,
        lobbyRosterPager,
        "25b-party-display-lobby-roster-800x600",
        { fullPage: false },
    );
    await display.setViewportSize({ width: 1280, height: 600 });
    await auditFirstMiddleLastPages(
        display,
        testInfo,
        urlPager,
        "25c-party-display-lobby-url-1280x600",
        { fullPage: false },
    );
    await expectRenderedRosterItemsContained(display);
    await expect(display.getByRole("button", { name: "Lobby verlassen" })).toBeInViewport();
    expect(
        await display.evaluate(
            () => document.scrollingElement!.scrollHeight <= window.innerHeight + 1,
        ),
    ).toBe(true);
    await display.setViewportSize({ width: 1920, height: 1080 });
    await audit(display, testInfo, "26-party-display-lobby-tv", { fullPage: false });

    await host.getByRole("button", { name: "Spiel starten" }).click();
    await host.getByRole("button", { name: "Karte aufdecken" }).click();
    await expect(display.locator(".never-voting")).toBeVisible();
    await audit(host, testInfo, "26b-private-nhie-ballot-phone-20-names", { fullPage: true });
    const displayCardPager = display.locator(".game-card .auto-page-text");
    await injectAutoPageSource(
        display.locator(`.game-card ${visibleAutoPageCopy}`),
        maximumCardText(),
    );
    await expect(displayCardPager).toHaveAttribute("data-source-length", "10000");
    await display.setViewportSize({ width: 800, height: 600 });
    await auditFirstMiddleLastPages(
        display,
        testInfo,
        displayCardPager,
        "27-party-voting-long-card-800x600",
        { fullPage: false },
    );
    await expect(display.locator(`.game-card ${visibleAutoPageCopy}`)).toContainText(cardEndMarker);
    const votingRosterPager = display.locator(".never-voting > .auto-page-region");
    await expectMeasuredPages(votingRosterPager);
    const votingRosterPageSize = Number(await votingRosterPager.getAttribute("data-page-size"));
    expect(votingRosterPageSize).toBeGreaterThan(1);
    await auditFirstMiddleLastPages(
        display,
        testInfo,
        votingRosterPager,
        "27b-party-voting-long-roster-800x600",
        { fullPage: false },
    );
    expect(Number(await votingRosterPager.getAttribute("data-page-size"))).toBe(
        votingRosterPageSize,
    );
    await display.setViewportSize({ width: 844, height: 390 });
    await expectDisplayGameplayVisible(display);
    await audit(display, testInfo, "28-party-voting-long-names-844x390", { fullPage: false });
    await expectAutoPageCopyPainted(display.locator(".game-card .auto-page-text"));
    await expectPaintedAutoPageItem(display, ".vote-progress-row");
    await display.setViewportSize({ width: 1920, height: 1080 });
    await expectDisplayGameplayVisible(display);
    await audit(display, testInfo, "29-party-voting-long-names-tv", { fullPage: false });
    await expectAutoPageCopyPainted(display.locator(".game-card .auto-page-text"));
    await expectPaintedAutoPageItem(display, ".vote-progress-row");

    for (let remaining = 20; remaining > 0; remaining -= 1) {
        const row = host.locator(".never-vote-row").first();
        await row.getByRole("button", { name: "Trifft zu" }).click();
        await expect(host.locator(".never-vote-row")).toHaveCount(remaining - 1);
    }
    await expect(display.locator(".never-result-columns")).toBeVisible();
    await display.setViewportSize({ width: 800, height: 600 });
    await expectDisplayGameplayVisible(display, true);
    const namedResultPager = display.locator(".yes-column .auto-page-region");
    await auditFirstMiddleLastPages(
        display,
        testInfo,
        namedResultPager,
        "30-party-named-results-800x600",
        { fullPage: false },
    );
    await display.setViewportSize({ width: 844, height: 390 });
    await expectDisplayGameplayVisible(display, true);
    await audit(display, testInfo, "31-party-named-results-844x390", { fullPage: false });
    await expectAutoPageCopyPainted(display.locator(".game-card .auto-page-text"));
    await expectPaintedAutoPageItem(display, ".stage-results .answer-name");
    await display.setViewportSize({ width: 1920, height: 1080 });
    await expectDisplayGameplayVisible(display, true);
    await audit(display, testInfo, "32-party-named-results-tv", { fullPage: false });
    await expectAutoPageCopyPainted(display.locator(".game-card .auto-page-text"));
    await expectPaintedAutoPageItem(display, ".stage-results .answer-name");

    await hostContext.close();
    await displayContext.close();
});

test("visually audits text overflow with wide names and taxonomy in fixed game surfaces", async ({
    browser,
}, testInfo) => {
    const { display, displayContext, host, hostContext } = await hostPartyWithMaximumRoster(
        browser,
        2,
        true,
    );
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await host.getByRole("button", { name: "Karte aufdecken" }).click();
    await expect(display.locator(".game-card")).toBeVisible();
    for (const target of [host, display]) {
        await expect(target.locator(".game-card .auto-page-text")).toHaveAttribute(
            "data-source-length",
            "10000",
        );
    }
    for (const viewport of [
        { width: 320, height: 568 },
        { width: 844, height: 390 },
        { width: 800, height: 600 },
        { width: 1440, height: 900 },
        { width: 1920, height: 1080 },
    ]) {
        for (const [role, target] of [
            ["personal", host],
            ["display", display],
        ] as const) {
            // Existing layout-only limits are documented in the overflow audit.
            if (role === "personal" && viewport.height < 400) continue;
            if (role === "display" && viewport.width < 620) continue;
            await target.setViewportSize(viewport);
            await audit(target, testInfo, `overflow-${role}-${viewport.width}x${viewport.height}`, {
                fullPage: role === "personal",
            });
            await expectAutoPageCopyPainted(target.locator(".game-card .auto-page-text"));
        }
    }
    await host.setViewportSize({ width: 320, height: 568 });
    const categoryCopy = host.locator(".card-type .scroll-text");
    await audit(host, testInfo, "overflow-category-keyboard-phone", { fullPage: true });
    await categoryCopy.focus();
    await host.keyboard.press("End");
    await expectMarkerPaintedWithin(categoryCopy, "CAT_END", ".scroll-text");
    for (let remaining = 2; remaining > 0; remaining -= 1) {
        await host
            .locator(".never-vote-row")
            .first()
            .getByRole("button", { name: "Trifft zu", exact: true })
            .click();
        await expect(host.locator(".never-vote-row")).toHaveCount(remaining - 1);
    }
    for (const [role, target, viewport] of [
        ["personal", host, { width: 320, height: 568 }],
        ["display", display, { width: 800, height: 600 }],
        ["display", display, { width: 844, height: 390 }],
        ["display", display, { width: 1920, height: 1080 }],
    ] as const) {
        await target.setViewportSize(viewport);
        await expect(target.locator(".never-result-columns")).toBeVisible();
        await audit(
            target,
            testInfo,
            `overflow-results-${role}-${viewport.width}x${viewport.height}`,
            { fullPage: role === "personal" },
        );
        await expectAutoPageCopyPainted(target.locator(".game-card .auto-page-text"));
    }
    await hostContext.close();
    await displayContext.close();
});

test("text overflow remains readable with keyboard, touch, motion preferences, and Unicode", async ({
    page,
}, testInfo) => {
    await page.clock.install();
    await page.setViewportSize({ width: 320, height: 568 });
    await chooseStandardHostSetup(page, /Wahrheit oder Pflicht/);
    await finishHostSetup(page, "couch");
    const names = page.locator(".player-name-row input");
    const maximum = "W".repeat(32) + "NAME_END";
    await names.nth(0).fill(maximum);
    await names.nth(1).fill("M" + maximum.slice(1));
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await page.getByRole("button", { name: "Wahrheit", exact: true }).click();
    const name = page.locator(".active-player .scroll-text");
    await expect(name).toHaveAttribute("data-text-overflow", "");
    await name.focus();
    await page.keyboard.press("End");
    await expect
        .poll(() => name.evaluate((node) => node.scrollWidth - node.clientWidth - node.scrollLeft))
        .toBeLessThanOrEqual(1);
    await audit(page, testInfo, "overflow-name-keyboard-end-phone", { fullPage: true });
    await page.keyboard.press("Home");
    await expect.poll(() => name.evaluate((node) => node.scrollLeft)).toBe(0);

    // Native horizontal scrolling is also the touch path; no text is removed from the DOM.
    await name.evaluate((node) => node.scrollBy({ left: 100, behavior: "instant" }));
    await expect.poll(() => name.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await name.evaluate((node) => node.blur());
    await page.mouse.move(0, 0);
    const reducedPosition = await name.evaluate((node) => node.scrollLeft);
    await page.clock.runFor(2000);
    expect(await name.evaluate((node) => node.scrollLeft)).toBe(reducedPosition);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => (document.documentElement.dataset.reducedMotion = "false"));
    await expect
        .poll(() => name.evaluate((node) => node.scrollLeft), { timeout: 7000 })
        .toBeGreaterThan(reducedPosition + 5);
    await name.focus();
    const pausedPosition = await name.evaluate((node) => node.scrollLeft);
    await page.clock.runFor(350);
    expect(await name.evaluate((node) => node.scrollLeft)).toBe(pausedPosition);
    await page.evaluate(() => (document.documentElement.dataset.reducedMotion = "true"));

    const card = page.locator(".game-card .auto-page-text");
    const unicode = "👩🏽‍🚀🇩🇪e\u0301".repeat(180) + "UNICODE_END";
    await injectAutoPageSource(page.locator(`.game-card ${visibleAutoPageCopy}`), unicode);
    await expectCompleteTextPages(card, unicode);
    await audit(page, testInfo, "overflow-unicode-card-phone-last", { fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectCompleteTextPages(card, unicode);
    await audit(page, testInfo, "overflow-unicode-card-desktop-last", { fullPage: false });
    await injectAutoPageSource(page.locator(`.game-card ${visibleAutoPageCopy}`), ordinaryCardText);
    await expect(card).toHaveAttribute("data-page", "0");
    await expect(card).toHaveAttribute("data-page-count", "1");
});

test("keeps an underfilled final measured roster page stable", async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const playerCount = 19;
    const { display, displayContext, host, hostContext } = await hostPartyWithMaximumRoster(
        browser,
        playerCount,
    );
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await host.getByRole("button", { name: "Karte aufdecken" }).click();
    await expectDisplayGameplayVisible(display);

    const pager = display.locator(".never-voting > .auto-page-region");
    const pageCount = await expectMeasuredPages(pager);
    const pageSize = Number(await pager.getAttribute("data-page-size"));
    expect(pageSize).toBeGreaterThan(1);
    expect(playerCount % pageSize).toBeGreaterThan(0);

    await selectMeasuredPage(pager, pageCount - 1);
    await pager.evaluate(() => new Promise<void>((resolve) => window.setTimeout(resolve, 500)));
    expect(Number(await pager.getAttribute("data-page-size"))).toBe(pageSize);
    expect(Number(await pager.getAttribute("data-page-count"))).toBe(pageCount);
    await expect(pager).toHaveAttribute("data-page", String(pageCount - 1));
    await expectPaintedAutoPageItem(display, ".vote-progress-row");
    await audit(display, testInfo, "32a-party-underfilled-final-roster-page-800x600", {
        fullPage: false,
    });

    await hostContext.close();
    await displayContext.close();
});

test("visually audits anonymous Never Have I Ever results", async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const hostContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 320, height: 568 },
    });
    const playerContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 320, height: 568 },
    });
    const displayContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 844, height: 390 },
    });
    for (const context of [hostContext, playerContext, displayContext]) {
        await context.addInitScript(() => {
            localStorage.setItem("party-game.locale", "de");
            localStorage.setItem("party-game.reduced-motion", "true");
        });
    }
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    for (const current of [host, player, display]) {
        await current.emulateMedia({ reducedMotion: "reduce" });
    }

    await chooseStandardHostSetup(host, /Ich hab noch nie/);
    await host.getByRole("button", { name: /^Anonym/ }).click();
    await finishHostSetup(host, "personal", maximumName(1));
    const code = (await host.locator("main > header h1").textContent())!.trim();
    await joinPlayer(player, code, maximumName(2));
    await joinDisplay(display, code);
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(host.getByRole("button", { name: "Karte aufdecken" })).toBeVisible();
    await expect(display.locator(".game-phase")).toContainText("Bereit");
    await audit(host, testInfo, "49a-room-waiting-for-player-phone", { fullPage: false });
    await audit(display, testInfo, "49b-room-waiting-for-player-short-landscape", {
        fullPage: false,
    });
    await host.getByRole("button", { name: "Karte aufdecken" }).click();
    await host.getByRole("button", { name: "Trifft zu" }).click();
    await expect(
        player.locator(".vote-progress-row").filter({ hasText: maximumName(1) }),
    ).toContainText("Abgestimmt");
    await player.getByRole("button", { name: "Trifft nicht zu" }).click();
    await expect(display.locator(".aggregate-total")).toContainText("2");
    await audit(display, testInfo, "32c-anonymous-nhie-result-short-landscape", {
        fullPage: false,
    });
    for (const current of [host, player, display]) {
        await expect(current.locator(".aggregate-metric").first()).toBeVisible();
        await expect(current.locator(".aggregate-metric")).toHaveCount(2);
        await expect(current.locator(".answer-name-list")).toHaveCount(0);
    }
    await audit(host, testInfo, "32b-anonymous-nhie-result-phone", { fullPage: true });

    await hostContext.close();
    await playerContext.close();
    await displayContext.close();
});

test("visually audits Personal play, reconnecting, private choices, settings, and end", async ({
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    const hostContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 320, height: 568 },
    });
    const playerContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 320, height: 568 },
    });
    for (const context of [hostContext, playerContext]) {
        await context.addInitScript(() => {
            localStorage.setItem("party-game.locale", "de");
            localStorage.setItem("party-game.reduced-motion", "true");
        });
    }
    const longSettingsLocale = maximumLocaleName();
    await hostContext.route("**/api/v1/catalog/locales", async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as {
            defaultLocale: string;
            locales: Array<{ id: string; nativeName: string; coverage: number }>;
        };
        if (body.locales[0]) body.locales[0].nativeName = longSettingsLocale;
        await route.fulfill({ response, json: body });
    });
    let interceptReconnects = false;
    let exhaustReconnects = false;
    let closeRoutedSocket: (() => Promise<void>) | undefined;
    let routedSocketCount = 0;
    await playerContext.routeWebSocket(
        () => true,
        (socket) => {
            if (!interceptReconnects) {
                socket.connectToServer();
                return;
            }
            routedSocketCount += 1;
            const closeThisSocket = () => socket.close({ code: 1011, reason: "visual audit" });
            closeRoutedSocket = closeThisSocket;
            socket.onMessage(() => undefined);
            if (exhaustReconnects) setTimeout(() => void closeThisSocket(), 10);
        },
    );
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    await host.emulateMedia({ reducedMotion: "reduce" });
    await player.emulateMedia({ reducedMotion: "reduce" });

    await chooseStandardHostSetup(host, /Wahrheit oder Pflicht/);
    await finishHostSetup(host, "personal", maximumName(1));
    const code = (await host.locator("main > header h1").textContent())!.trim();
    await joinPlayer(player, code, maximumName(2));
    await audit(host, testInfo, "33-personal-host-lobby-phone", { fullPage: true });
    await audit(player, testInfo, "34-personal-player-lobby-phone", { fullPage: true });

    await host.getByRole("button", { name: "Spieleinstellungen ansehen" }).click();
    await expectModalPaintedAndTopmost(host);
    await expect(host.locator(".current-settings-modal .game-settings-summary-full")).toBeVisible();
    await expectMarkerPaintedWithin(
        host.locator(".settings-facts dd").filter({ hasText: localeEndMarker }),
        localeEndMarker,
        ".settings-facts div",
    );
    await audit(host, testInfo, "34c-personal-read-only-game-settings-phone", {
        fullPage: false,
    });
    await host.getByLabel("Einstellungen schließen").click();

    const privateBoundaryDetails = host.locator(".lobby details.advanced");
    await privateBoundaryDetails.locator(":scope > summary").click();
    await audit(host, testInfo, "34a-personal-private-boundaries-open-phone", {
        fullPage: true,
    });
    await privateBoundaryDetails.locator(":scope > summary").click();

    await host.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await expectModalPaintedAndTopmost(host);
    await host.getByRole("button", { name: /^Spicy / }).click();
    await expect(host.locator(".settings-modal .adult-confirmation")).toBeVisible();
    await audit(host, testInfo, "34b-personal-game-settings-adult-confirmation-phone", {
        fullPage: false,
    });
    const adultConfirmation = host.locator(".settings-modal .adult-confirmation");
    await adultConfirmation.scrollIntoViewIfNeeded();
    await expect(adultConfirmation).toBeInViewport();
    await audit(host, testInfo, "34b1-personal-game-settings-adult-confirmation-reachable-phone", {
        fullPage: false,
    });
    await host.getByRole("tab", { name: "Audio" }).click();
    await audit(host, testInfo, "34d-personal-settings-audio-phone", { fullPage: false });
    await host.getByRole("tab", { name: "Darstellung" }).click();
    const longFallbackOption = host
        .locator(".language-fallback-setting")
        .getByRole("option", { name: new RegExp(localeEndMarker) });
    await longFallbackOption.click();
    const selectedFallback = host
        .locator(".language-order-list li")
        .filter({ hasText: localeEndMarker });
    await expectMarkerPaintedWithin(
        selectedFallback.locator("strong"),
        localeEndMarker,
        ".language-order-list li",
    );
    await audit(host, testInfo, "34e-personal-settings-display-max-locale-phone", {
        fullPage: false,
    });
    await host.getByRole("tab", { name: "Inhalte" }).click();
    await expect(host.locator(".settings-modal .boundary-panel")).toBeVisible();
    await audit(host, testInfo, "34f-personal-settings-content-phone", { fullPage: false });
    await host.getByRole("tab", { name: "Raum", exact: true }).click();
    await expectImagePaintedAndTopmost(host.locator(".settings-join-info img"));
    await audit(host, testInfo, "34g-personal-settings-services-qr-phone", {
        fullPage: false,
    });
    await host.getByRole("tab", { name: /Erweiterte Einstellungen/ }).click();
    const hostTransferPicker = host.locator(".host-transfer-control .wrapping-select");
    await hostTransferPicker.locator(":scope > summary").click();
    await hostTransferPicker
        .locator(".wrapping-select-options")
        .getByRole("button", { name: maximumName(2), exact: true })
        .click();
    await audit(host, testInfo, "35-personal-host-transfer-warning-phone", {
        fullPage: false,
    });
    await hostTransferPicker.locator(":scope > summary").click();
    await hostTransferPicker.locator(":scope > summary").focus();
    await audit(host, testInfo, "35a-personal-host-transfer-options-phone-focus", {
        fullPage: false,
    });
    await hostTransferPicker.locator(":scope > summary").click();
    await host.getByLabel("Einstellungen schließen").click();

    await playerContext.setOffline(true);
    await expect(player.locator(".reconnect-panel")).toContainText("Verbindung unterbrochen", {
        timeout: 3_000,
    });
    await audit(player, testInfo, "36-personal-reconnect-offline-phone", { fullPage: false });
    await playerContext.setOffline(false);
    await expect(player.getByRole("heading", { name: "Lobby" })).toBeVisible({ timeout: 7_000 });

    await host.getByRole("button", { name: "Spiel starten" }).click();
    const hostTruth = host.getByRole("button", { name: "Wahrheit", exact: true });
    const playerTruth = player.getByRole("button", { name: "Wahrheit", exact: true });
    await expect
        .poll(async () => (await hostTruth.isVisible()) || playerTruth.isVisible())
        .toBe(true);
    await audit(host, testInfo, "37-personal-host-choice-phone", { fullPage: false });
    await audit(player, testInfo, "38-personal-player-choice-phone", { fullPage: false });
    const chooser = (await hostTruth.isVisible()) ? host : player;
    await chooser.getByRole("button", { name: "Wahrheit", exact: true }).click();
    await expect(host.locator(".game-card")).toBeVisible();
    await expect(player.locator(".game-card")).toBeVisible();
    const ordinaryCardPager = host.locator(".game-card .auto-page-text");
    const ordinaryCardCopy = ordinaryCardPager.locator(visibleAutoPageCopy);
    await injectAutoPageSource(ordinaryCardCopy, ordinaryCardText);
    await injectAutoPageSource(
        player.locator(`.game-card ${visibleAutoPageCopy}`),
        ordinaryCardText,
    );
    await expect(ordinaryCardPager).toHaveAttribute("data-page-count", "1");
    expect(await ordinaryCardCopy.textContent()).toBe(
        await ordinaryCardCopy.getAttribute("aria-label"),
    );
    await audit(host, testInfo, "39-personal-host-revealed-question-phone", { fullPage: true });
    await audit(player, testInfo, "40-personal-player-revealed-question-phone", {
        fullPage: true,
    });

    await host.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await host.getByRole("tab", { name: "Aktuelle Spieleinstellungen" }).click();
    await expect(host.locator(".settings-modal .game-settings-summary-full")).toBeVisible();
    await audit(host, testInfo, "41-personal-current-game-settings-phone", {
        fullPage: false,
    });
    await host.getByRole("tab", { name: "Session" }).click();
    await host.getByRole("button", { name: "Spiel beenden" }).click();
    for (const current of [host, player]) {
        await expect(current.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    }
    await audit(host, testInfo, "42-personal-host-ended-phone", { fullPage: true });
    await audit(player, testInfo, "43-personal-player-ended-phone", { fullPage: true });

    await playerContext.setOffline(true);
    await expect(player.locator(".reconnect-panel")).toBeVisible({ timeout: 5_000 });
    await player.getByRole("button", { name: "Wiederverbindung stoppen" }).click();
    await expect(player.locator(".reconnect-status")).toContainText(
        "automatische Wiederverbindung wurde angehalten",
    );
    await audit(player, testInfo, "43a-personal-reconnect-stopped-phone", {
        fullPage: false,
    });
    interceptReconnects = true;
    await playerContext.setOffline(false);
    await player.getByRole("button", { name: "Jetzt erneut versuchen" }).click();
    await expect.poll(() => routedSocketCount).toBeGreaterThan(0);
    await expect(player.locator(".reconnect-status")).toContainText("Verbindung wird hergestellt");
    await audit(player, testInfo, "43b-personal-reconnect-connecting-phone", {
        fullPage: false,
    });
    await expect(player.locator(".reconnect-panel")).toBeVisible();
    await expect(player.locator(".reconnect-status")).toContainText("Verbindung wird hergestellt");
    exhaustReconnects = true;
    await player.evaluate(() => {
        const nativeTimeout = window.setTimeout.bind(window);
        const nativeInterval = window.setInterval.bind(window);
        window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
            nativeTimeout(
                handler,
                Math.min(timeout ?? 0, 20),
                ...args,
            )) as typeof window.setTimeout;
        window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
            nativeInterval(
                handler,
                Math.min(timeout ?? 0, 20),
                ...args,
            )) as typeof window.setInterval;
    });
    await closeRoutedSocket?.();
    await expect(player.locator(".reconnect-status")).toContainText(
        "automatische Wiederverbindung wurde nach mehreren Versuchen beendet",
        { timeout: 15_000 },
    );
    await audit(player, testInfo, "43c-personal-reconnect-exhausted-phone", {
        fullPage: false,
    });

    await hostContext.close();
    await playerContext.close();
});

test("visually audits Party Screen Truth and Dare action paths", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const phoneContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 320, height: 568 },
    });
    const displayContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 800, height: 600 },
    });
    for (const context of [phoneContext, displayContext]) {
        await context.addInitScript(() => {
            localStorage.setItem("party-game.locale", "de");
            localStorage.setItem("party-game.reduced-motion", "true");
        });
    }
    let forceRoomPoolExhausted = false;
    await phoneContext.routeWebSocket(
        () => true,
        (socket) => {
            const server = socket.connectToServer();
            socket.onMessage((message) => {
                const envelope = JSON.parse(message.toString()) as {
                    requestId: string | null;
                    type: string;
                };
                if (forceRoomPoolExhausted && envelope.type === "command.advanceSession") {
                    forceRoomPoolExhausted = false;
                    socket.send(
                        JSON.stringify({
                            protocol: PROTOCOL_VERSION,
                            type: "error",
                            requestId: envelope.requestId,
                            revision: null,
                            payload: {
                                code: "CARD_POOL_EXHAUSTED",
                                message: "Keine passenden Karten mehr.",
                            },
                        }),
                    );
                    return;
                }
                server.send(message);
            });
        },
    );
    const phone = await phoneContext.newPage();
    const display = await displayContext.newPage();
    await phone.emulateMedia({ reducedMotion: "reduce" });
    await display.emulateMedia({ reducedMotion: "reduce" });

    await chooseStandardHostSetup(display, /Wahrheit oder Pflicht/);
    await finishHostSetup(display, "party");
    const code = (await display.locator("main > header h1").textContent())!.trim();
    await expect(display.locator(".host-status-banner.attention")).toContainText(
        "Wartet auf den ersten Host",
    );
    await expectImagePaintedAndTopmost(display.locator(".join-card img"));
    await audit(display, testInfo, "43c-party-display-awaiting-first-host-800x600", {
        fullPage: false,
    });
    await joinPlayer(phone, code, maximumName(1));
    await phone.getByRole("button", { name: /Person auf diesem Gerät/ }).click();
    await phone.locator(".player-name-row").last().getByRole("textbox").fill(maximumName(2));
    await expect(phone.getByText("Personen auf diesem Gerät sind gespeichert")).toBeVisible();
    await audit(phone, testInfo, "44-party-phone-host-lobby", { fullPage: true });
    await expect(display.locator(`.room-availability-urls ${visibleAutoPageCopy}`)).toHaveText(
        /\S/,
    );
    await expectImagePaintedAndTopmost(display.locator(".join-card img"));
    await audit(display, testInfo, "45-party-display-lobby-800x600", { fullPage: false });
    await expectRenderedRosterItemsContained(display);

    await phone.getByRole("button", { name: "Spiel starten" }).click();
    await expect(phone.getByRole("button", { name: "Pflicht", exact: true })).toBeVisible();
    await audit(phone, testInfo, "46-party-phone-private-choice", { fullPage: false });
    await audit(display, testInfo, "47-party-display-awaiting-private-choice", {
        fullPage: false,
    });
    await phone.getByRole("button", { name: "Pflicht", exact: true }).click();
    await expect(display.locator(".game-card[data-type='DARE']")).toBeVisible();
    await audit(phone, testInfo, "48-party-phone-dare-revealed", { fullPage: true });
    await audit(display, testInfo, "49-party-display-dare-revealed-800x600", {
        fullPage: false,
    });

    await phone.locator(".actions").getByRole("button", { name: "Weiter", exact: true }).click();
    const revealNextCard = phone.getByRole("button", { name: "Karte aufdecken" });
    const truthChoice = phone.getByRole("button", { name: "Wahrheit", exact: true });
    await expect
        .poll(async () => (await revealNextCard.isVisible()) || truthChoice.isVisible())
        .toBe(true);
    if (await revealNextCard.isVisible()) {
        await revealNextCard.click();
    }
    await expect(truthChoice).toBeVisible();
    await truthChoice.click();
    await expect(display.locator(".game-card[data-type='QUESTION']")).toBeVisible();
    await audit(phone, testInfo, "50-party-phone-question-revealed", { fullPage: true });
    await display.setViewportSize({ width: 1920, height: 1080 });
    await audit(display, testInfo, "51-party-display-question-revealed-tv", {
        fullPage: false,
    });
    forceRoomPoolExhausted = true;
    await phone.locator(".actions").getByRole("button", { name: "Weiter", exact: true }).click();
    await expect.poll(() => forceRoomPoolExhausted).toBe(false);
    await expect(phone.locator(".exhausted-state")).toBeVisible();
    await expectElementsDoNotIntersect(
        phone.locator(".notification-lane"),
        phone.locator(".app-location"),
    );
    await expectElementsDoNotIntersect(
        phone.locator(".notification-toast"),
        phone.locator(".active-player"),
    );
    await audit(phone, testInfo, "51a-party-phone-card-pool-exhausted", { fullPage: false });
    const exhaustedState = phone.locator(".exhausted-state");
    await auditViewportSegment(
        phone,
        testInfo,
        exhaustedState,
        "51a1-party-phone-card-pool-exhausted-actions",
        "center",
    );
    await expectElementsDoNotIntersect(phone.locator(".notification-toast"), exhaustedState);
    await expectControlTextPaintedWithin(exhaustedState.getByRole("button"));
    await phone.locator(".settings-trigger").click();
    await expect(phone.locator(".notification-lane")).toHaveCount(0);
    await expectModalPaintedAndTopmost(phone);
    await audit(phone, testInfo, "52-party-phone-settings", { fullPage: false });
    await phone.getByRole("tab", { name: "Session" }).click();
    await audit(phone, testInfo, "52a-party-phone-session-destructive-actions", {
        fullPage: false,
    });
    const closeRoomAction = phone.getByRole("button", { name: "Raum schließen", exact: true });
    await closeRoomAction.scrollIntoViewIfNeeded();
    await expectElementTopmost(closeRoomAction);
    await audit(phone, testInfo, "52b-party-phone-session-close-room-reachable", {
        fullPage: false,
    });
    await phone.getByRole("button", { name: "Spiel beenden" }).click();
    await expect(display.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    await audit(phone, testInfo, "53-party-phone-ended", { fullPage: true });
    await audit(display, testInfo, "54-party-display-ended-tv", { fullPage: false });

    await phoneContext.close();
    await displayContext.close();
});

test("visually audits Party Screen replacement-host attention", async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const hostContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 320, height: 568 },
    });
    const displayContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 800, height: 600 },
    });
    for (const context of [hostContext, displayContext]) {
        await context.addInitScript(() => {
            localStorage.setItem("party-game.locale", "de");
            localStorage.setItem("party-game.reduced-motion", "true");
        });
    }
    const host = await hostContext.newPage();
    const display = await displayContext.newPage();
    await host.emulateMedia({ reducedMotion: "reduce" });
    await display.emulateMedia({ reducedMotion: "reduce" });

    await chooseStandardHostSetup(display, /Wahrheit oder Pflicht/);
    await finishHostSetup(display, "party");
    const code = (await display.locator("main > header h1").textContent())!.trim();
    await joinPlayer(host, code, maximumName(1));
    await expect(display.locator(".host-status-banner.connected")).toContainText(maximumName(1));
    await hostContext.setOffline(true);
    await expect(display.locator(".host-status-banner.attention")).toContainText(
        "verbindet sich erneut",
    );
    await audit(display, testInfo, "54a-party-display-host-reconnecting-800x600", {
        fullPage: false,
    });
    await hostContext.setOffline(false);
    await expect(display.locator(".host-status-banner.connected")).toContainText(maximumName(1), {
        timeout: 10_000,
    });
    await host.getByRole("button", { name: "Lobby verlassen" }).click();
    await expect(display.locator(".host-status-banner.attention")).toContainText(
        "Wartet auf einen neuen Host",
    );
    await expectImagePaintedAndTopmost(display.locator(".join-card img"));
    await expectElementsDoNotIntersect(
        display.locator(".notification-lane"),
        display.locator(".app-location"),
    );
    await expectElementsDoNotIntersect(
        display.locator(".notification-toast"),
        display.locator(".room-size"),
    );
    await expectElementsDoNotIntersect(
        display.locator(".notification-toast"),
        display.locator(".host-status-banner"),
    );
    await audit(display, testInfo, "54b-party-display-awaiting-replacement-host-800x600", {
        fullPage: false,
    });
    const displayLocation = display.locator(".app-location");
    await expect
        .poll(() =>
            displayLocation.evaluate((element) => element.scrollHeight - element.clientHeight),
        )
        .toBeLessThanOrEqual(1);
    for (const surface of [
        display.locator(".host-status-banner"),
        display.locator(".room-settings-summary"),
        display.locator(".stage-player-roster"),
        display.locator(".join-card"),
    ]) {
        await expectElementContainedWithin(surface, displayLocation);
    }
    await expect(display.locator(".join-card")).toContainText("QR-Code lokal erzeugt");
    await expectImagePaintedAndTopmost(display.locator(".join-card img"));

    await hostContext.close();
    await displayContext.close();
});

test("visually audits the English interface on a narrow phone and TV viewport", async ({
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
        locale: "en-GB",
        viewport: { width: 320, height: 568 },
    });
    await context.addInitScript(() => {
        localStorage.setItem("party-game.locale", "en");
        localStorage.setItem("party-game.reduced-motion", "true");
    });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/play/");
    await expect(page.getByRole("button", { name: "Host game" })).toBeVisible();
    await audit(page, testInfo, "55-en-home-phone", { fullPage: true });
    await page.locator("html").evaluate((root) => (root.style.fontSize = "200%"));
    await audit(page, testInfo, "56-en-home-phone-200-percent-text-zoom", {
        fullPage: true,
    });
    await page.locator("html").evaluate((root) => (root.style.fontSize = ""));
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Host game" }).focus();
    await audit(page, testInfo, "57-en-home-phone-forced-colors-focus", { fullPage: false });
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await audit(page, testInfo, "58-en-home-tv", { fullPage: false });

    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole("button", { name: "Host game" }).click();
    await audit(page, testInfo, "59-en-setup-phone", { fullPage: true });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await audit(page, testInfo, "60-en-setup-tv", { fullPage: false });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole("button", { name: "No group" }).click();
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("button", { name: /^Truth or Dare/ }).click();
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("button", { name: /^Good friends / }).click();
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("button", { name: /This screen only/ }).click();
    await page.getByRole("button", { name: /Continue to lobby/ }).click();
    const playerRows = page.locator(".player-name-row");
    await playerRows.nth(0).getByRole("textbox").fill(maximumName(1));
    await playerRows.nth(1).getByRole("textbox").fill(maximumName(2));
    await page.getByRole("button", { name: "Start game" }).click();
    await page.getByRole("button", { name: "Truth", exact: true }).click();
    await expect(page.locator(".game-card")).toBeVisible();
    await audit(page, testInfo, "61-en-game-phone", { fullPage: true });
    await page.locator("html").evaluate((root) => (root.style.fontSize = "200%"));
    await audit(page, testInfo, "62-en-game-phone-200-percent-text-zoom", {
        fullPage: true,
    });
    const zoomedCardPager = page.locator(".game-card .auto-page-text");
    const zoomedCopy = zoomedCardPager.locator(visibleAutoPageCopy);
    const zoomedSource = (await zoomedCopy.getAttribute("aria-label")) ?? "";
    const zoomedPageCount = await expectCompleteTextPages(zoomedCardPager, zoomedSource, 5, true);
    await selectMeasuredPage(zoomedCardPager, zoomedPageCount - 1);
    await audit(page, testInfo, "62a-en-game-phone-200-percent-text-zoom-last-page", {
        fullPage: true,
    });
    await page.locator("html").evaluate((root) => (root.style.fontSize = ""));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await audit(page, testInfo, "63-en-game-tv", { fullPage: false });

    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await audit(page, testInfo, "64-en-settings-phone", { fullPage: false });
    await page.locator("html").evaluate((root) => (root.style.fontSize = "200%"));
    await audit(page, testInfo, "65-en-settings-phone-200-percent-text-zoom", {
        fullPage: false,
    });
    await page.locator("html").evaluate((root) => (root.style.fontSize = ""));
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.getByLabel("Close settings").focus();
    await audit(page, testInfo, "66-en-settings-phone-forced-colors-focus", {
        fullPage: false,
    });
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await audit(page, testInfo, "67-en-settings-tv", { fullPage: false });

    const helpPage = await context.newPage();
    await helpPage.emulateMedia({ reducedMotion: "reduce" });
    await helpPage.setViewportSize({ width: 320, height: 568 });
    await helpPage.goto("/play/help");
    await expect(helpPage.getByRole("heading", { name: "Help" })).toBeVisible();
    await audit(helpPage, testInfo, "68-en-help-phone", { fullPage: true });
    await helpPage.setViewportSize({ width: 1920, height: 1080 });
    await audit(helpPage, testInfo, "69-en-help-tv", { fullPage: false });
    await context.close();
});

function capturedPageIndex(capture: "first" | "middle" | "last", pageCount: number): number {
    if (capture === "middle") return Math.floor((pageCount - 1) / 2);
    if (capture === "last") return pageCount - 1;
    return 0;
}
