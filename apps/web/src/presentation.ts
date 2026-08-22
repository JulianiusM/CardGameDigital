export type PresentationPreferences = {
    musicEnabled: boolean;
    effectsEnabled: boolean;
    reducedMotion: boolean;
    largeText: boolean;
    musicVolume: number;
};
export type PresentationScene = "MENU" | "LOBBY" | "QUESTION" | "DARE" | "CONVERSATION" | "END";
export type PresentationEffect = "action" | "confirm" | "join" | "reveal" | "turn" | "vote" | "end";

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
        for (const effect of Object.values(this.effects)) effect.volume = 0.42;
        this.applyPreferences();
        this.loadScene(this.ambient[0], this.scene);
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

    setScene(scene: PresentationScene, atmosphere?: string | null): void {
        document.documentElement.dataset.scene = scene.toLowerCase();
        document.documentElement.dataset.atmosphere = atmosphere ?? "general";
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

    private loadScene(channel: HTMLAudioElement, scene: PresentationScene): void {
        channel.src = `/play/audio/ambient-${sceneTrack[scene]}.wav`;
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
    }
}
export const presentation = new PresentationController();
