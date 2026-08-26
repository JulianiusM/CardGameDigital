<script lang="ts">
    import { onMount } from "svelte";
    import type { BackdropPresentation, ResolvedAtmosphere, VisualFamily } from "./presentation";

    export let presentation: BackdropPresentation;

    type TrackMetadata = { phase: number; rate: number };
    type DriftParameters = {
        phase: number;
        pixelsPerSecond: number;
        reducedMotion: boolean;
        segmentWidth: number;
    };
    type BackdropLayout = {
        fieldHeight: number;
        fieldWidth: number;
        firstTrackTop: number;
        iconSize: number;
        segmentWidth: number;
        slotCount: number;
        trackCount: number;
        trackGap: number;
    };
    type Rgb = { red: number; green: number; blue: number };
    type GradientPalette = { colorA: Rgb; colorB: Rgb; highlight: Rgb };
    type PaletteTransition = {
        durationMilliseconds: number;
        from: GradientPalette;
        startedAt: number;
        to: GradientPalette;
    };
    type ToneStrategy = ResolvedAtmosphere["motifToneStrategy"];

    const TRACK_ANGLE_DEGREES = -15;
    const TRACK_ANGLE_RADIANS = Math.abs(TRACK_ANGLE_DEGREES) * (Math.PI / 180);
    const FIELD_PADDING = 232;
    const MINIMUM_TRACK_GAP = 136;
    const GRADIENT_SPATIAL_PERIOD = 4_096;
    const GRADIENT_CROSS_PERIOD = 2_240;
    const GRADIENT_FRAME_INTERVAL = 1_000 / 20;
    const GRADIENT_SAMPLE_SPACING = 12;
    const SYMBOL_SAMPLE_INTERVAL = 100;
    const NORMAL_PALETTE_TRANSITION_MS = 1_100;
    const REDUCED_PALETTE_TRANSITION_MS = 200;
    const TAU = Math.PI * 2;
    const DIAGONAL_COMPONENT = Math.SQRT1_2;
    const ESPRESSO: Rgb = { red: 59, green: 36, blue: 22 };
    const SOFT_CREAM: Rgb = { red: 255, green: 241, blue: 199 };

    let viewportWidth = 1280;
    let viewportHeight = 720;
    let activeFamily: VisualFamily | null = null;
    let outgoingFamily: VisualFamily | null = null;
    let currentSymbols: string[][] = [];
    let outgoingSymbols: string[][] = [];
    let trackMetadata: TrackMetadata[] = [];
    let symbolTrackCount = 0;
    let symbolSlotCount = 0;
    let reducedMotion = false;
    let atmosphereLayer: HTMLDivElement;
    let gradientCanvas: HTMLCanvasElement;
    let canvasContext: CanvasRenderingContext2D | null = null;
    let rasterImage: ImageData | null = null;
    let animationFrame = 0;
    let lastFrameAt = 0;
    let lastGradientPaintAt = Number.NEGATIVE_INFINITY;
    let lastSymbolSampleAt = Number.NEGATIVE_INFINITY;
    let gradientPhase = randomUnit();
    let paletteRevision = presentation.revision;
    let paletteMotionPreference = reducedMotion;
    let renderedPalette = paletteFrom(presentation.current);
    let paletteTransition: PaletteTransition | null = null;
    let gradientTransitionMilliseconds = NORMAL_PALETTE_TRANSITION_MS;
    const adaptiveSymbols = new Set<SVGElement>();

    onMount(() => {
        const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        const synchronizeMotionPreference = () => {
            reducedMotion =
                mediaQuery.matches || document.documentElement.dataset.reducedMotion === "true";
        };
        const preferenceObserver = new MutationObserver(synchronizeMotionPreference);
        preferenceObserver.observe(document.documentElement, {
            attributeFilter: ["data-reduced-motion"],
            attributes: true,
        });
        mediaQuery.addEventListener("change", synchronizeMotionPreference);
        synchronizeMotionPreference();

        canvasContext = gradientCanvas.getContext("2d");
        animationFrame = window.requestAnimationFrame(renderFrame);

        return () => {
            window.cancelAnimationFrame(animationFrame);
            preferenceObserver.disconnect();
            mediaQuery.removeEventListener("change", synchronizeMotionPreference);
        };
    });

    function calculateLayout(
        width: number,
        height: number,
        atmosphere: ResolvedAtmosphere,
    ): BackdropLayout {
        const safeWidth = Math.max(320, width);
        const safeHeight = Math.max(480, height);
        const cosine = Math.cos(TRACK_ANGLE_RADIANS);
        const sine = Math.sin(TRACK_ANGLE_RADIANS);
        const fieldWidth = Math.ceil(safeWidth * cosine + safeHeight * sine + FIELD_PADDING * 2);
        const fieldHeight = Math.ceil(safeHeight * cosine + safeWidth * sine + FIELD_PADDING * 2);
        // Keep the track population stable while intensity changes. Changing only the gap
        // around a centered first position makes density compact/expand from the viewport
        // middle instead of appending rows at the lower edge.
        const trackCount = Math.ceil(fieldHeight / MINIMUM_TRACK_GAP) + 2;
        const slotCount = Math.ceil(fieldWidth / atmosphere.motifIconGap) + 1;
        const segmentWidth = slotCount * atmosphere.motifIconGap;
        const firstTrackTop = (fieldHeight - (trackCount - 1) * atmosphere.motifTrackGap) / 2;
        return {
            fieldHeight,
            fieldWidth,
            firstTrackTop,
            iconSize: atmosphere.motifIconSize,
            segmentWidth,
            slotCount,
            trackCount,
            trackGap: atmosphere.motifTrackGap,
        };
    }

    function randomUnit(): number {
        if (globalThis.crypto?.getRandomValues) {
            const value = new Uint32Array(1);
            globalThis.crypto.getRandomValues(value);
            return value[0] / 4_294_967_296;
        }
        return Math.random();
    }

    function randomSymbol(symbols: readonly string[]): string {
        return symbols[Math.floor(randomUnit() * symbols.length)];
    }

    function createSymbolGrid(
        symbols: readonly string[],
        trackCount: number,
        slotCount: number,
    ): string[][] {
        return Array.from({ length: trackCount }, () =>
            Array.from({ length: slotCount }, () => randomSymbol(symbols)),
        );
    }

    function resizeSymbolGrid(
        grid: string[][],
        symbols: readonly string[],
        trackCount: number,
        slotCount: number,
    ): string[][] {
        return Array.from({ length: trackCount }, (_, track) =>
            Array.from(
                { length: slotCount },
                (_, slot) => grid[track]?.[slot] ?? randomSymbol(symbols),
            ),
        );
    }

    function resizeTrackMetadata(trackCount: number): void {
        trackMetadata = Array.from(
            { length: trackCount },
            (_, track) =>
                trackMetadata[track] ?? {
                    phase: randomUnit(),
                    rate: 0.94 + randomUnit() * 0.12,
                },
        );
    }

    function synchronizeSymbols(
        next: BackdropPresentation,
        trackCount: number,
        slotCount: number,
    ): void {
        const dimensionsChanged = trackCount !== symbolTrackCount || slotCount !== symbolSlotCount;

        if (activeFamily === null) {
            activeFamily = next.current.family;
            currentSymbols = createSymbolGrid(next.current.motifSymbols, trackCount, slotCount);
        } else if (activeFamily !== next.current.family) {
            outgoingFamily = activeFamily;
            outgoingSymbols = resizeSymbolGrid(
                currentSymbols,
                next.previous?.motifSymbols ?? next.current.motifSymbols,
                trackCount,
                slotCount,
            );
            activeFamily = next.current.family;
            currentSymbols = createSymbolGrid(next.current.motifSymbols, trackCount, slotCount);
        } else if (dimensionsChanged) {
            currentSymbols = resizeSymbolGrid(
                currentSymbols,
                next.current.motifSymbols,
                trackCount,
                slotCount,
            );
            if (outgoingFamily && next.previous) {
                outgoingSymbols = resizeSymbolGrid(
                    outgoingSymbols,
                    next.previous.motifSymbols,
                    trackCount,
                    slotCount,
                );
            }
        }

        if (!next.previous || next.previous.family !== outgoingFamily) {
            outgoingFamily = null;
            outgoingSymbols = [];
        }

        if (dimensionsChanged) resizeTrackMetadata(trackCount);
        symbolTrackCount = trackCount;
        symbolSlotCount = slotCount;
    }

    function fieldStyle(value: BackdropLayout, atmosphere: ResolvedAtmosphere): string {
        return [
            `--field-height: ${value.fieldHeight}px`,
            `--field-width: ${value.fieldWidth}px`,
            `--icon-gap: ${atmosphere.motifIconGap}px`,
            `--icon-size: ${value.iconSize}px`,
            `--segment-width: ${value.segmentWidth}px`,
            `--slot-count: ${value.slotCount}`,
        ].join("; ");
    }

    function trackStyle(track: number, value: BackdropLayout): string {
        return `--track-top: ${value.firstTrackTop + track * value.trackGap}px`;
    }

    function driftParameters(
        track: number,
        atmosphere: ResolvedAtmosphere,
        value: BackdropLayout,
        prefersReducedMotion: boolean,
    ): DriftParameters {
        const metadata = trackMetadata[track] ?? { phase: 0, rate: 1 };
        return {
            phase: metadata.phase,
            pixelsPerSecond: atmosphere.motifDriftPixelsPerSecond * metadata.rate,
            reducedMotion: prefersReducedMotion,
            segmentWidth: value.segmentWidth,
        };
    }

    function trackFrames(segmentWidth: number): Keyframe[] {
        return [
            { transform: `translate3d(-${segmentWidth}px, 0, 0)` },
            { transform: "translate3d(0, 0, 0)" },
        ];
    }

    function positiveProgress(currentTime: number): number {
        return ((currentTime % 1_000) + 1_000) % 1_000;
    }

    function driftTrack(node: HTMLElement, initial: DriftParameters) {
        let parameters = initial;
        const animation = node.animate(trackFrames(initial.segmentWidth), {
            duration: 1_000,
            easing: "linear",
            iterations: Infinity,
        });
        animation.id = "track-flow";
        animation.currentTime = initial.phase * 1_000;
        animation.playbackRate = initial.pixelsPerSecond / initial.segmentWidth;
        if (initial.reducedMotion) animation.pause();

        return {
            update(next: DriftParameters) {
                if (parameters.segmentWidth !== next.segmentWidth) {
                    const currentTime = Number(animation.currentTime ?? 0);
                    const progress = positiveProgress(currentTime) / 1_000;
                    const currentOffset = -parameters.segmentWidth * (1 - progress);
                    const nextProgress = Math.max(
                        0,
                        Math.min(1, 1 + currentOffset / next.segmentWidth),
                    );
                    animation.effect?.setKeyframes(trackFrames(next.segmentWidth));
                    animation.currentTime =
                        Math.floor(currentTime / 1_000) * 1_000 + nextProgress * 1_000;
                }
                animation.updatePlaybackRate(next.pixelsPerSecond / next.segmentWidth);
                if (next.reducedMotion) animation.pause();
                else animation.play();
                parameters = next;
            },
            destroy() {
                animation.cancel();
            },
        };
    }

    function parseHex(color: string): Rgb {
        return {
            red: Number.parseInt(color.slice(1, 3), 16),
            green: Number.parseInt(color.slice(3, 5), 16),
            blue: Number.parseInt(color.slice(5, 7), 16),
        };
    }

    function paletteFrom(atmosphere: ResolvedAtmosphere): GradientPalette {
        return {
            colorA: parseHex(atmosphere.colorA),
            colorB: parseHex(atmosphere.colorB),
            highlight: parseHex(atmosphere.highlight),
        };
    }

    function mixChannel(from: number, to: number, progress: number): number {
        return from + (to - from) * progress;
    }

    function mixColor(from: Rgb, to: Rgb, progress: number): Rgb {
        return {
            red: mixChannel(from.red, to.red, progress),
            green: mixChannel(from.green, to.green, progress),
            blue: mixChannel(from.blue, to.blue, progress),
        };
    }

    function mixPalette(
        from: GradientPalette,
        to: GradientPalette,
        progress: number,
    ): GradientPalette {
        return {
            colorA: mixColor(from.colorA, to.colorA, progress),
            colorB: mixColor(from.colorB, to.colorB, progress),
            highlight: mixColor(from.highlight, to.highlight, progress),
        };
    }

    function easedProgress(progress: number): number {
        return (1 - Math.cos(Math.PI * progress)) / 2;
    }

    function nowMilliseconds(): number {
        return globalThis.performance?.now() ?? Date.now();
    }

    function resolveRenderedPalette(timestamp: number): GradientPalette {
        if (!paletteTransition) return renderedPalette;
        const elapsed = timestamp - paletteTransition.startedAt;
        const progress = Math.max(0, Math.min(1, elapsed / paletteTransition.durationMilliseconds));
        renderedPalette = mixPalette(
            paletteTransition.from,
            paletteTransition.to,
            easedProgress(progress),
        );
        if (progress === 1) {
            renderedPalette = paletteTransition.to;
            paletteTransition = null;
        }
        return renderedPalette;
    }

    function synchronizePalette(next: BackdropPresentation, prefersReducedMotion: boolean): void {
        const revisionChanged = next.revision !== paletteRevision;
        const motionPreferenceChanged = prefersReducedMotion !== paletteMotionPreference;
        if (!revisionChanged && !motionPreferenceChanged) return;

        const timestamp = nowMilliseconds();
        const currentPalette = resolveRenderedPalette(timestamp);
        const durationMilliseconds = prefersReducedMotion
            ? REDUCED_PALETTE_TRANSITION_MS
            : NORMAL_PALETTE_TRANSITION_MS;

        if (revisionChanged) {
            paletteTransition = {
                durationMilliseconds,
                from: currentPalette,
                startedAt: timestamp,
                to: paletteFrom(next.current),
            };
            paletteRevision = next.revision;
            gradientTransitionMilliseconds = durationMilliseconds;
        } else if (paletteTransition) {
            paletteTransition = {
                durationMilliseconds,
                from: currentPalette,
                startedAt: timestamp,
                to: paletteTransition.to,
            };
            gradientTransitionMilliseconds = durationMilliseconds;
        }
        paletteMotionPreference = prefersReducedMotion;
    }

    function sampleGradientColor(
        x: number,
        y: number,
        phase: number,
        palette: GradientPalette,
    ): Rgb {
        const alongMotionAxis = (x + y) * DIAGONAL_COMPONENT;
        const acrossMotionAxis = (x - y) * DIAGONAL_COMPONENT;
        const movingAngle = TAU * (alongMotionAxis / GRADIENT_SPATIAL_PERIOD - phase);
        const crossAngle = (TAU * acrossMotionAxis) / GRADIENT_CROSS_PERIOD;

        // Every time-dependent term is a function of movingAngle. The entire continuous
        // field therefore translates at one constant velocity along the diagonal; the
        // cross-axis warp makes broad organic color regions instead of parallel stripes.
        const warp = 0.48 * Math.sin(crossAngle) + 0.14 * Math.sin(crossAngle * 2 + 0.7);
        const contour = movingAngle + warp;
        const secondaryContour = 0.18 * Math.sin(movingAngle * 2 - crossAngle * 0.72);
        const scoreA = 1.08 * Math.cos(contour - 0.08) + secondaryContour;
        const scoreB = 1.08 * Math.cos(contour - 2.14) - secondaryContour * 0.55;
        const scoreHighlight = 0.86 * Math.cos(contour + 2.12) + secondaryContour * 0.3;
        const positiveScoreA = Math.max(0.04, 1.28 + scoreA);
        const positiveScoreB = Math.max(0.04, 1.28 + scoreB);
        const positiveScoreHighlight = Math.max(0.04, 1.12 + scoreHighlight);
        const weightA = positiveScoreA * positiveScoreA;
        const weightB = positiveScoreB * positiveScoreB;
        const weightHighlight = positiveScoreHighlight * positiveScoreHighlight * 0.72;
        const totalWeight = weightA + weightB + weightHighlight;

        return {
            red:
                (palette.colorA.red * weightA +
                    palette.colorB.red * weightB +
                    palette.highlight.red * weightHighlight) /
                totalWeight,
            green:
                (palette.colorA.green * weightA +
                    palette.colorB.green * weightB +
                    palette.highlight.green * weightHighlight) /
                totalWeight,
            blue:
                (palette.colorA.blue * weightA +
                    palette.colorB.blue * weightB +
                    palette.highlight.blue * weightHighlight) /
                totalWeight,
        };
    }

    function ensureGradientRaster(width: number, height: number): void {
        if (!canvasContext) return;
        const rasterWidth = Math.ceil(width / GRADIENT_SAMPLE_SPACING) + 1;
        const rasterHeight = Math.ceil(height / GRADIENT_SAMPLE_SPACING) + 1;
        if (gradientCanvas.width !== rasterWidth || gradientCanvas.height !== rasterHeight) {
            gradientCanvas.width = rasterWidth;
            gradientCanvas.height = rasterHeight;
            rasterImage = canvasContext.createImageData(rasterWidth, rasterHeight);
        }
    }

    function paintGradient(palette: GradientPalette): void {
        if (!canvasContext) return;
        const width = Math.max(1, Math.round(viewportWidth));
        const height = Math.max(1, Math.round(viewportHeight));
        ensureGradientRaster(width, height);
        if (!rasterImage) return;

        const rasterWidth = rasterImage.width;
        const rasterHeight = rasterImage.height;
        const pixels = rasterImage.data;
        let pixel = 0;
        for (let row = 0; row < rasterHeight; row += 1) {
            const y = (row / (rasterHeight - 1)) * height;
            for (let column = 0; column < rasterWidth; column += 1) {
                const x = (column / (rasterWidth - 1)) * width;
                const color = sampleGradientColor(x, y, gradientPhase, palette);
                pixels[pixel] = Math.round(color.red);
                pixels[pixel + 1] = Math.round(color.green);
                pixels[pixel + 2] = Math.round(color.blue);
                pixels[pixel + 3] = 255;
                pixel += 4;
            }
        }

        canvasContext.putImageData(rasterImage, 0, 0);
    }

    function linearChannel(channel: number): number {
        const normalized = channel / 255;
        if (normalized <= 0.04045) return normalized / 12.92;
        return ((normalized + 0.055) / 1.055) ** 2.4;
    }

    function relativeLuminance(color: Rgb): number {
        return (
            linearChannel(color.red) * 0.2126 +
            linearChannel(color.green) * 0.7152 +
            linearChannel(color.blue) * 0.0722
        );
    }

    function contrastRatio(first: Rgb, second: Rgb): number {
        const brighter = Math.max(relativeLuminance(first), relativeLuminance(second));
        const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
        return (brighter + 0.05) / (darker + 0.05);
    }

    function relativeSymbolColor(background: Rgb, strategy: ToneStrategy): Rgb {
        const backgroundLuminance = relativeLuminance(background);
        const useLightRelative = strategy === "hot-relative" && backgroundLuminance < 0.42;
        const anchor = useLightRelative ? SOFT_CREAM : ESPRESSO;
        let anchorWeight = useLightRelative
            ? 0.5 + (0.42 - backgroundLuminance) * 0.5
            : 0.45 + backgroundLuminance * 0.42;
        anchorWeight = Math.max(0.58, Math.min(0.78, anchorWeight));
        let candidate = mixColor(background, anchor, anchorWeight);
        while (contrastRatio(candidate, background) < 3 && anchorWeight < 0.9) {
            anchorWeight += 0.05;
            candidate = mixColor(background, anchor, anchorWeight);
        }
        return candidate;
    }

    function colorCss(color: Rgb): string {
        return `rgb(${Math.round(color.red)}, ${Math.round(color.green)}, ${Math.round(color.blue)})`;
    }

    function colorData(color: Rgb): string {
        return `${Math.round(color.red)},${Math.round(color.green)},${Math.round(color.blue)}`;
    }

    function updateAdaptiveSymbolColors(palette: GradientPalette): void {
        const samples: Array<{ background: Rgb; node: SVGElement; symbol: Rgb }> = [];
        for (const node of adaptiveSymbols) {
            const rect = node.getBoundingClientRect();
            if (
                rect.right <= 0 ||
                rect.bottom <= 0 ||
                rect.left >= viewportWidth ||
                rect.top >= viewportHeight
            )
                continue;
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const background = sampleGradientColor(x, y, gradientPhase, palette);
            const strategy = (node.dataset.toneStrategy ?? "dark-relative") as ToneStrategy;
            samples.push({
                background,
                node,
                symbol: relativeSymbolColor(background, strategy),
            });
        }

        for (const { background, node, symbol } of samples) {
            node.style.color = colorCss(symbol);
            node.dataset.gradientColor = colorData(background);
            node.dataset.adaptiveColor = colorData(symbol);
        }
        atmosphereLayer.dataset.adaptiveSymbolCount = String(samples.length);
    }

    function updateAdaptiveIndicatorColors(palette: GradientPalette): void {
        let visibleCount = 0;
        const indicators = document.querySelectorAll<HTMLElement>("[data-adaptive-contrast]");
        for (const node of indicators) {
            const rect = node.getBoundingClientRect();
            if (
                rect.right <= 0 ||
                rect.bottom <= 0 ||
                rect.left >= viewportWidth ||
                rect.top >= viewportHeight
            )
                continue;
            const background = sampleGradientColor(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                gradientPhase,
                palette,
            );
            const creamContrast = contrastRatio(SOFT_CREAM, background);
            const espressoContrast = contrastRatio(ESPRESSO, background);
            const useLightText = creamContrast > espressoContrast;
            const foreground = useLightText ? SOFT_CREAM : ESPRESSO;
            const muted = mixColor(background, foreground, 0.78);
            node.style.setProperty("--adaptive-foreground", colorCss(foreground));
            node.style.setProperty("--adaptive-muted", colorCss(muted));
            node.style.setProperty(
                "--adaptive-surface",
                useLightText ? "rgb(59 36 22 / 72%)" : "rgb(255 241 199 / 78%)",
            );
            node.style.setProperty(
                "--adaptive-border",
                useLightText ? "rgb(255 241 199 / 34%)" : "rgb(59 36 22 / 24%)",
            );
            node.dataset.adaptiveTone = useLightText ? "light" : "dark";
            node.dataset.gradientColor = colorData(background);
            visibleCount++;
        }
        atmosphereLayer.dataset.adaptiveIndicatorCount = String(visibleCount);
    }

    function adaptiveSymbol(node: SVGElement) {
        adaptiveSymbols.add(node);
        return {
            destroy() {
                adaptiveSymbols.delete(node);
            },
        };
    }

    function renderFrame(timestamp: number): void {
        const elapsed = lastFrameAt === 0 ? 0 : Math.min(100, timestamp - lastFrameAt);
        lastFrameAt = timestamp;
        if (!reducedMotion) {
            gradientPhase =
                (gradientPhase + elapsed / (presentation.current.gradientSeconds * 1_000)) % 1;
        }

        const wasTransitioning = paletteTransition !== null;
        const palette = resolveRenderedPalette(timestamp);
        const canvasNeedsResize =
            gradientCanvas.width !== Math.ceil(viewportWidth / GRADIENT_SAMPLE_SPACING) + 1 ||
            gradientCanvas.height !== Math.ceil(viewportHeight / GRADIENT_SAMPLE_SPACING) + 1;
        const paintDue = timestamp - lastGradientPaintAt >= GRADIENT_FRAME_INTERVAL;
        if (canvasNeedsResize || (paintDue && (!reducedMotion || wasTransitioning))) {
            paintGradient(palette);
            lastGradientPaintAt = timestamp;
        }
        if (canvasNeedsResize || timestamp - lastSymbolSampleAt >= SYMBOL_SAMPLE_INTERVAL) {
            updateAdaptiveSymbolColors(palette);
            updateAdaptiveIndicatorColors(palette);
            lastSymbolSampleAt = timestamp;
        }

        atmosphereLayer.dataset.gradientPhase = gradientPhase.toFixed(6);
        atmosphereLayer.dataset.gradientPaletteProgress = paletteTransition ? "transitioning" : "1";
        animationFrame = window.requestAnimationFrame(renderFrame);
    }

    function symbolStyle(atmosphere: ResolvedAtmosphere): string {
        return [
            `--adaptive-symbol-fallback: ${atmosphere.patternTone}`,
            `--symbol-opacity: ${atmosphere.motifOpacity}`,
        ].join("; ");
    }

    $: layout = calculateLayout(viewportWidth, viewportHeight, presentation.current);
    $: synchronizeSymbols(presentation, layout.trackCount, layout.slotCount);
    $: synchronizePalette(presentation, reducedMotion);
    $: tracks = Array.from({ length: layout.trackCount }, (_, index) => index);
    $: slots = Array.from({ length: layout.slotCount }, (_, index) => index);
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />

<div
    bind:this={atmosphereLayer}
    class="atmosphere-layer"
    data-backdrop-family={presentation.current.family.toLowerCase().replaceAll("_", "-")}
    data-backdrop-intensity={presentation.current.intensity}
    data-gradient-direction="upper-left-to-lower-right"
    data-gradient-renderer="continuous-field"
    data-gradient-spatial-period={GRADIENT_SPATIAL_PERIOD}
    data-gradient-transition-ms={gradientTransitionMilliseconds}
    data-density-origin="center"
    data-icon-gap={presentation.current.motifIconGap}
    data-icon-size={layout.iconSize}
    data-slot-count={layout.slotCount}
    data-track-count={layout.trackCount}
    data-track-gap={layout.trackGap}
>
    <div class="gradient-field">
        <canvas bind:this={gradientCanvas} aria-hidden="true" class="atmosphere-gradient"></canvas>
    </div>

    <div class="motif-field" style={fieldStyle(layout, presentation.current)}>
        {#each tracks as track}
            <div class="motif-track" style={trackStyle(track, layout)}>
                <div
                    class="track-motion"
                    use:driftTrack={driftParameters(
                        track,
                        presentation.current,
                        layout,
                        reducedMotion,
                    )}
                >
                    {#each [0, 1] as segment}
                        <div class="track-segment" data-segment={segment}>
                            {#each slots as slot}
                                <span class="motif-slot">
                                    {#if presentation.previous && outgoingFamily}
                                        {#key outgoingFamily}
                                            <svg
                                                use:adaptiveSymbol
                                                aria-hidden="true"
                                                class="motif-symbol outgoing-symbol"
                                                data-tone-strategy={presentation.previous
                                                    .motifToneStrategy}
                                                focusable="false"
                                                viewBox="0 0 64 64"
                                                style={symbolStyle(presentation.previous)}
                                            >
                                                <use
                                                    href={`/play/motifs/motif-symbols.svg#${outgoingSymbols[track]?.[slot]}`}
                                                ></use>
                                            </svg>
                                        {/key}
                                    {/if}
                                    {#key activeFamily}
                                        <svg
                                            use:adaptiveSymbol
                                            aria-hidden="true"
                                            class="motif-symbol incoming-symbol"
                                            data-tone-strategy={presentation.current
                                                .motifToneStrategy}
                                            focusable="false"
                                            viewBox="0 0 64 64"
                                            style={symbolStyle(presentation.current)}
                                        >
                                            <use
                                                href={`/play/motifs/motif-symbols.svg#${currentSymbols[track]?.[slot]}`}
                                            ></use>
                                        </svg>
                                    {/key}
                                </span>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
</div>

<style>
    .atmosphere-layer,
    .gradient-field {
        position: absolute;
        inset: 0;
    }
    .atmosphere-layer,
    .gradient-field {
        overflow: hidden;
    }
    .atmosphere-layer {
        isolation: isolate;
    }
    .gradient-field {
        z-index: 0;
        background: #ffd166;
    }
    .atmosphere-gradient {
        display: block;
        width: 100%;
        height: 100%;
        image-rendering: auto;
    }
    .motif-field {
        position: absolute;
        top: 50%;
        left: 50%;
        width: var(--field-width);
        height: var(--field-height);
        overflow: hidden;
        transform: translate(-50%, -50%) rotate(-15deg);
        transform-origin: center;
        z-index: 1;
    }
    .motif-track {
        position: absolute;
        top: var(--track-top);
        left: 0;
        width: var(--field-width);
        height: var(--icon-size);
        overflow: visible;
        transition:
            top 800ms ease,
            height 800ms ease;
    }
    .track-motion {
        display: flex;
        width: max-content;
        transform: translate3d(calc(0px - var(--segment-width)), 0, 0);
        will-change: transform;
    }
    .track-segment {
        display: grid;
        flex: 0 0 var(--segment-width);
        grid-template-columns: repeat(var(--slot-count), var(--icon-gap));
        width: var(--segment-width);
    }
    .motif-slot {
        position: relative;
        display: grid;
        width: var(--icon-gap);
        height: var(--icon-size);
        place-items: center;
        overflow: visible;
    }
    .motif-symbol {
        grid-area: 1 / 1;
        width: var(--icon-size);
        height: var(--icon-size);
        overflow: visible;
        color: var(--adaptive-symbol-fallback);
        opacity: var(--symbol-opacity);
        transform: rotate(15deg);
        transform-origin: center;
        transition:
            width 800ms ease,
            height 800ms ease,
            color 140ms linear,
            opacity 500ms ease;
    }
    .incoming-symbol {
        animation: symbol-in 800ms ease both;
    }
    .outgoing-symbol {
        animation: symbol-out 800ms ease both;
    }
    @keyframes symbol-in {
        from {
            opacity: 0;
        }
        to {
            opacity: var(--symbol-opacity);
        }
    }
    @keyframes symbol-out {
        from {
            opacity: var(--symbol-opacity);
        }
        to {
            opacity: 0;
        }
    }
    @keyframes reduced-fade-in {
        from {
            opacity: 0;
        }
    }
    @keyframes reduced-fade-out {
        to {
            opacity: 0;
        }
    }
    :global(:root[data-reduced-motion="true"]) .incoming-symbol {
        animation: reduced-fade-in 200ms ease both;
    }
    :global(:root[data-reduced-motion="true"]) .outgoing-symbol {
        animation: reduced-fade-out 200ms ease both;
    }
    @media (prefers-reduced-motion: reduce) {
        .incoming-symbol {
            animation: reduced-fade-in 200ms ease both;
        }
        .outgoing-symbol {
            animation: reduced-fade-out 200ms ease both;
        }
    }
</style>
