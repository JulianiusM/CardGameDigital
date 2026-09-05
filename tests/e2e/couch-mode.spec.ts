import { waitForPaint } from "./visual-audit-helpers";
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
        if (!localStorage.getItem("party-game.locale"))
            localStorage.setItem("party-game.locale", "de");
    });
});

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
    await expect(page.locator(".option-grid.profiles > button")).toHaveCount(6);
    await page.getByRole("button", { name: /^Gute Freunde / }).click();
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
    await waitForPaint(page);
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
    await expect(page.locator(".atmosphere-layer")).toHaveAttribute(
        "data-density-origin",
        "center",
    );
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
    const desktopTrackSpeeds = await measureTrackSpeeds(page);
    await expect
        .poll(
            async () => {
                const phase = Number(await atmosphereLayer.getAttribute("data-gradient-phase"));
                return (phase - beforeGradientPhase + 1) % 1;
            },
            { intervals: [50] },
        )
        .toBeGreaterThan(0.02);
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
        const trigger = document.querySelector<HTMLElement>(".settings-trigger")!;
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
    await expect.poll(pixelAtCanvasCenter).not.toEqual(paletteBeforeTransition);
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
    await waitForPaint(page);
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
    await waitForPaint(page);
    const phoneTrackSpeeds = await measureTrackSpeeds(page);
    const averageDesktopSpeed =
        desktopTrackSpeeds.reduce((total, speed) => total + speed, 0) / desktopTrackSpeeds.length;
    const averagePhoneSpeed =
        phoneTrackSpeeds.reduce((total, speed) => total + speed, 0) / phoneTrackSpeeds.length;
    expect(Math.abs(averagePhoneSpeed - averageDesktopSpeed)).toBeLessThan(3);
    await page.setViewportSize({ width: 1280, height: 720 });
    await waitForPaint(page);

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
    await waitForPaint(page);
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
    expect(phoneMotifs.trackCount).toBeGreaterThanOrEqual(backdropMetrics.trackCount);
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
        const context = await browser.newContext({ locale: "de-DE" });
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
    const trackCountBeforeReveal = Number(
        await page.locator(".atmosphere-layer").getAttribute("data-track-count"),
    );
    await page.getByRole("button", { name: "Wahrheit", exact: true }).click();
    const card = page.locator(".game-card");
    const text = card.locator(".auto-page-copy:not(.auto-page-measure)");
    await expect(text).toBeVisible();
    await expect(card.locator(".intensity-meter")).toHaveCount(2);
    await expect(card.locator(".card-intensity")).toHaveAttribute(
        "aria-label",
        /Kartenintensität [1-5]/,
    );
    await expect(card.locator(".global-intensity")).toHaveAttribute(
        "aria-label",
        /Globale Intensität [1-5]/,
    );
    const globalIntensity = (await card
        .locator(".global-intensity")
        .getAttribute("aria-label"))!.match(/[1-5]$/)![0];
    await expect(page.locator(".atmosphere-layer")).toHaveAttribute(
        "data-backdrop-intensity",
        globalIntensity,
    );
    expect(Number(await page.locator(".atmosphere-layer").getAttribute("data-track-count"))).toBe(
        trackCountBeforeReveal,
    );
    await expect(page.locator(".remaining-cards")).toContainText(/\d+ verfügbar/);
    await expect(page.locator(".status [data-adaptive-contrast]").first()).toHaveAttribute(
        "data-adaptive-tone",
        /dark|light/,
    );
    await expect(page.locator(".active-player[data-adaptive-contrast]")).toHaveAttribute(
        "data-adaptive-tone",
        /dark|light/,
    );
    await expect(card.locator(".card-symbol use")).toHaveCount(1);
    const cardBox = (await card.boundingBox())!;
    const cardSymbolBox = (await card.locator(".card-symbol").boundingBox())!;
    const textBox = (await text.boundingBox())!;
    const intensityBox = (await card.locator(".intensity-pair").boundingBox())!;
    const cardCenter = cardBox.y + cardBox.height / 2;
    const textCenter = textBox.y + textBox.height / 2;
    expect(Math.abs(textCenter - cardCenter)).toBeLessThan(cardBox.height * 0.2);
    expect(cardSymbolBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(cardSymbolBox.y).toBeGreaterThanOrEqual(cardBox.y);
    expect(cardSymbolBox.x + cardSymbolBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    expect(intensityBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(intensityBox.x + intensityBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    const cardFamily = await page.locator(".atmosphere-layer").getAttribute("data-backdrop-family");
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(page.locator(".atmosphere-layer")).toHaveAttribute(
        "data-backdrop-family",
        cardFamily!,
    );
    await expect(page.locator(".atmosphere-layer")).toHaveAttribute(
        "data-backdrop-intensity",
        globalIntensity,
    );
});

test("game card and actions fit medium and TV viewports without document scrolling", async ({
    browser,
}) => {
    for (const viewport of [
        { width: 1024, height: 768 },
        { width: 1920, height: 1080 },
    ]) {
        const context = await browser.newContext({ locale: "de-DE", viewport });
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

test("DataSpace, sensitivity and eligible Cards stay visible through quick setup", async ({
    page,
}) => {
    await page.goto("/play/");
    const dataSpace = page.locator(".active-dataspace-indicator");
    await expect(dataSpace).toContainText("Aktiver DataSpace");
    await expect(dataSpace).toContainText("Local");
    await expect(dataSpace).toHaveCSS("transition-property", /transform/);
    const dataSpaceHeight = (await dataSpace.boundingBox())!.height;
    expect(dataSpaceHeight).toBeGreaterThanOrEqual(44);
    expect(dataSpaceHeight).toBeLessThanOrEqual(48);
    await expect(page.locator(".home-context-status")).toHaveCSS("position", "absolute");

    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    const setupPreview = page.locator(".wizard-footer > .eligibility-preview");
    await expect(dataSpace).toBeVisible();
    await expect(setupPreview).toContainText("geeignete Karten");
    await expect(setupPreview.locator(".eligibility-preview-total > strong")).toHaveText(/\d+/);
    await expect(setupPreview).toHaveCSS("animation-name", "policy-control-enter");
    await expect(setupPreview).toHaveCSS("box-shadow", "none");
    expect(
        Number.parseFloat(
            await setupPreview
                .locator(".eligibility-preview-total > strong")
                .evaluate((element) => getComputedStyle(element).fontSize),
        ),
    ).toBeLessThanOrEqual(18);

    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(dataSpace).toBeVisible();
    await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(dataSpace).toBeVisible();
    await page.getByRole("button", { name: /^Kinderfreundlich / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(dataSpace).toBeVisible();

    const editor = page.locator(".game-settings-editor");
    const sensitivity = editor.getByRole("slider", {
        name: "Maximale soziale Sensibilität",
    });
    await expect(sensitivity).toHaveAttribute("aria-valuetext", "Tief persönlich");
    await expect(editor.locator(":scope > .eligibility-preview")).toHaveCount(0);
    await expect(page.locator(".wizard-footer > .eligibility-preview")).toContainText(
        "geeignete Karten",
    );

    await page.setViewportSize({ width: 360, height: 740 });
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(dataSpace).toBeVisible();
    await expect(page.locator(".wizard-footer > .eligibility-preview")).toContainText(
        "geeignete Karten",
    );
    await page.getByRole("button", { name: /Nur dieser Bildschirm/ }).click();
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await expect(page).toHaveURL(/\/play\/couch$/);
    await expect(page.locator(".active-dataspace-indicator")).toContainText("Local");
    await expect(page.locator(".player-setup .eligibility-preview")).toContainText(
        "geeignete Karten",
    );

    await page.getByLabel("Einstellungen").click();
    await page.getByRole("tab", { name: "Aktuelle Spieleinstellungen" }).click();
    await expect(page.locator(".settings-modal .eligibility-preview")).toContainText(
        "geeignete Karten",
    );
    await expect(page.locator(".settings-modal")).toContainText("Maximale soziale Sensibilität");
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
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

test("Group step exposes only persistence choices available to the current identity", async ({
    page,
}) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await expect(page.getByRole("button", { name: /Keine Gruppe/ })).toBeVisible();
    const deploymentMode = await page.evaluate(async () => {
        const response = await fetch("/api/v1/server-info");
        return ((await response.json()) as { deploymentMode: "local" | "public" }).deploymentMode;
    });
    if (deploymentMode === "public") {
        await expect(page.getByRole("button", { name: /Gruppe auswählen/ })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Neue Gruppe/ })).toHaveCount(0);
        await expect(
            page.getByRole("link", { name: /Für gespeicherte Gruppen anmelden/ }),
        ).toBeVisible();
        return;
    }
    await expect(page.getByRole("button", { name: /Gruppe auswählen/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Neue Gruppe/ })).toBeVisible();
    await page.getByRole("button", { name: /Neue Gruppe/ }).click();
    const name = `Testgruppe ${Date.now()}`;
    await page.getByLabel("Gruppenname").fill(name);
    await page.getByLabel("Namen, durch Kommas getrennt").fill("Anna, Ben");
    await page.getByRole("button", { name: "Gruppe speichern" }).click();
    await expect(page.locator(".group-list-row.selected")).toContainText(name);
    const groupAction = page.getByRole("option", { name: new RegExp(name) });
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

test("each Group restores its own Custom and Card-language settings", async ({ page }) => {
    test.setTimeout(60_000);
    const profiles = await (await page.request.get("/api/v1/game-profiles")).json();
    const customSeed = profiles.profiles.find(({ id }: { id: string }) => id === "PROFILE_CUSTOM");
    const configuration = ({
        enabledQuestionCategoryIds,
        enabledDareTypeIds,
        blockedOperationalFlags,
        startingIntensity,
        maximumIntensity,
        intensityProgressionUnit,
        intensityProgressionInterval,
        intensityProgressionIncrement,
        randomQuestionRatio,
        maximumTypeStreak,
        letsTalkMetaInterval,
    }: typeof customSeed) => ({
        enabledQuestionCategoryIds,
        enabledDareTypeIds,
        blockedOperationalFlags,
        startingIntensity,
        maximumIntensity,
        intensityProgressionUnit,
        intensityProgressionInterval,
        intensityProgressionIncrement,
        randomQuestionRatio,
        maximumTypeStreak,
        letsTalkMetaInterval,
    });
    const unique = Date.now();
    const firstName = `Gruppe Alpha ${unique}`;
    const secondName = `Gruppe Beta ${unique}`;
    const first = await (
        await page.request.post("/api/v1/groups", {
            data: { name: firstName, members: ["Ada", "Lin"] },
        })
    ).json();
    const second = await (
        await page.request.post("/api/v1/groups", {
            data: { name: secondName, members: ["Sam", "Jo"] },
        })
    ).json();
    const firstCustom = {
        ...configuration(customSeed),
        startingIntensity: 1,
        maximumIntensity: 2,
    };
    const secondCustom = {
        ...configuration(customSeed),
        startingIntensity: 3,
        maximumIntensity: 5,
    };
    const firstSaved = await page.request.put(`/api/v1/groups/${first.id}`, {
        data: {
            name: first.name,
            members: first.members,
            preferredProfileId: "PROFILE_CUSTOM",
            customConfiguration: firstCustom,
            cardLanguageSettings: {
                cardLocale: "de-DE",
                cardFallbackEnabled: true,
                cardFallbackLocales: ["en-US"],
            },
        },
    });
    expect(firstSaved.ok()).toBe(true);
    const secondSaved = await page.request.put(`/api/v1/groups/${second.id}`, {
        data: {
            name: second.name,
            members: second.members,
            preferredProfileId: "PROFILE_CUSTOM",
            customConfiguration: secondCustom,
            cardLanguageSettings: {
                cardLocale: "en-US",
                cardFallbackEnabled: false,
                cardFallbackLocales: ["de-DE"],
            },
        },
    });
    expect(secondSaved.ok()).toBe(true);
    const saved = (await (await page.request.get("/api/v1/game-settings")).json()).settings;
    const quickRoundSaved = await page.request.put("/api/v1/game-settings", {
        data: {
            ...saved,
            preferredProfileId: "PROFILE_CUSTOM",
            startingIntensity: 2,
            maximumIntensity: 4,
            customConfiguration: {
                ...configuration(customSeed),
                startingIntensity: 2,
                maximumIntensity: 4,
            },
            cardLanguageSettings: {
                cardLocale: "de-DE",
                cardFallbackEnabled: false,
                cardFallbackLocales: ["en-US"],
            },
        },
    });
    expect(quickRoundSaved.ok()).toBe(true);

    const openCustomization = async (groupName: string | null) => {
        if (groupName) {
            await page.getByRole("button", { name: /Gruppe auswählen/ }).click();
            await page.getByRole("option", { name: new RegExp(groupName) }).click();
        } else {
            await page.getByRole("button", { name: /Keine Gruppe/ }).click();
        }
        await page.getByRole("button", { name: /^Weiter/ }).click();
        await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
        await page.getByRole("button", { name: /^Weiter/ }).click();
        await page.getByRole("button", { name: /^Custom / }).click();
        await page.getByRole("button", { name: /^Weiter/ }).click();
    };
    const backToGroup = async () => {
        await page.getByRole("button", { name: /Zurück/ }).click();
        await page.getByRole("button", { name: /Zurück/ }).click();
        await page.getByRole("button", { name: /Zurück/ }).click();
    };
    const cardLanguages = () =>
        page.locator(".settings-section-card", {
            has: page.getByRole("heading", { name: "Kartensprache" }),
        });

    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await openCustomization(firstName);
    await expect(page.getByLabel("Startintensität")).toHaveValue("1");
    await expect(page.getByLabel("Endintensität")).toHaveValue("2");
    await expect(cardLanguages().getByRole("option", { name: /de-DE/ })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(page.getByLabel("Ersatzsprachen für Karten verwenden")).toBeChecked();

    await backToGroup();
    await openCustomization(secondName);
    await expect(page.getByLabel("Startintensität")).toHaveValue("3");
    await expect(page.getByLabel("Endintensität")).toHaveValue("5");
    await expect(cardLanguages().getByRole("option", { name: /en-US/ })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(page.getByLabel("Ersatzsprachen für Karten verwenden")).not.toBeChecked();

    await backToGroup();
    await openCustomization(null);
    await expect(page.getByLabel("Startintensität")).toHaveValue("2");
    await expect(page.getByLabel("Endintensität")).toHaveValue("4");
    await expect(cardLanguages().getByRole("option", { name: /de-DE/ })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(page.getByLabel("Ersatzsprachen für Karten verwenden")).not.toBeChecked();
});

test("configured legal links stay themed and leave the SPA open", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/play/");
    const imprint = page.getByRole("link", { name: "Impressum" });
    const privacy = page.getByRole("link", { name: "Datenschutzerklärung" });
    await expect(imprint).toHaveAttribute("href", "https://legal.example.test/imprint");
    await expect(privacy).toHaveAttribute("href", "https://legal.example.test/privacy");
    await expect(imprint).toHaveAttribute("target", "_blank");
    await expect(privacy).toHaveAttribute("target", "_blank");
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);

    await page.getByLabel("Einstellungen").click();
    await page.getByRole("tab", { name: "Hilfe & Konto" }).click();
    await expect(page.getByRole("heading", { name: "Rechtliche Informationen" })).toBeVisible();
    await expect(page.locator(".legal-actions").getByRole("link", { name: "Impressum" })).toHaveCSS(
        "border-radius",
        "14px",
    );
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
    await expect(page.getByRole("button", { name: "Alltag" })).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Freundschaftliche Küsse", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("option", { name: /Deutsch \(Deutschland\).*de-DE/ }),
    ).toBeVisible();
    await expect(page.getByRole("option", { name: /English \(USA\).*en-US/ })).toBeVisible();

    const intensitySection = page.locator(".behavior-settings");
    const startingIntensity = intensitySection.getByLabel("Startintensität");
    const endingIntensity = intensitySection.getByLabel("Endintensität");
    await startingIntensity.fill("4");
    await expect(endingIntensity).toHaveValue("4");
    await endingIntensity.fill("3");
    await expect(startingIntensity).toHaveValue("3");

    const questions = page.locator(".settings-section-card", {
        has: page.getByRole("heading", { name: /Themen/ }),
    });
    await questions.getByRole("button", { name: "Alle aktiv" }).click();
    await expect(questions.getByRole("button", { name: "Alltag" })).toHaveClass(/selected/);
    await questions.getByRole("button", { name: "Keine aktiv" }).click();
    await expect(questions.locator(".toggle-chip-grid button.selected")).toHaveCount(0);

    const dares = page.locator(".settings-section-card", {
        has: page.getByRole("heading", { name: /Arten von Pflichten/ }),
    });
    await dares.getByRole("button", { name: "Keine aktiv" }).click();
    await expect(dares.locator(".toggle-chip-grid button.selected")).toHaveCount(0);
    await dares.getByRole("button", { name: "Alle aktiv" }).click();
    await expect(dares.locator(".toggle-chip-grid button.selected")).toHaveCount(
        await dares.locator(".toggle-chip-grid button").count(),
    );

    const flags = page.locator(".settings-section-card", {
        has: page.getByRole("heading", { name: /Inhaltsregeln/ }),
    });
    await flags.getByRole("button", { name: "Alle aktiv" }).click();
    await expect(flags.locator(".toggle-chip-grid button.selected")).toHaveCount(
        await flags.locator(".toggle-chip-grid button").count(),
    );
    await flags.getByRole("button", { name: "Keine aktiv" }).click();
    await expect(flags.locator(".toggle-chip-grid button.selected")).toHaveCount(0);

    const bulkActionHeights = await page
        .locator(".bulk-selection-actions button")
        .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
    expect(bulkActionHeights).toHaveLength(6);
    expect(bulkActionHeights.every((height) => height >= 44)).toBe(true);
});

test("a completed no-group Custom setup restores only its dedicated DataSpace snapshot", async ({
    page,
}) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Custom / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();

    const behavior = page.locator(".behavior-settings");
    await behavior.getByLabel("Endintensität").fill("4");
    await behavior.getByLabel("Startintensität").fill("2");
    const questions = page.locator(".settings-section-card", {
        has: page.getByRole("heading", { name: /Themen/ }),
    });
    await questions.getByRole("button", { name: "Keine aktiv" }).click();
    await questions.getByRole("button", { name: "Freundschaft" }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Nur dieser Bildschirm/ }).click();
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();

    const persisted = await page.evaluate(async () => {
        const response = await fetch("/api/v1/game-settings");
        return (await response.json()) as {
            settings: {
                customConfiguration: {
                    startingIntensity: number;
                    maximumIntensity: number;
                    enabledQuestionCategoryIds: string[];
                };
            };
        };
    });
    expect(persisted.settings.customConfiguration).toMatchObject({
        startingIntensity: 2,
        maximumIntensity: 4,
        enabledQuestionCategoryIds: ["CAT_FRIENDSHIP"],
    });

    await page.getByRole("button", { name: "Zurück zum Hauptmenü" }).click();
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await expect(page.getByRole("button", { name: /Keine Gruppe/ })).toHaveClass(/selected/);
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Custom / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(behavior.getByLabel("Startintensität")).toHaveValue("2");
    await expect(behavior.getByLabel("Endintensität")).toHaveValue("4");
    await expect(questions.locator(".toggle-chip-grid button.selected")).toHaveCount(1);
    await expect(questions.getByRole("button", { name: "Freundschaft" })).toHaveClass(/selected/);
});

test("interface language defaults to the browser and can be explicitly overridden", async ({
    browser,
}) => {
    const context = await browser.newContext({ locale: "en-GB" });
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/play/");
    await expect(page.getByRole("heading", { name: "What can happen tonight?" })).toBeVisible();
    await page.getByLabel("Settings").click();
    await page.getByRole("tab", { name: "Display" }).click();
    await expect(page.getByLabel("Use system language")).toBeChecked();
    const interfaceLanguage = page.locator(".interface-language-setting");
    await expect(interfaceLanguage.getByRole("option", { name: /English/ })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await page.getByLabel("Interface language", { exact: true }).fill("Deutsch");
    await interfaceLanguage.getByRole("option", { name: /Deutsch/ }).click();
    await expect(page.getByRole("heading", { name: "Was darf heute passieren?" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await page.getByLabel("Einstellungen").click();
    await page.getByRole("tab", { name: "Darstellung" }).click();
    await expect(page.getByLabel("Systemsprache verwenden")).not.toBeChecked();
    await expect(interfaceLanguage.getByRole("option", { name: /Deutsch/ })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    await context.close();
});

test("changing interface language keeps an active Couch game without a leave prompt", async ({
    page,
}) => {
    await createGame(page, "Wahrheit oder Pflicht");
    let leavePromptShown = false;
    page.on("dialog", async (dialog) => {
        leavePromptShown = true;
        await dialog.accept();
    });
    await page.getByLabel("Einstellungen").click();
    await page.getByRole("tab", { name: "Darstellung" }).click();
    const interfaceLanguage = page.locator(".interface-language-setting");
    await page.getByLabel("Sprache der Oberfläche", { exact: true }).fill("English");
    await interfaceLanguage.getByRole("option", { name: /English/ }).click();

    await expect(page).toHaveURL(/\/play\/couch$/);
    await expect(page.getByText("Round 1")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Truth or dare?" })).toBeVisible();
    expect(leavePromptShown).toBe(false);
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
    await page.getByRole("button", { name: /^Gute Freunde / }).click();
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
    await page.getByRole("button", { name: /^Gute Freunde / }).click();
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
    expect(Math.abs(skipStyles.width - nextStyles.width)).toBeLessThanOrEqual(1.1);
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
    const questions = page.locator(".settings-section-card", {
        has: page.getByRole("heading", { name: /Themen/ }),
    });
    const dares = page.locator(".settings-section-card", {
        has: page.getByRole("heading", { name: /Arten von Pflichten/ }),
    });
    await questions.getByRole("button", { name: "Keine aktiv" }).click();
    await dares.getByRole("button", { name: "Keine aktiv" }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Nur dieser Bildschirm/ }).click();
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await expect(page.getByLabel("Einstellungen")).toBeVisible();
    const backToMain = page.getByRole("button", { name: /Zurück zum Hauptmenü/ });
    await expect(backToMain).toBeVisible();
    await expect(backToMain).toHaveClass(/text-action/);
    await expect(backToMain).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const layoutGaps = await page.locator(".player-setup").evaluate((setup) => {
        const back = setup.previousElementSibling;
        const addPlayer = setup.querySelector(".add-player");
        const start = setup.querySelector(".primary-action");
        if (!back || !addPlayer || !start) throw new Error("Incomplete Couch lobby layout");
        const backBox = back.getBoundingClientRect();
        const setupBox = setup.getBoundingClientRect();
        const addBox = addPlayer.getBoundingClientRect();
        const startBox = start.getBoundingClientRect();
        return {
            backToSetup: setupBox.top - backBox.bottom,
            addToStart: startBox.top - addBox.bottom,
        };
    });
    expect(layoutGaps.backToSetup).toBeGreaterThanOrEqual(0);
    expect(layoutGaps.addToStart).toBeGreaterThanOrEqual(12);
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

test("a fresh Couch game after the summary restores the authenticated account name", async ({
    page,
}) => {
    await page.route("**/api/v1/account/status", async (route) => {
        await route.fulfill({
            json: {
                authenticationAvailable: true,
                localLoginEnabled: true,
                oidcEnabled: false,
                oidcName: "",
                imprintUrl: "",
                privacyPolicyUrl: "",
                deploymentMode: "local",
                authenticated: true,
                account: {
                    user: {
                        id: 7,
                        username: "account-user",
                        name: "Konto Name",
                        email: "account@example.test",
                    },
                    activeDataSpaceId: "space-1",
                    dataSpaces: [{ id: "space-1", name: "Testbereich", defaultForOwner: true }],
                    languagePreferences: null,
                },
            },
        });
    });

    await reachCouch(page, "Wahrheit oder Pflicht");
    const firstPlayer = page.locator(".player-name-row").first().getByRole("textbox");
    await expect(firstPlayer).toHaveValue("Konto Name");
    await firstPlayer.fill("Gastgeber auf Zeit");
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await page.getByLabel("Einstellungen").click();
    await page.getByRole("tab", { name: "Session" }).click();
    await page.getByRole("button", { name: "Spiel beenden" }).click();
    await page.getByRole("button", { name: "Neues Spiel" }).click();
    await expect(page.locator(".player-name-row").first().getByRole("textbox")).toHaveValue(
        "Konto Name",
    );
});

test("account Group management remains searchable and bounded with hundreds of Groups", async ({
    page,
}) => {
    const groups = Array.from({ length: 205 }, (_, index) => ({
        id: `group-${String(index + 1).padStart(3, "0")}`,
        name: `Gruppe ${String(index + 1).padStart(3, "0")}`,
        members: [`Person ${index + 1}`, `Mitglied ${index + 1}`],
        updatedAt: new Date(2026, 0, 1).toISOString(),
        historyResetAt: null,
        preferredProfileId: "PROFILE_FRIENDS",
        customConfiguration: null,
        cardLanguageSettings: null,
    }));
    const account = {
        user: {
            id: 8,
            username: "group-manager",
            name: "Gruppenverwaltung",
            email: "groups@example.test",
        },
        activeDataSpaceId: "space-many",
        dataSpaces: [{ id: "space-many", name: "Viele Gruppen", defaultForOwner: true }],
        languagePreferences: null,
    };
    await page.route("**/api/v1/account/status", (route) =>
        route.fulfill({
            json: {
                authenticationAvailable: true,
                localLoginEnabled: true,
                oidcEnabled: false,
                oidcName: "",
                imprintUrl: "",
                privacyPolicyUrl: "",
                deploymentMode: "local",
                authenticated: true,
                account,
            },
        }),
    );
    await page.route("**/api/v1/account/sessions", (route) =>
        route.fulfill({ json: { sessions: [] } }),
    );
    await page.route("**/api/v1/groups", (route) => route.fulfill({ json: { groups } }));
    await page.route("**/api/v1/game-settings", (route) =>
        route.fulfill({ json: { settings: { preferredProfileId: "PROFILE_FRIENDS" } } }),
    );

    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/play/account");
    await page.getByRole("tab", { name: "Gruppen" }).click();
    await expect(page.getByRole("heading", { name: "Gruppen verwalten" })).toBeVisible();
    await expect(page.locator(".group-browser-row")).toHaveCount(16);
    await expect(page.locator(".group-browser-pagination")).toContainText("1 / 13");
    await page.getByLabel("Gruppen durchsuchen").fill("Person 173");
    await expect(page.getByRole("option", { name: /Gruppe 173/ })).toBeVisible();
    await expect(page.locator(".group-browser-row")).toHaveCount(1);
    await page.getByRole("option", { name: /Gruppe 173/ }).click();
    await expect(page.locator(".group-editor-card").getByLabel("Gruppenname")).toHaveValue(
        "Gruppe 173",
    );
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
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
    await expect(viewport.getByRole("tab")).toHaveText([
        "Hilfe im Überblick",
        "Schnellstart und Spielaufbau",
        "Spielmodi und Karten",
        "Räume, Geräte und Spielleitung",
        "Grenzen und respektvolles Spielen",
        "Konten und gespeicherte Daten",
        "Kartenverwaltung",
        "Probleme lösen",
    ]);
    const next = page.locator(".tab-scroll-arrow.next");
    if (await next.isVisible()) {
        await next.click();
        await expect
            .poll(() => viewport.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
    }
});

test("Help and Account navigation reflect server capabilities", async ({ page, request }) => {
    const serverInfo = await (await request.get("/api/v1/server-info")).json();
    if (!serverInfo.authenticationAvailable) {
        await page.goto("/play/account");
        await expect(page).toHaveURL(/\/play\/?$/);
        await expect(page.getByRole("heading", { name: /Anmelden/ })).toHaveCount(0);
    }
    await page.goto("/play/");
    await page.getByLabel("Einstellungen").click();
    await page.getByRole("tab", { name: /Hilfe & Konto/ }).click();
    const help = page.getByRole("link", { name: "Hilfe öffnen" });
    await expect(help).toHaveAttribute("target", "_blank");
    await expect(help).toHaveAttribute("rel", /noopener/);
    const account = page.getByRole("link", { name: /Konto/ });
    await expect(account).toHaveCount(serverInfo.authenticationAvailable ? 1 : 0);
    if (serverInfo.authenticationAvailable) {
        await expect(account).toHaveAttribute("target", "_blank");
        await expect(account).toHaveAttribute("rel", /noopener/);
    }
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

test("Card management stays bounded and Session changes return to quick setup", async ({
    page,
}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/play/cards");
    await expect(page.getByRole("heading", { name: "Kartenverwaltung" })).toBeVisible();
    await expect(page.locator("main.card-management-shell > .card-management-frame")).toBeVisible();
    await expect(page.getByText("Aktueller Datenraum", { exact: true })).toBeVisible();

    const scopeActions = page.locator(".policy-scope-actions > *");
    await expect(scopeActions).toHaveCount(3);
    for (const action of await scopeActions.all()) {
        await expect(action).toHaveCSS("white-space", "normal");
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        const overflow = await action.evaluate((element) => ({
            horizontal: element.scrollWidth - element.clientWidth,
            vertical: element.scrollHeight - element.clientHeight,
        }));
        expect(overflow.horizontal).toBeLessThanOrEqual(1);
        expect(overflow.vertical).toBeLessThanOrEqual(1);
    }
    const scopeChooser = page.getByRole("button", { name: "DataSpace / Gruppe wählen" });
    await scopeChooser.click();

    await expect(
        page.getByRole("heading", { name: "Karteneigenschaften überschreiben" }).first(),
    ).toBeVisible();
    await expect(page.getByText("Kartenabstimmung", { exact: true })).toHaveCount(0);
    await expect(
        page.getByText(/Diese Einstellungen überschreiben den eigenen Wert jeder passenden Karte/),
    ).toBeVisible();
    await expect(page.getByText("Wähle, was du bearbeitest", { exact: true })).toBeVisible();
    await expect(page.locator(".policy-scope-picker")).toHaveCSS(
        "animation-name",
        "policy-control-enter",
    );
    await expect(page.getByText("DATASPACE-STANDARD", { exact: true })).toBeVisible();
    await expect(page.getByText("GRUPPENAUSNAHMEN", { exact: true })).toBeVisible();
    const currentDataSpace = page.locator(".policy-scope-option").first();
    await expect(currentDataSpace).toHaveClass(/selected/);
    await expect(currentDataSpace.locator("strong")).toHaveCSS("white-space", "normal");
    await expect(currentDataSpace.locator("small")).toHaveCSS("white-space", "normal");
    await scopeChooser.click();

    const availability = page.getByRole("group", { name: "Verfügbarkeit" }).first();
    const exclude = availability.getByRole("button", { name: "Ausschließen", exact: true });
    const inherit = availability.getByRole("button", { name: "Erben", exact: true });
    await expect(exclude).toHaveCSS("transition-property", /transform/);
    await exclude.click();
    await expect(exclude).toHaveAttribute("aria-pressed", "true");
    await inherit.click();
    await expect(inherit).toHaveAttribute("aria-pressed", "true");

    const sensitivityMode = page.getByRole("group", { name: "Soziale Sensibilität" }).first();
    await sensitivityMode.getByRole("button", { name: "Wert überschreiben" }).click();
    const sensitivityScale = page.getByRole("slider", { name: "Soziale Sensibilität" });
    await expect(sensitivityScale).toHaveAttribute("aria-valuetext", "Explizit");
    await sensitivityScale.fill("2");
    await expect(sensitivityScale).toHaveAttribute("aria-valuetext", "Nah persönlich");
    await sensitivityMode.getByRole("button", { name: "Katalogwert" }).click();
    await sensitivityMode.getByRole("button", { name: "Wert überschreiben" }).click();
    await expect(sensitivityScale).toHaveAttribute("aria-valuetext", "Nah persönlich");

    const intensityMode = page.getByRole("group", { name: "Kartenintensität" }).first();
    await intensityMode.getByRole("button", { name: "Wert überschreiben" }).click();
    await expect(page.getByRole("slider", { name: "Kartenintensität" })).toHaveAttribute(
        "aria-valuetext",
        "Stufe 1 von 5",
    );
    await expect(page.getByText(/Jede passende Karte erhält die relative Stufe 1/)).toBeVisible();

    await page.getByRole("tab", { name: "Bedingte Regeln" }).click();
    await expect(page.locator(".card-policy-workspace")).toHaveCSS(
        "animation-name",
        "policy-control-enter",
    );
    await page.getByRole("button", { name: "Regel hinzufügen" }).click();
    await expect(
        page.getByText("Die Vorschau ist optional und ändert oder speichert die Regel nicht."),
    ).toBeVisible();
    const saveRule = page
        .locator(".policy-sticky-actions")
        .getByRole("button", { name: "Speichern", exact: true });
    await expect(saveRule).toBeEnabled();
    await saveRule.click();
    await expect(page.getByRole("status")).toContainText("Kartenrichtlinie gespeichert");
    await page.getByRole("button", { name: "Regel löschen", exact: true }).click();
    await page
        .locator(".policy-confirmation-card")
        .getByRole("button", { name: "Regel löschen", exact: true })
        .click();
    await expect(page.getByText("Bedingte Regel gelöscht.", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Kartenausnahmen" }).click();
    await expect(page.getByText(/Karten 1–\d+ von \d+/)).toBeVisible();
    await page.locator(".card-filter-drawer > summary").click();
    await expect(page.locator(".policy-master-pane")).toHaveCSS("overflow-y", "visible");
    const pageButtons = page.locator(".policy-master-pane .policy-pagination button");
    await expect(pageButtons).toHaveCount(2);
    const previousBox = (await pageButtons.nth(0).boundingBox())!;
    const nextBox = (await pageButtons.nth(1).boundingBox())!;
    expect(Math.abs(previousBox.width - nextBox.width)).toBeLessThanOrEqual(1);
    await expect(page.locator(".managed-card-id")).toContainText(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
    await expect(page.locator(".managed-card-id")).toHaveCSS("align-items", "baseline");
    await expect(page.locator(".managed-card-id")).toHaveCSS("border-left-style", "solid");
    const cardMetadataFonts = await page.locator(".managed-card-meta").evaluate((metadata) => {
        const taxonomy = metadata.querySelector<HTMLElement>(".managed-card-taxonomy")!;
        const id = metadata.querySelector<HTMLElement>(".managed-card-id")!;
        return {
            id: getComputedStyle(id).fontFamily,
            taxonomy: getComputedStyle(taxonomy).fontFamily,
        };
    });
    expect(cardMetadataFonts.id).toBe(cardMetadataFonts.taxonomy);
    const firstManagedCard = page.locator(".managed-card-list > button").first();
    await expect(firstManagedCard).toHaveCSS("overflow", "visible");
    await expect(firstManagedCard.locator(".managed-card-copy strong")).toHaveCSS(
        "overflow-wrap",
        "anywhere",
    );
    const measureWrappedCardRow = () =>
        page.locator(".managed-card-list > button").evaluateAll((rows) => {
            for (const row of rows) {
                const icon = row.querySelector<HTMLElement>(".managed-card-type");
                const excerpt = row.querySelector<HTMLElement>(".managed-card-copy strong");
                const metadata = row.querySelector<HTMLElement>(".managed-card-copy small");
                if (!icon || !excerpt || !metadata) continue;
                const excerptLineHeight = Number.parseFloat(getComputedStyle(excerpt).lineHeight);
                const excerptBox = excerpt.getBoundingClientRect();
                if (excerptBox.height < excerptLineHeight * 1.5) continue;
                const rowBox = row.getBoundingClientRect();
                const iconBox = icon.getBoundingClientRect();
                const metadataBox = metadata.getBoundingClientRect();
                return {
                    excerptLines: excerptBox.height / excerptLineHeight,
                    iconCenterOffset:
                        iconBox.top + iconBox.height / 2 - (rowBox.top + rowBox.height / 2),
                    metadataBottomInset: rowBox.bottom - metadataBox.bottom,
                    metadataHeight: metadataBox.height,
                    metadataLineHeight: Number.parseFloat(getComputedStyle(metadata).lineHeight),
                };
            }
            return null;
        });
    const desktopWrappedRow = await measureWrappedCardRow();
    expect(desktopWrappedRow).not.toBeNull();
    expect(desktopWrappedRow!.excerptLines).toBeGreaterThan(1.5);
    expect(Math.abs(desktopWrappedRow!.iconCenterOffset)).toBeLessThanOrEqual(2);
    expect(desktopWrappedRow!.metadataBottomInset).toBeGreaterThan(4);
    expect(desktopWrappedRow!.metadataHeight).toBeGreaterThanOrEqual(
        desktopWrappedRow!.metadataLineHeight,
    );
    await expect(page.locator(".property-provenance-card")).toHaveCount(8);
    await expect(page.getByText("socialSensitivity", { exact: true })).toHaveCount(0);
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    await page.setViewportSize({ width: 360, height: 740 });
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    const narrowWrappedRow = await measureWrappedCardRow();
    expect(narrowWrappedRow).not.toBeNull();
    expect(Math.abs(narrowWrappedRow!.iconCenterOffset)).toBeLessThanOrEqual(2);
    expect(narrowWrappedRow!.metadataBottomInset).toBeGreaterThan(4);

    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Gute Freunde / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("heading", { name: "Erlebnis anpassen" })).toBeVisible();
    await page.getByRole("link", { name: /Kartenverwaltung öffnen/ }).click();

    await expect(page).toHaveURL(/\/play\/cards\?scope=session/);
    await expect(page.getByText("Dieses Spiel", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Soziale Sensibilität" })).toHaveCount(0);
    await page
        .getByRole("group", { name: "Verfügbarkeit" })
        .first()
        .getByRole("button", { name: "Ausschließen", exact: true })
        .click();
    await page.getByRole("button", { name: "Richtlinie speichern" }).click();
    await page.getByRole("link", { name: /Zurück zur Spieleinrichtung/ }).click();
    await expect(page).toHaveURL(/setup=customize/);
    const pendingPolicy = await page.evaluate(() => {
        const stored = sessionStorage.getItem("party-game:setup");
        return stored ? JSON.parse(stored).cardPolicy : null;
    });
    expect(pendingPolicy).toMatchObject({
        scopeDefault: { availability: "EXCLUDE" },
    });
});

test("Card management bounds thousand-entry Group and rule collections", async ({ page }) => {
    const stableId = (index: number) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const groups = Array.from({ length: 1_000 }, (_, index) => ({
        id: stableId(index + 1),
        name: `Gruppe ${String(index + 1).padStart(4, "0")}`,
        members: [`Person ${index + 1}`],
    }));
    const rules = Array.from({ length: 1_000 }, (_, index) => ({
        id: stableId(index + 2_000),
        name: `Regel ${String(index + 1).padStart(4, "0")}`,
        order: (index + 1) * 10,
        enabled: false,
        predicate: {},
        directives: {},
        revision: 0,
    }));
    await page.route("**/api/v1/groups", (route) =>
        route.fulfill({ contentType: "application/json", body: JSON.stringify({ groups }) }),
    );
    await page.route("**/api/v1/card-policy/rules", (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ rules }) });
    });

    await page.goto("/play/cards");
    await page.getByRole("button", { name: "DataSpace / Gruppe wählen" }).click();
    await expect(page.locator(".policy-scope-group-list .policy-scope-option")).toHaveCount(8);
    await expect(page.getByText("1000 Gruppen", { exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: "Gruppe finden" }).fill("0999");
    await expect(page.locator(".policy-scope-group-list .policy-scope-option")).toHaveCount(1);
    await expect(page.getByText("Gruppe 0999", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Bedingte Regeln" }).click();
    await expect(page.locator(".policy-rule-select")).toHaveCount(10);
    await expect(page.locator(".policy-rule-row-actions")).toHaveCount(10);
    await expect(page.getByRole("button", { name: /Nach unten: Regel 0001/ })).toBeVisible();
    await expect(page.getByText("1000 Regeln", { exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: "Regeln durchsuchen" }).fill("0999");
    await expect(page.locator(".policy-rule-select")).toHaveCount(1);
    await expect(page.getByText("Regel 0999", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 700 });
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
});

test("Account DataSpace browser bounds a thousand entries and reveals the active page", async ({
    page,
}) => {
    const stableId = (index: number) =>
        `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const dataSpaces = Array.from({ length: 1_000 }, (_, index) => ({
        id: stableId(index + 1),
        name: `DataSpace ${String(index + 1).padStart(4, "0")}`,
        defaultForOwner: index === 0,
    }));
    const account = {
        user: {
            id: 1,
            username: "scale-user",
            name: "Scale User",
            email: "scale@example.test",
        },
        activeDataSpaceId: dataSpaces[996].id,
        dataSpaces,
        languagePreferences: null,
    };
    await page.route("**/api/v1/account/status", (route) =>
        route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                authenticationAvailable: true,
                localLoginEnabled: true,
                oidcEnabled: false,
                oidcName: "",
                imprintUrl: "",
                privacyPolicyUrl: "",
                deploymentMode: "public",
                authenticated: true,
                account,
            }),
        }),
    );
    await page.route("**/api/v1/account/sessions", (route) =>
        route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ sessions: [] }),
        }),
    );

    await page.goto("/play/account");
    await expect(page.locator(".data-space-card")).toHaveCount(8);
    await expect(page.locator(".data-space-pagination > span")).toHaveText("125 / 125");
    await expect(page.locator(".data-space-card.active")).toContainText("DataSpace 0997");
    await page.getByRole("searchbox", { name: "DataSpaces durchsuchen" }).fill("0012");
    await expect(page.locator(".data-space-card")).toHaveCount(1);
    await expect(page.locator(".data-space-card")).toContainText("DataSpace 0012");
    await page.getByRole("tab", { name: "Daten & Konto" }).click();
    const adjacentActions = [
        page.getByRole("link", { name: /Gespeicherte Runde starten/ }),
        page.getByRole("link", { name: /Daten exportieren/ }),
        page.getByRole("button", { name: "Abmelden", exact: true }),
    ];
    const adjacentMotion = await Promise.all(
        adjacentActions.map((action) =>
            action.evaluate((element) => {
                const style = getComputedStyle(element);
                return {
                    duration: style.transitionDuration,
                    property: style.transitionProperty,
                };
            }),
        ),
    );
    expect(new Set(adjacentMotion.map(({ duration }) => duration)).size).toBe(1);
    expect(new Set(adjacentMotion.map(({ property }) => property)).size).toBe(1);
    for (const action of adjacentActions) {
        await action.hover();
        await expect(action).not.toHaveCSS("transform", "none");
    }
    await page.setViewportSize({ width: 320, height: 700 });
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
});
