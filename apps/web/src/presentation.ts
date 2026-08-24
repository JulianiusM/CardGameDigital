import { writable } from "svelte/store";

export type PresentationPreferences = {
    musicEnabled: boolean;
    effectsEnabled: boolean;
    reducedMotion: boolean;
    largeText: boolean;
    musicVolume: number;
};
export type PresentationScene = "MENU" | "LOBBY" | "QUESTION" | "DARE" | "CONVERSATION" | "END";
export type PresentationEffect = "action" | "confirm" | "join" | "reveal" | "turn" | "vote" | "end";
export type VisualFamily =
    | "GENERAL"
    | "LOBBY"
    | "CURIOSITY"
    | "INNER_SELF"
    | "CONNECTION"
    | "UNFILTERED"
    | "INTIMATE_TALK"
    | "DESIRE_STORIES"
    | "MISCHIEF"
    | "SOCIAL_CHAOS"
    | "AFFECTION"
    | "FLIRT"
    | "REVEAL"
    | "HEAT"
    | "GENERIC_DARE"
    | "CONVERSATION"
    | "END";
export type AtmospherePresentation = {
    family: VisualFamily;
    intensity: 1 | 2 | 3 | 4 | 5;
};
export type ResolvedAtmosphere = AtmospherePresentation & {
    colorA: string;
    colorB: string;
    highlight: string;
    patternTone: string;
    motifSymbols: readonly string[];
    motifIconGap: number;
    motifIconSize: number;
    motifDriftPixelsPerSecond: number;
    motifToneStrategy: "dark-relative" | "hot-relative";
    motifOpacity: number;
    motifTrackGap: number;
    rows: number;
    gradientSeconds: number;
};
export type BackdropPresentation = {
    current: ResolvedAtmosphere;
    previous: ResolvedAtmosphere | null;
    revision: number;
};

const STORAGE_KEY = "party-game:presentation";
const systemReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sceneTrack: Record<PresentationScene, string> = {
    MENU: "menu",
    LOBBY: "lobby",
    QUESTION: "question",
    DARE: "dare",
    CONVERSATION: "conversation",
    END: "end",
};

type FamilyStyle = {
    colorA: string;
    colorB: string;
    deepA: string;
    deepB: string;
    patternTone: string;
    lightPatternTone?: string;
    highlight?: string;
    motionScale?: number;
    symbols: readonly string[];
};

const familyStyles: Record<VisualFamily, FamilyStyle> = {
    GENERAL: {
        colorA: "#FFD166",
        colorB: "#FFA85C",
        deepA: "#E6A12E",
        deepB: "#F07830",
        patternTone: "#94501B",
        symbols: ["spark", "wave", "linked", "star", "heart"],
    },
    LOBBY: {
        colorA: "#FFE49A",
        colorB: "#FFB238",
        deepA: "#D99A29",
        deepB: "#E87522",
        patternTone: "#8A4A16",
        symbols: ["door", "people", "phone", "speech-pair", "spark"],
    },
    CURIOSITY: {
        colorA: "#FFE49A",
        colorB: "#FFB347",
        deepA: "#E6B34D",
        deepB: "#E68A1F",
        patternTone: "#B86516",
        symbols: ["question", "bulb", "thought", "cloud", "star", "dice"],
    },
    INNER_SELF: {
        colorA: "#FFC18A",
        colorB: "#E97D5D",
        deepA: "#E79A64",
        deepB: "#BC594C",
        patternTone: "#884434",
        symbols: ["mirror", "fingerprint", "eye", "silhouette", "contour", "spark"],
    },
    CONNECTION: {
        colorA: "#FFAD75",
        colorB: "#FF7485",
        deepA: "#E98A5D",
        deepB: "#D74E68",
        patternTone: "#9C4050",
        symbols: ["linked", "speech-pair", "hands", "paired-stars", "heart"],
    },
    UNFILTERED: {
        colorA: "#FFC44D",
        colorB: "#FF7A1A",
        deepA: "#E39C20",
        deepB: "#D95A12",
        patternTone: "#9B470F",
        symbols: ["wobble", "bubbles", "spiral", "warped-star", "tilted-shape"],
    },
    INTIMATE_TALK: {
        colorA: "#FF9A78",
        colorB: "#E85D82",
        deepA: "#DD7059",
        deepB: "#BD3D68",
        patternTone: "#8B3550",
        symbols: ["open-heart", "lips", "speech", "keyhole", "spark"],
    },
    DESIRE_STORIES: {
        colorA: "#FF775F",
        colorB: "#D84670",
        deepA: "#D74B45",
        deepB: "#A92F5C",
        patternTone: "#792A48",
        symbols: ["spark", "kiss", "magnet", "heart", "trail", "frame"],
    },
    MISCHIEF: {
        colorA: "#FFD45F",
        colorB: "#FF8A1F",
        deepA: "#E6AA2F",
        deepB: "#DD6513",
        patternTone: "#9E4B0D",
        symbols: ["zigzag", "burst", "star", "blob", "exclamation"],
    },
    SOCIAL_CHAOS: {
        colorA: "#FFB13D",
        colorB: "#F0602A",
        deepA: "#DD871F",
        deepB: "#C64321",
        patternTone: "#853718",
        symbols: ["arrows-out", "satellite", "speech", "rings", "people"],
    },
    AFFECTION: {
        colorA: "#FFB58E",
        colorB: "#F67C74",
        deepA: "#E68B69",
        deepB: "#D5585B",
        patternTone: "#91483F",
        symbols: ["heart", "hands", "linked", "kiss", "ripple"],
    },
    FLIRT: {
        colorA: "#FF906D",
        colorB: "#E94775",
        deepA: "#DC654F",
        deepB: "#B82F60",
        patternTone: "#812B49",
        symbols: ["lips", "spark", "magnet", "heart", "squiggle"],
    },
    REVEAL: {
        colorA: "#EE8A4F",
        colorB: "#9F4A64",
        deepA: "#C9683C",
        deepB: "#74354E",
        patternTone: "#613245",
        symbols: ["fold", "hanger", "curtains", "silhouette", "sunrise"],
    },
    HEAT: {
        colorA: "#E85065",
        colorB: "#942C59",
        deepA: "#B93855",
        deepB: "#6D2049",
        patternTone: "#6D2049",
        lightPatternTone: "#FFD0B5",
        highlight: "#FFB486",
        symbols: ["flame", "intertwined", "pulse", "crescent", "dense-spark"],
    },
    GENERIC_DARE: {
        colorA: "#FFC05A",
        colorB: "#FF8A1F",
        deepA: "#DE932A",
        deepB: "#D96314",
        patternTone: "#91400E",
        symbols: ["arrow", "burst", "exclamation", "motion", "zigzag"],
    },
    CONVERSATION: {
        colorA: "#FFE3AD",
        colorB: "#F2A56F",
        deepA: "#DDB878",
        deepB: "#CF7755",
        patternTone: "#80503A",
        motionScale: 1.35,
        symbols: ["speech", "speech-pair", "dots", "thought", "ripple"],
    },
    END: {
        colorA: "#FFD166",
        colorB: "#E84769",
        deepA: "#DAA12F",
        deepB: "#A92F5C",
        patternTone: "#793544",
        symbols: ["confetti", "star", "ribbon", "spark", "burst"],
    },
};

const MOTIF_REFERENCE_TRAVEL_PX = 2_112;
const SOFT_CREAM = "#FFF1C7";
const intensityStyles = {
    1: {
        base: 70,
        deep: 0,
        motifOpacity: 0.08,
        rows: 5,
        driftSecondsAtReferenceWidth: 55,
        iconGap: 176,
        iconSize: 54,
        trackGap: 205,
    },
    2: {
        base: 85,
        deep: 0,
        motifOpacity: 0.1,
        rows: 6,
        driftSecondsAtReferenceWidth: 48,
        iconGap: 176,
        iconSize: 57,
        trackGap: 185,
    },
    3: {
        base: 100,
        deep: 0,
        motifOpacity: 0.13,
        rows: 6,
        driftSecondsAtReferenceWidth: 40,
        iconGap: 176,
        iconSize: 60,
        trackGap: 170,
    },
    4: {
        base: 90,
        deep: 10,
        motifOpacity: 0.17,
        rows: 7,
        driftSecondsAtReferenceWidth: 33,
        iconGap: 176,
        iconSize: 62,
        trackGap: 152,
    },
    5: {
        base: 80,
        deep: 20,
        motifOpacity: 0.21,
        rows: 8,
        driftSecondsAtReferenceWidth: 29,
        iconGap: 176,
        iconSize: 64,
        trackGap: 136,
    },
} as const;

function mixHex(foreground: string, background: string, foregroundPercent: number): string {
    const channels = (value: string) =>
        [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
    const foregroundChannels = channels(foreground);
    const backgroundChannels = channels(background);
    const foregroundWeight = foregroundPercent / 100;
    const mixed = foregroundChannels.map((channel, index) =>
        Math.round(channel * foregroundWeight + backgroundChannels[index] * (1 - foregroundWeight)),
    );
    return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function tint(
    color: string,
    deepColor: string,
    style: (typeof intensityStyles)[keyof typeof intensityStyles],
): string {
    if (style.deep) return mixHex(color, deepColor, style.base);
    if (style.base < 100) return mixHex(color, SOFT_CREAM, style.base);
    return color;
}

function resolveAtmosphere(value: AtmospherePresentation): ResolvedAtmosphere {
    const family = familyStyles[value.family];
    const intensity = intensityStyles[value.intensity];
    const motionScale = family.motionScale ?? 1;
    const usesLightMotifs = Boolean(family.lightPatternTone && value.intensity >= 3);
    return {
        ...value,
        colorA: tint(family.colorA, family.deepA, intensity),
        colorB: tint(family.colorB, family.deepB, intensity),
        highlight: family.highlight ?? "#FFF1C7",
        patternTone: usesLightMotifs ? family.lightPatternTone! : family.patternTone,
        motifSymbols: family.symbols,
        motifIconGap: intensity.iconGap,
        motifIconSize: intensity.iconSize,
        motifDriftPixelsPerSecond:
            MOTIF_REFERENCE_TRAVEL_PX / intensity.driftSecondsAtReferenceWidth / motionScale,
        motifToneStrategy: usesLightMotifs ? "hot-relative" : "dark-relative",
        motifOpacity: intensity.motifOpacity,
        motifTrackGap: intensity.trackGap,
        rows: intensity.rows,
        gradientSeconds: 24 * motionScale,
    };
}

function sceneAtmosphere(scene: PresentationScene): AtmospherePresentation {
    if (scene === "LOBBY") return { family: "LOBBY", intensity: 2 };
    if (scene === "CONVERSATION") return { family: "CONVERSATION", intensity: 2 };
    if (scene === "END") return { family: "END", intensity: 3 };
    if (scene === "DARE") return { family: "GENERIC_DARE", intensity: 3 };
    if (scene === "QUESTION") return { family: "CURIOSITY", intensity: 3 };
    return { family: "GENERAL", intensity: 2 };
}

const initialAtmosphere = resolveAtmosphere(sceneAtmosphere("MENU"));
export const backdropPresentation = writable<BackdropPresentation>({
    current: initialAtmosphere,
    previous: null,
    revision: 0,
});

function loadPreferences(): PresentationPreferences {
    try {
        const stored = JSON.parse(
            localStorage.getItem(STORAGE_KEY) ?? "null",
        ) as Partial<PresentationPreferences> | null;
        return {
            musicEnabled: stored?.musicEnabled ?? true,
            effectsEnabled: stored?.effectsEnabled ?? true,
            reducedMotion: stored?.reducedMotion ?? systemReducedMotion(),
            largeText: stored?.largeText ?? false,
            musicVolume: stored?.musicVolume ?? 0.22,
        };
    } catch {
        return {
            musicEnabled: true,
            effectsEnabled: true,
            reducedMotion: systemReducedMotion(),
            largeText: false,
            musicVolume: 0.22,
        };
    }
}

class PresentationController {
    preferences = loadPreferences();
    private scene: PresentationScene = "MENU";
    private activeChannel = 0;
    private fadeTimer?: number;
    private backdropTimer?: number;
    private backdropState: BackdropPresentation = {
        current: initialAtmosphere,
        previous: null,
        revision: 0,
    };
    private audioUnlocked = false;
    private readonly ambient = [new Audio(), new Audio()];
    private readonly effects: Record<PresentationEffect, HTMLAudioElement> = {
        action: new Audio("/play/audio/action.wav"),
        confirm: new Audio("/play/audio/action.wav"),
        join: new Audio("/play/audio/action.wav"),
        reveal: new Audio("/play/audio/card-reveal.wav"),
        turn: new Audio("/play/audio/card-reveal.wav"),
        vote: new Audio("/play/audio/action.wav"),
        end: new Audio("/play/audio/card-reveal.wav"),
    };

    constructor() {
        for (const channel of this.ambient) channel.loop = true;
        for (const channel of this.ambient) channel.preload = "auto";
        for (const effect of Object.values(this.effects)) {
            effect.volume = 0.42;
            effect.preload = "auto";
        }
        this.applyPreferences();
        this.loadScene(this.ambient[0], this.scene);
        const unlock = () => this.unlockAudio();
        document.addEventListener("pointerdown", unlock, { once: true });
        document.addEventListener("keydown", unlock, { once: true });
    }

    update(next: Partial<PresentationPreferences>): PresentationPreferences {
        this.preferences = { ...this.preferences, ...next };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
        this.applyPreferences();
        if (this.preferences.musicEnabled)
            void this.ambient[this.activeChannel].play().catch(() => undefined);
        else for (const channel of this.ambient) channel.pause();
        return this.preferences;
    }

    setScene(scene: PresentationScene, atmosphere?: AtmospherePresentation | null): void {
        document.documentElement.dataset.scene = scene.toLowerCase();
        this.setAtmosphere(atmosphere ?? sceneAtmosphere(scene));
        if (scene === this.scene) return;
        this.scene = scene;
        const previous = this.ambient[this.activeChannel];
        const nextIndex = this.activeChannel === 0 ? 1 : 0;
        const next = this.ambient[nextIndex];
        this.loadScene(next, scene);
        next.volume = 0;
        if (this.preferences.musicEnabled) void next.play().catch(() => undefined);
        this.crossfade(previous, next, nextIndex);
    }

    playEffect(name: PresentationEffect): void {
        if (!this.preferences.effectsEnabled) return;
        const effect = this.effects[name];
        effect.currentTime = 0;
        void effect.play().catch(() => undefined);
    }

    unlockAudio(): void {
        if (this.audioUnlocked) return;
        this.audioUnlocked = true;
        this.applyPreferences();
        if (this.preferences.musicEnabled)
            void this.ambient[this.activeChannel].play().catch(() => undefined);
    }

    private loadScene(channel: HTMLAudioElement, scene: PresentationScene): void {
        channel.src = `/play/audio/ambient-${sceneTrack[scene]}.wav`;
    }
    private setAtmosphere(value: AtmospherePresentation): void {
        const next = resolveAtmosphere(value);
        document.documentElement.dataset.family = value.family.toLowerCase().replaceAll("_", "-");
        document.documentElement.dataset.intensity = String(value.intensity);
        if (
            this.backdropState.current.family === next.family &&
            this.backdropState.current.intensity === next.intensity
        )
            return;
        if (this.backdropTimer) window.clearTimeout(this.backdropTimer);
        const revision = this.backdropState.revision + 1;
        this.backdropState = {
            current: next,
            previous: this.backdropState.current,
            revision,
        };
        backdropPresentation.set(this.backdropState);
        this.backdropTimer = window.setTimeout(
            () => {
                if (this.backdropState.revision !== revision) return;
                this.backdropState = { ...this.backdropState, previous: null };
                backdropPresentation.set(this.backdropState);
            },
            this.preferences.reducedMotion ? 220 : 1_200,
        );
    }
    private crossfade(previous: HTMLAudioElement, next: HTMLAudioElement, nextIndex: number): void {
        if (this.fadeTimer) window.clearInterval(this.fadeTimer);
        let progress = 0;
        this.fadeTimer = window.setInterval(
            () => {
                progress = Math.min(1, progress + 0.05);
                next.volume = this.preferences.musicVolume * progress;
                previous.volume = this.preferences.musicVolume * (1 - progress);
                if (progress === 1) {
                    previous.pause();
                    this.activeChannel = nextIndex;
                    window.clearInterval(this.fadeTimer);
                }
            },
            this.preferences.reducedMotion ? 20 : 60,
        );
    }
    private applyPreferences(): void {
        document.documentElement.dataset.reducedMotion = String(this.preferences.reducedMotion);
        document.documentElement.dataset.largeText = String(this.preferences.largeText);
        this.ambient[this.activeChannel].volume = this.preferences.musicVolume;
        for (const effect of Object.values(this.effects)) effect.volume = 0.42;
    }
}
export const presentation = new PresentationController();
