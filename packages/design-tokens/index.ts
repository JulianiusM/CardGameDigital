/** Canonical presentation values for browser and future native clients. */
export const designTokens = {
    color: {
        canvas: "#17132d",
        surface: "#211a3b",
        accent: "#ffbd76",
        success: "#65d1c5",
        danger: "#ff7295",
    },
    radius: { control: 12, panel: 28 },
    motion: { fast: 160, normal: 320, ambient: 18_000 },
} as const;
