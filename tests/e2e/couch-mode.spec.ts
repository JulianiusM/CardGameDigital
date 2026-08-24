import { expect, test, type Page } from "@playwright/test";

async function reachCouch(
    page: Page,
    modeLabel: string,
    reveal: "anonymous" | "named" = "anonymous",
) {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: new RegExp(modeLabel) }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Freunde / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("heading", { name: "Erlebnis anpassen" })).toBeVisible();
    await expect(page.getByRole("slider", { name: /Startintensität/ })).toBeVisible();
    await expect(page.getByRole("slider", { name: /Endintensität/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nach Runden" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nach Karten" })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: /Steigerung alle/ })).toHaveValue("2");
    await expect(page.getByRole("slider", { name: /Stärke je Steigerung/ })).toHaveValue("1");
    if (modeLabel === "Ich hab noch nie") {
        await page
            .getByRole("button", { name: reveal === "named" ? /^Antworten offen/ : /^Anonym/ })
            .click();
    }
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Nur dieser Bildschirm/ }).click();
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await expect(page).toHaveURL(/\/play\/couch$/);
}

async function createGame(page: Page, modeLabel: string) {
    await reachCouch(page, modeLabel);
    expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await expect(page.getByText("Runde 1")).toBeVisible();
}

async function measureTrackSpeeds(page: Page): Promise<number[]> {
    const sample = page.locator(".track-motion");
    const segmentWidth = await page
        .locator('.track-segment[data-segment="0"]')
        .first()
        .evaluate((segment) => Number.parseFloat(getComputedStyle(segment).width));
    const speeds = await sample.evaluateAll(
        (tracks, width) =>
            tracks
                .slice(0, 6)
                .map(
                    (track) =>
                        track.getAnimations().find(({ id }) => id === "track-flow")!.playbackRate *
                        width,
                ),
        segmentWidth,
    );
    await page.waitForTimeout(800);
    return speeds;
}

test("Golden Mischief uses warm local surfaces and a motion-aware adaptive backdrop", async ({
    page,
}) => {
    await page.goto("/play/");
    await expect(page.locator(".adaptive-backdrop")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-family", "general");
    await expect(page.locator("html")).toHaveAttribute("data-intensity", "2");
    const backdropMetrics = await page.locator(".atmosphere-layer").evaluate((layer) => ({
        iconGap: Number(layer.getAttribute("data-icon-gap")),
        iconSize: Number(layer.getAttribute("data-icon-size")),
        slotCount: Number(layer.getAttribute("data-slot-count")),
        trackCount: Number(layer.getAttribute("data-track-count")),
        trackGap: Number(layer.getAttribute("data-track-gap")),
    }));
    expect(backdropMetrics.trackCount).toBeGreaterThanOrEqual(6);
    expect(backdropMetrics.slotCount).toBeGreaterThanOrEqual(8);
    expect(backdropMetrics.iconGap).toBeGreaterThan(backdropMetrics.iconSize * 2);
    expect(backdropMetrics.trackGap).toBeGreaterThan(backdropMetrics.iconSize * 2);
    await expect(page.locator(".motif-track")).toHaveCount(backdropMetrics.trackCount);
    await expect(page.locator(".incoming-symbol")).toHaveCount(
        backdropMetrics.trackCount * backdropMetrics.slotCount * 2,
    );

    await expect
        .poll(() =>
            page
                .locator(".atmosphere-layer")
                .evaluate((layer) => Number((layer as HTMLElement).dataset.adaptiveSymbolCount)),
        )
        .toBeGreaterThan(0);
    const atmosphereLayer = page.locator(".atmosphere-layer");
    const beforeGradientPhase = Number(await atmosphereLayer.getAttribute("data-gradient-phase"));
    const gradientProbe = { x: 420, y: 240 };
    const beforeGradientColor = await page
        .locator(".atmosphere-gradient")
        .evaluate((element, probe) => {
            const canvas = element as HTMLCanvasElement;
            const bounds = canvas.getBoundingClientRect();
            const x = Math.round((probe.x / bounds.width) * (canvas.width - 1));
            const y = Math.round((probe.y / bounds.height) * (canvas.height - 1));
            return [...canvas.getContext("2d")!.getImageData(x, y, 1, 1).data.slice(0, 3)];
        }, gradientProbe);
    const sampledSymbol = await page
        .locator(".incoming-symbol[data-adaptive-color]")
        .first()
        .elementHandle();
    const beforeSymbolColor = await sampledSymbol!.getAttribute("data-adaptive-color");
    const desktopTrackSpeeds = await measureTrackSpeeds(page);
    const afterGradientPhase = Number(await atmosphereLayer.getAttribute("data-gradient-phase"));
    expect(Math.min(...desktopTrackSpeeds)).toBeGreaterThan(35);
    expect(Math.max(...desktopTrackSpeeds)).toBeLessThan(55);
    const gradientPhaseMovement = (afterGradientPhase - beforeGradientPhase + 1) % 1;
    expect(gradientPhaseMovement).toBeGreaterThan(0.02);
    expect(gradientPhaseMovement).toBeLessThan(0.06);
    const diagonalTravel = (gradientPhaseMovement * 4096) / Math.sqrt(2);
    const translatedGradientColor = await page.locator(".atmosphere-gradient").evaluate(
        (element, probe) => {
            const canvas = element as HTMLCanvasElement;
            const bounds = canvas.getBoundingClientRect();
            const x = Math.round(((probe.x + probe.travel) / bounds.width) * (canvas.width - 1));
            const y = Math.round(((probe.y + probe.travel) / bounds.height) * (canvas.height - 1));
            return [...canvas.getContext("2d")!.getImageData(x, y, 1, 1).data.slice(0, 3)];
        },
        { ...gradientProbe, travel: diagonalTravel },
    );
    expect(
        Math.max(
            ...translatedGradientColor.map((channel, index) =>
                Math.abs(channel - beforeGradientColor[index]),
            ),
        ),
    ).toBeLessThanOrEqual(3);
    await expect
        .poll(() => sampledSymbol!.getAttribute("data-adaptive-color"))
        .not.toBe(beforeSymbolColor);

    const trackGeometry = await page.evaluate(() => {
        const field = document.querySelector<HTMLElement>(".motif-field")!;
        const firstTrack = document.querySelector<HTMLElement>(".motif-track")!;
        const segments = [...firstTrack.querySelectorAll<HTMLElement>(".track-segment")];
        const centers = [...segments[0].querySelectorAll<SVGElement>(".incoming-symbol")]
            .slice(0, 5)
            .map((symbol) => {
                const rect = symbol.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            });
        const spacing = centers
            .slice(1)
            .map((center, index) =>
                Math.hypot(center.x - centers[index].x, center.y - centers[index].y),
            );
        const sequences = [...document.querySelectorAll<HTMLElement>(".motif-track")].map(
            (track) => {
                const trackSegments = [...track.querySelectorAll<HTMLElement>(".track-segment")];
                return trackSegments.map((segment) =>
                    [...segment.querySelectorAll("use")].map((symbol) =>
                        symbol.getAttribute("href"),
                    ),
                );
            },
        );
        const animations = [...document.querySelectorAll<HTMLElement>(".track-motion")].map(
            (track) => track.getAnimations().find((animation) => animation.id === "track-flow")!,
        );
        const atmosphere = document.querySelector<HTMLElement>(".atmosphere-layer")!;
        const adaptiveSymbols = [
            ...document.querySelectorAll<SVGElement>(
                ".incoming-symbol[data-gradient-color][data-adaptive-color]",
            ),
        ];
        const trackTops = [...document.querySelectorAll<HTMLElement>(".motif-track")].map((track) =>
            Number.parseFloat(getComputedStyle(track).top),
        );
        return {
            animationDurations: animations.map((animation) => 1 / animation.playbackRate),
            animationNames: animations.map((animation) => animation.id),
            animationPlaybackRates: animations.map((animation) => animation.playbackRate),
            animationTiming: animations.map(
                (animation) => (animation.effect as KeyframeEffect).getTiming().easing,
            ),
            duplicateSegmentsMatch: sequences.every(
                ([first, second]) => JSON.stringify(first) === JSON.stringify(second),
            ),
            fieldDirection: new DOMMatrixReadOnly(getComputedStyle(field).transform).m12,
            adaptiveColors: new Set(adaptiveSymbols.map((symbol) => symbol.dataset.adaptiveColor))
                .size,
            gradientDirection: atmosphere.dataset.gradientDirection,
            gradientRenderer: atmosphere.dataset.gradientRenderer,
            renderedAdaptiveColors: new Set(
                adaptiveSymbols.map((symbol) => getComputedStyle(symbol).color),
            ).size,
            sampledGradientColors: new Set(
                adaptiveSymbols.map((symbol) => symbol.dataset.gradientColor),
            ).size,
            randomizedRows: new Set(sequences.map(([first]) => JSON.stringify(first))).size,
            spacing,
            trackSpacing: trackTops.slice(1).map((top, index) => top - trackTops[index]),
        };
    });
    expect(trackGeometry.animationNames.every((value) => value === "track-flow")).toBe(true);
    expect(trackGeometry.animationPlaybackRates.every((value) => value > 0)).toBe(true);
    expect(trackGeometry.animationTiming.every((value) => value === "linear")).toBe(true);
    expect(new Set(trackGeometry.animationDurations).size).toBeGreaterThan(1);
    expect(trackGeometry.duplicateSegmentsMatch).toBe(true);
    expect(trackGeometry.fieldDirection).toBeLessThan(0);
    expect(trackGeometry.gradientDirection).toBe("upper-left-to-lower-right");
    expect(trackGeometry.gradientRenderer).toBe("continuous-field");
    expect(trackGeometry.sampledGradientColors).toBeGreaterThan(3);
    expect(trackGeometry.adaptiveColors).toBeGreaterThan(3);
    expect(trackGeometry.renderedAdaptiveColors).toBeGreaterThan(3);
    expect(trackGeometry.randomizedRows).toBeGreaterThan(1);
    for (const spacing of trackGeometry.spacing) {
        expect(spacing).toBeCloseTo(backdropMetrics.iconGap, 0);
    }
    for (const spacing of trackGeometry.trackSpacing) {
        expect(spacing).toBeCloseTo(backdropMetrics.trackGap, 0);
    }

    const visualState = await page.evaluate(() => {
        const tile = document.querySelectorAll<HTMLElement>(".menu-tile")[1];
        const trigger = document.querySelector<HTMLElement>(".settings-trigger");
        const symbol = document.querySelector<SVGElement>(
            ".incoming-symbol[data-gradient-color][data-adaptive-color]",
        )!;
        const motifField = document.querySelector<HTMLElement>(".motif-field")!;
        const gradientField = document.querySelector<HTMLElement>(".gradient-field")!;
        return {
            gradientLayer: Number(getComputedStyle(gradientField).zIndex),
            ink: getComputedStyle(document.body).color,
            motifLayer: Number(getComputedStyle(motifField).zIndex),
            sampledGradient: symbol.dataset.gradientColor,
            symbolBlend: getComputedStyle(symbol).mixBlendMode,
            symbolColor: getComputedStyle(symbol).color,
            symbolOpacity: getComputedStyle(symbol).opacity,
            tile: getComputedStyle(tile).backgroundColor,
            tileFilter: getComputedStyle(tile).backdropFilter,
            trigger: getComputedStyle(trigger).backgroundColor,
        };
    });
    expect(visualState.ink).toBe("rgb(59, 36, 22)");
    expect(visualState.motifLayer).toBeGreaterThan(visualState.gradientLayer);
    expect(visualState.symbolBlend).toBe("normal");
    expect(visualState.sampledGradient).toMatch(/^\d+,\d+,\d+$/);
    expect(visualState.symbolColor).not.toBe("rgb(148, 80, 27)");
    expect(visualState.symbolOpacity).toBe("0.1");
    expect(visualState.tile).toBe("rgba(255, 248, 232, 0.94)");
    expect(visualState.tileFilter).toBe("none");
    expect(visualState.trigger).toBe("rgba(255, 248, 232, 0.72)");

    const motifGeometry = await page.evaluate(() => {
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const visibleSymbols = [...document.querySelectorAll<SVGElement>(".incoming-symbol")]
            .map((symbol) => symbol.getBoundingClientRect())
            .filter(
                (rect) =>
                    rect.right > 0 &&
                    rect.bottom > 0 &&
                    rect.left < viewport.width &&
                    rect.top < viewport.height,
            );
        const bottomRight = visibleSymbols.filter(
            (rect) =>
                rect.left + rect.width / 2 > viewport.width * 0.68 &&
                rect.top + rect.height / 2 > viewport.height * 0.68,
        ).length;
        const spark = document.querySelector<HTMLElement>(".spark")!.getBoundingClientRect();
        const sparkIcon = document
            .querySelector<SVGElement>(".spark .ui-icon")!
            .getBoundingClientRect();
        return {
            bottomRight,
            maximumSymbolSize: Math.max(
                ...visibleSymbols.map((rect) => Math.max(rect.width, rect.height)),
            ),
            sparkCenterOffset: Math.hypot(
                spark.left + spark.width / 2 - (sparkIcon.left + sparkIcon.width / 2),
                spark.top + spark.height / 2 - (sparkIcon.top + sparkIcon.height / 2),
            ),
            sparkWidth: spark.width,
        };
    });
    expect(motifGeometry.bottomRight).toBeGreaterThan(0);
    expect(motifGeometry.maximumSymbolSize).toBeLessThan(100);
    expect(motifGeometry.sparkCenterOffset).toBeLessThan(1);
    expect(motifGeometry.sparkWidth).toBeLessThan(60);

    const persistentTrack = await page.locator(".motif-track").first().elementHandle();
    const persistentGradient = await page.locator(".atmosphere-gradient").elementHandle();
    const pixelAtCanvasCenter = () =>
        persistentGradient!.evaluate((canvas) => {
            const gradient = canvas as HTMLCanvasElement;
            return [
                ...gradient
                    .getContext("2d")!
                    .getImageData(
                        Math.floor(gradient.width / 2),
                        Math.floor(gradient.height / 2),
                        1,
                        1,
                    )
                    .data.slice(0, 3),
            ];
        });
    const paletteBeforeTransition = await pixelAtCanvasCenter();
    const beforeTransitionOffset = await persistentTrack!.evaluate(
        (track) =>
            new DOMMatrixReadOnly(
                getComputedStyle(track.querySelector<HTMLElement>(".track-motion")!).transform,
            ).m41,
    );
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-family", "lobby");
    await expect(page.locator(".outgoing-symbol").first()).toBeAttached();
    await expect(atmosphereLayer).toHaveAttribute(
        "data-gradient-palette-progress",
        "transitioning",
    );
    await expect(atmosphereLayer).toHaveAttribute("data-gradient-transition-ms", "1100");
    await expect(page.locator(".atmosphere-gradient")).toHaveCount(1);
    expect(await persistentTrack!.evaluate((track) => track.isConnected)).toBe(true);
    expect(await persistentGradient!.evaluate((gradient) => gradient.isConnected)).toBe(true);
    const afterTransitionOffset = await persistentTrack!.evaluate(
        (track) =>
            new DOMMatrixReadOnly(
                getComputedStyle(track.querySelector<HTMLElement>(".track-motion")!).transform,
            ).m41,
    );
    const transitionMovement = Math.abs(afterTransitionOffset - beforeTransitionOffset);
    const wrappedTransitionMovement = Math.abs(
        transitionMovement - backdropMetrics.slotCount * backdropMetrics.iconGap,
    );
    expect(Math.min(transitionMovement, wrappedTransitionMovement)).toBeLessThan(50);
    const crossfadeAlignment = await page
        .locator(".motif-slot")
        .first()
        .evaluate((slot) => {
            const outgoing = slot
                .querySelector<SVGElement>(".outgoing-symbol")!
                .getBoundingClientRect();
            const incoming = slot
                .querySelector<SVGElement>(".incoming-symbol")!
                .getBoundingClientRect();
            return Math.hypot(
                outgoing.left + outgoing.width / 2 - (incoming.left + incoming.width / 2),
                outgoing.top + outgoing.height / 2 - (incoming.top + incoming.height / 2),
            );
        });
    expect(crossfadeAlignment).toBeLessThan(0.1);
    await page.waitForTimeout(450);
    const paletteDuringTransition = await pixelAtCanvasCenter();
    expect(paletteDuringTransition).not.toEqual(paletteBeforeTransition);
    await expect(atmosphereLayer).toHaveAttribute("data-gradient-palette-progress", "1", {
        timeout: 1_000,
    });
    const paletteAfterTransition = await pixelAtCanvasCenter();
    expect(paletteAfterTransition).not.toEqual(paletteBeforeTransition);
    await page.getByRole("button", { name: /Zurück/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-family", "general");
    await expect(page.getByRole("button", { name: /Spiel hosten/ })).toBeVisible();

    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.waitForTimeout(100);
    const wideGradient = await page.locator(".atmosphere-gradient").evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext("2d")!;
        const bounds = canvas.getBoundingClientRect();
        const row = context.getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data;
        let maximumAdjacentDelta = 0;
        const colors = new Set<string>();
        for (let pixel = 4; pixel < row.length; pixel += 4) {
            maximumAdjacentDelta = Math.max(
                maximumAdjacentDelta,
                Math.abs(row[pixel] - row[pixel - 4]),
                Math.abs(row[pixel + 1] - row[pixel - 3]),
                Math.abs(row[pixel + 2] - row[pixel - 2]),
            );
            colors.add(`${row[pixel]},${row[pixel + 1]},${row[pixel + 2]}`);
        }
        const corners = [
            context.getImageData(0, 0, 1, 1).data[3],
            context.getImageData(canvas.width - 1, 0, 1, 1).data[3],
            context.getImageData(0, canvas.height - 1, 1, 1).data[3],
            context.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data[3],
        ];
        return {
            colors: colors.size,
            corners,
            cssHeight: bounds.height,
            cssWidth: bounds.width,
            maximumAdjacentDelta,
            rasterHeight: canvas.height,
            rasterWidth: canvas.width,
        };
    });
    expect(wideGradient.cssWidth).toBe(2560);
    expect(wideGradient.cssHeight).toBe(1440);
    expect(wideGradient.rasterWidth).toBeGreaterThan(200);
    expect(wideGradient.rasterWidth).toBeLessThan(wideGradient.cssWidth);
    expect(wideGradient.rasterHeight).toBeLessThan(wideGradient.cssHeight);
    expect(wideGradient.corners.every((alpha) => alpha === 255)).toBe(true);
    expect(wideGradient.colors).toBeGreaterThan(20);
    expect(wideGradient.maximumAdjacentDelta).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const phoneTrackSpeeds = await measureTrackSpeeds(page);
    const averageDesktopSpeed =
        desktopTrackSpeeds.reduce((total, speed) => total + speed, 0) / desktopTrackSpeeds.length;
    const averagePhoneSpeed =
        phoneTrackSpeeds.reduce((total, speed) => total + speed, 0) / phoneTrackSpeeds.length;
    expect(Math.abs(averagePhoneSpeed - averageDesktopSpeed)).toBeLessThan(3);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(100);

    await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await expect(page.locator(".settings-modal")).toHaveCSS(
        "background-color",
        "rgba(255, 248, 232, 0.98)",
    );
    await expect(page.locator(".modal-backdrop")).toHaveCSS(
        "background-color",
        "rgba(59, 36, 22, 0.42)",
    );
    await page.getByRole("tab", { name: "Darstellung" }).click();
    await page.getByRole("checkbox", { name: /Bewegung reduzieren/ }).check();
    await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
    await expect
        .poll(() =>
            page
                .locator(".track-motion")
                .first()
                .evaluate((track) => track.getAnimations()[0]?.playState),
        )
        .toBe("paused");
    const frozenGradientPhase = Number(await atmosphereLayer.getAttribute("data-gradient-phase"));
    await page.waitForTimeout(350);
    expect(Number(await atmosphereLayer.getAttribute("data-gradient-phase"))).toBeCloseTo(
        frozenGradientPhase,
        5,
    );
    expect(
        await page.locator(".atmosphere-gradient").evaluate((canvas) => canvas.getAnimations()),
    ).toHaveLength(0);
    const reducedBackdropMotion = await page
        .locator(".motif-symbol")
        .first()
        .evaluate((symbol) => {
            const style = getComputedStyle(symbol);
            return { name: style.animationName, duration: style.animationDuration };
        });
    expect(reducedBackdropMotion.name).not.toContain("symbol-float");
    expect(reducedBackdropMotion.duration).toBe("0.2s");
    await page.getByLabel("Einstellungen schließen").click();
    await expect(page.getByRole("button", { name: /Spiel hosten/ })).toHaveCSS(
        "animation-name",
        "none",
    );
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-family", "lobby");
    await expect(atmosphereLayer).toHaveAttribute("data-gradient-transition-ms", "200");
    await expect(atmosphereLayer).toHaveAttribute("data-gradient-palette-progress", "1", {
        timeout: 500,
    });
    await page.getByRole("button", { name: /Zurück/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const phoneMotifs = await page.evaluate(() => {
        const visible = [...document.querySelectorAll<SVGElement>(".incoming-symbol")]
            .map((symbol) => symbol.getBoundingClientRect())
            .filter(
                (rect) =>
                    rect.right > 0 &&
                    rect.bottom > 0 &&
                    rect.left < innerWidth &&
                    rect.top < innerHeight,
            );
        const layer = document.querySelector<HTMLElement>(".atmosphere-layer")!;
        return {
            bottomRight: visible.some(
                (rect) =>
                    rect.left + rect.width / 2 > innerWidth * 0.65 &&
                    rect.top + rect.height / 2 > innerHeight * 0.65,
            ),
            iconGap: Number(layer.dataset.iconGap),
            maximumSize: Math.max(...visible.map((rect) => Math.max(rect.width, rect.height))),
            trackCount: Number(layer.dataset.trackCount),
            trackGap: Number(layer.dataset.trackGap),
        };
    });
    expect(phoneMotifs.bottomRight).toBe(true);
    expect(phoneMotifs.maximumSize).toBeLessThan(64);
    expect(phoneMotifs.iconGap).toBe(backdropMetrics.iconGap);
    expect(phoneMotifs.trackGap).toBe(backdropMetrics.trackGap);
    expect(phoneMotifs.trackCount).toBeLessThan(backdropMetrics.trackCount);
});

test("Couch Mode runs all four modes through the server-authoritative engine", async ({
    browser,
}) => {
    test.setTimeout(90_000);
    for (const mode of [
        "Wahrheit oder Pflicht",
        "Zufällige Wahl",
        "Ich hab noch nie",
        "Let's Talk",
    ]) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await createGame(page, mode);
        if (mode === "Wahrheit oder Pflicht") {
            await page.getByRole("button", { name: "Wahrheit", exact: true }).click();
        } else {
            await page.getByRole("button", { name: "Karte aufdecken" }).click();
        }
        await expect(page.locator(".game-card")).toBeVisible();
        await context.close();
    }
});

test("card text remains centered on a narrow, short viewport", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await createGame(page, "Wahrheit oder Pflicht");
    await page.getByRole("button", { name: "Wahrheit", exact: true }).click();
    const card = page.locator(".game-card");
    const text = card.locator("p");
    await expect(text).toBeVisible();
    const cardBox = (await card.boundingBox())!;
    const textBox = (await text.boundingBox())!;
    const cardCenter = cardBox.y + cardBox.height / 2;
    const textCenter = textBox.y + textBox.height / 2;
    expect(Math.abs(textCenter - cardCenter)).toBeLessThan(cardBox.height * 0.2);
});

test("game card and actions fit medium and TV viewports without document scrolling", async ({
    browser,
}) => {
    for (const viewport of [
        { width: 1024, height: 768 },
        { width: 1920, height: 1080 },
    ]) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await createGame(page, "Wahrheit oder Pflicht");
        await page.getByRole("button", { name: "Wahrheit", exact: true }).click();
        await expect(page.locator(".game-card")).toBeVisible();
        await expect(page.getByRole("button", { name: "Überspringen" })).toBeVisible();
        const viewportUsage = await page.evaluate(() => ({
            height: window.innerHeight,
            scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
        }));
        expect(viewportUsage.scrollHeight).toBeLessThanOrEqual(viewportUsage.height);
        const actionBox = (await page.locator(".actions").boundingBox())!;
        expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(viewport.height);
        const cardBox = (await page.locator(".game-card").boundingBox())!;
        expect(cardBox.width).toBeLessThanOrEqual(900);
        expect(cardBox.width / cardBox.height).toBeGreaterThan(1.45);
        expect(Math.abs(cardBox.x + cardBox.width / 2 - viewport.width / 2)).toBeLessThan(3);
        await context.close();
    }
});

test("main setup exposes Host, Join and Display and guards direct Host URLs", async ({ page }) => {
    await page.goto("/play/");
    await expect(page.getByRole("button", { name: /Spiel hosten/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Spiel beitreten/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Nur anzeigen/ })).toBeVisible();

    await page.goto("/play/host");
    await expect(page).toHaveURL(/\/play\/?$/);
    await expect(page.getByRole("button", { name: /Spiel hosten/ })).toBeVisible();
    await expect(page.getByText("Lobby", { exact: true })).toHaveCount(0);
});

test("navigation animates its component panel without invoking a document transition", async ({
    page,
}) => {
    await page.goto("/play/");
    await page.evaluate(() => {
        document.documentElement.dataset.documentTransitionCalls = "0";
        Object.defineProperty(document, "startViewTransition", {
            configurable: true,
            value: () => {
                const current = Number(
                    document.documentElement.dataset.documentTransitionCalls ?? "0",
                );
                document.documentElement.dataset.documentTransitionCalls = String(current + 1);
                throw new Error("Document-level transition must not be used");
            },
        });
    });

    await page.getByRole("button", { name: /Spiel hosten/ }).click();

    await expect(page.getByRole("heading", { name: /Mit wem spielt ihr/ })).toBeVisible();
    await expect(page.locator(".home-phase-transition")).toHaveCSS("animation-name", "phase-enter");
    await expect(page.locator(".app-location")).toHaveCSS("animation-name", "none");
    await expect(page.locator("html")).toHaveAttribute("data-document-transition-calls", "0");
});

test("Group step has exactly three choices and a new Group is immediately selected", async ({
    page,
}) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await expect(page.getByRole("button", { name: /Keine Gruppe/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Gruppe auswählen/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Neue Gruppe/ })).toBeVisible();
    await page.getByRole("button", { name: /Neue Gruppe/ }).click();
    const name = `Testgruppe ${Date.now()}`;
    await page.getByLabel("Gruppenname").fill(name);
    await page.getByLabel("Namen, durch Kommas getrennt").fill("Anna, Ben");
    await page.getByRole("button", { name: "Gruppe speichern" }).click();
    await expect(page.locator(".group-list-row.selected")).toContainText(name);
    const groupAction = page.getByRole("button", { name: new RegExp(name) });
    await groupAction.hover();
    await expect(groupAction).toHaveCSS("transform", "none");
    await expect(groupAction).toHaveCSS("box-shadow", "none");
    expect((await page.locator(".group-list").boundingBox())!.width).toBeLessThanOrEqual(
        (await page.locator(".wizard").boundingBox())!.width,
    );
    await expect(page.getByRole("button", { name: /Gruppe auswählen/ })).toHaveClass(/selected/);
    await page.getByRole("button", { name: /Zurück/ }).click();
    await page.getByRole("button", { name: new RegExp(`Gruppe fortsetzen: ${name}`) }).click();
    await expect(page.locator(".group-list-row.selected")).toContainText(name);
    await expect(page.getByRole("button", { name: /^Weiter/ })).toBeEnabled();
});

test("Custom profile exposes the full shared customization editor", async ({ page }) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("button", { name: "Überspringen" })).toHaveCount(0);
    await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Custom/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("heading", { name: /Themen/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Arten von Pflichten/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Zusätzliche Inhaltsregeln/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "ALLTAG" })).toBeVisible();
    await expect(page.getByRole("button", { name: "KUSS", exact: true })).toBeVisible();
    await expect(
        page.getByRole("button", { name: /Deutsch \(Deutschland\).*de-DE/ }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: /English \(United Kingdom\).*en-GB/ }),
    ).toBeVisible();
});

test("Never Have I Ever reveal policy lives only in Customize Experience", async ({ page }) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Ich hab noch nie/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(
        page.getByRole("heading", { name: "Welche Stimmung passt zu euch?" }),
    ).toBeVisible();
    await expect(
        page.getByRole("heading", { name: "Wie sollen die Antworten aufgedeckt werden?" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^Freunde / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("heading", { name: "Erlebnis anpassen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Anzeige der Antworten" })).toBeVisible();
    await expect(page.locator(".wizard-progress span")).toHaveCount(5);
});

test("Couch named Never Have I Ever uses public progress and neutral answer columns", async ({
    page,
}) => {
    await reachCouch(page, "Ich hab noch nie", "named");
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await page.getByRole("button", { name: "Karte aufdecken" }).click();
    await expect(page.getByText("Antworten werden aufgedeckt", { exact: true })).toBeVisible();
    const progress = page.locator(".vote-progress-list");
    await expect(progress).toContainText("Anna");
    await expect(progress).toContainText("Ben");
    await expect(progress.getByText("Wartet")).toHaveCount(2);

    await page
        .locator(".never-vote-row")
        .filter({ hasText: "Anna" })
        .getByRole("button", {
            name: "Trifft zu",
        })
        .click();
    await expect(progress.locator(".vote-progress-row").filter({ hasText: "Anna" })).toContainText(
        "Abgestimmt",
    );
    await expect(page.locator(".never-result-columns")).toHaveCount(0);

    await page
        .locator(".never-vote-row")
        .filter({ hasText: "Ben" })
        .getByRole("button", {
            name: "Trifft nicht zu",
        })
        .click();
    await expect(page.locator(".yes-column")).toContainText("Anna");
    await expect(page.locator(".no-column")).toContainText("Ben");
    await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await page.getByRole("tab", { name: "Aktuelle Spieleinstellungen" }).click();
    await expect(page.locator(".settings-modal")).toContainText("de-DE");
    await expect(page.locator(".settings-modal")).toContainText("Antworten werden aufgedeckt");
});

test("built-in profiles offer a validation-preserving Customize shortcut", async ({ page }) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await expect(page.locator(".home-phase-transition")).toHaveCSS("animation-name", "phase-enter");
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Freunde / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    const skip = page.getByRole("button", { name: /Überspringen/ });
    const next = page.getByRole("button", { name: /^Weiter/ });
    const styles = async (locator: typeof skip) =>
        locator.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
                background: style.backgroundColor,
                borderRadius: style.borderRadius,
                fontWeight: style.fontWeight,
                height: element.getBoundingClientRect().height,
                width: element.getBoundingClientRect().width,
            };
        });
    const skipStyles = await styles(skip);
    const nextStyles = await styles(next);
    expect({ ...skipStyles, height: undefined, width: undefined }).toEqual({
        ...nextStyles,
        height: undefined,
        width: undefined,
    });
    expect(Math.abs(skipStyles.height - nextStyles.height)).toBeLessThan(1);
    expect(Math.abs(skipStyles.width - nextStyles.width)).toBeLessThan(1);
    await skip.click();
    await expect(page.getByRole("heading", { name: /Bildschirme/ })).toBeVisible();
});

test("Couch lobby has canonical Settings and zero-card start stays with a warning", async ({
    page,
}) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Custom/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Nur dieser Bildschirm/ }).click();
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await expect(page.getByLabel("Einstellungen")).toBeVisible();
    const backToMain = page.getByRole("button", { name: /Zurück zum Hauptmenü/ });
    await expect(backToMain).toBeVisible();
    await expect(backToMain).toHaveClass(/text-action/);
    await expect(backToMain).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const backBox = (await backToMain.boundingBox())!;
    const setupBox = (await page.locator(".player-setup").boundingBox())!;
    expect(backBox.y + backBox.height).toBeLessThanOrEqual(setupBox.y);
    const addPlayer = page.getByRole("button", { name: /Person hinzufügen/ });
    const start = page.getByRole("button", { name: /Spiel starten/ });
    const addBox = (await addPlayer.boundingBox())!;
    const startBox = (await start.boundingBox())!;
    expect(startBox.y - (addBox.y + addBox.height)).toBeGreaterThanOrEqual(12);
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await expect(page.getByRole("alert")).toContainText(
        "Mit dem aktuellen Profil und den Einstellungen sind keine Karten verfügbar.",
    );
    await expect(page.getByRole("heading", { name: "Wer spielt mit?" })).toBeVisible();
});

test("Couch end summary offers a clean return to the main menu", async ({ page }) => {
    await createGame(page, "Wahrheit oder Pflicht");
    await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Session" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await page.getByRole("button", { name: "Spiel beenden" }).click();
    await expect(page.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    await page.getByRole("button", { name: "Zurück zum Hauptmenü" }).click();
    await expect(page).toHaveURL(/\/play\/?$/);
    await expect(page.getByRole("button", { name: /Spiel hosten/ })).toBeVisible();
});

test("same-device Couch player actions stay aligned on a narrow phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await reachCouch(page, "Wahrheit oder Pflicht");
    await page.getByRole("button", { name: /Person hinzufügen/ }).click();
    const row = page.locator(".player-name-row").last();
    await row.getByRole("textbox").fill("Eine sehr lange Person mit langem Namen");
    const input = (await row.getByRole("textbox").boundingBox())!;
    const remove = (await row.getByRole("button").boundingBox())!;
    expect(Math.abs(input.y + input.height / 2 - (remove.y + remove.height / 2))).toBeLessThan(4);
    expect((await row.boundingBox())!.width).toBeLessThanOrEqual(
        (await page.locator(".player-setup").boundingBox())!.width,
    );
});

test("shared tabs and wizard progress stay within a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    const wizard = page.locator(".wizard");
    const progress = page.locator(".wizard-progress");
    await expect(progress).toBeVisible();
    expect((await progress.boundingBox())!.width).toBeLessThanOrEqual(
        (await wizard.boundingBox())!.width,
    );

    await page.getByLabel("Einstellungen").click();
    const modal = page.locator(".settings-modal");
    const tabs = page.locator(".responsive-tabs");
    expect((await tabs.boundingBox())!.width).toBeLessThanOrEqual(
        (await modal.boundingBox())!.width,
    );
    const displayTab = tabs.getByRole("tab", { name: /Darstellung/ });
    const before = await displayTab.boundingBox();
    await displayTab.click();
    const after = await displayTab.boundingBox();
    expect(Math.abs(after!.width - before!.width)).toBeLessThan(2);
    expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);
    const viewport = page.locator(".responsive-tabs");
    const scrollBefore = await viewport.evaluate((element) => element.scrollLeft);
    const nextArrow = page.locator(".tab-scroll-arrow.next");
    await expect(nextArrow).toHaveCSS("box-shadow", "none");
    await expect(nextArrow).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    if (await nextArrow.isVisible()) {
        await nextArrow.click();
        await expect
            .poll(() => viewport.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(scrollBefore);
    }
});

test("Help topic tabs stay inside their article and support arrow scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/play/help");
    const panel = page.locator(".article-panel");
    const shell = page.locator(".responsive-tabs-shell");
    await expect(shell).toBeVisible();
    expect((await shell.boundingBox())!.width).toBeLessThanOrEqual(
        (await panel.boundingBox())!.width,
    );
    const viewport = page.locator(".responsive-tabs");
    const next = page.locator(".tab-scroll-arrow.next");
    if (await next.isVisible()) {
        await next.click();
        await expect
            .poll(() => viewport.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
    }
});

test("Help opens in a new tab and AUTH_MODE=none hides Account", async ({ page }) => {
    await page.goto("/play/account");
    await expect(page).toHaveURL(/\/play\/?$/);
    await expect(page.getByRole("heading", { name: /Anmelden/ })).toHaveCount(0);
    await page.goto("/play/");
    await page.getByLabel("Einstellungen").click();
    await page.getByRole("tab", { name: /Hilfe & Konto/ }).click();
    const help = page.getByRole("link", { name: "Hilfe öffnen" });
    await expect(help).toHaveAttribute("target", "_blank");
    await expect(help).toHaveAttribute("rel", /noopener/);
    await expect(page.getByRole("link", { name: "Konto öffnen" })).toHaveCount(0);
    const popup = page.waitForEvent("popup");
    await help.click();
    await expect(await popup).toHaveURL(/\/play\/help$/);
});

test("beforeunload protection is enabled only after setup becomes meaningful", async ({ page }) => {
    await page.goto("/play/");
    const isProtected = () =>
        page.evaluate(() => {
            const event = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        });
    expect(await isProtected()).toBe(false);
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    expect(await isProtected()).toBe(true);
});
