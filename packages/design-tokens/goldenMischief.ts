/**
 * Source-owned Golden Mischief tokens shared by browser presentation code and
 * generated native-client assets. Browser CSS keeps its semantic custom properties;
 * drift tests compare those values with this package.
 */
export const GOLDEN_MISCHIEF_COLORS = {
    warmPaper: "#FFF8E8",
    softCream: "#FFF1C7",
    espresso: "#3B2416",
    cocoa: "#76533D",
    sunflower: "#FFD166",
    goldenOrange: "#FFB238",
    tangerine: "#FF8A1F",
    apricot: "#FFA85C",
    coral: "#FF6F61",
    raspberry: "#E84769",
    berry: "#9D315B",
    resultHoney: "#D5A03B",
    resultClay: "#A96B5A",
} as const;

export type GoldenMischiefColorName = keyof typeof GOLDEN_MISCHIEF_COLORS;
export type GoldenMischiefRgb = Readonly<{ red: number; green: number; blue: number }>;

function parseHexColor(value: string): GoldenMischiefRgb {
    const red = Number.parseInt(value.slice(1, 3), 16);
    const green = Number.parseInt(value.slice(3, 5), 16);
    const blue = Number.parseInt(value.slice(5, 7), 16);
    return { red, green, blue };
}

/** Numeric channels for canvas rendering and generated alpha-capable CSS tokens. */
export const GOLDEN_MISCHIEF_RGB = Object.fromEntries(
    Object.entries(GOLDEN_MISCHIEF_COLORS).map(([name, value]) => [name, parseHexColor(value)]),
) as Readonly<Record<GoldenMischiefColorName, GoldenMischiefRgb>>;

/** Semantic browser custom properties generated into the Svelte application's CSS. */
export const GOLDEN_MISCHIEF_WEB_COLOR_TOKENS = {
    "--color-warm-paper": GOLDEN_MISCHIEF_COLORS.warmPaper,
    "--color-soft-cream": GOLDEN_MISCHIEF_COLORS.softCream,
    "--color-espresso": GOLDEN_MISCHIEF_COLORS.espresso,
    "--color-muted-cocoa": GOLDEN_MISCHIEF_COLORS.cocoa,
    "--color-sunflower": GOLDEN_MISCHIEF_COLORS.sunflower,
    "--color-golden-orange": GOLDEN_MISCHIEF_COLORS.goldenOrange,
    "--color-tangerine": GOLDEN_MISCHIEF_COLORS.tangerine,
    "--color-apricot": GOLDEN_MISCHIEF_COLORS.apricot,
    "--color-coral": GOLDEN_MISCHIEF_COLORS.coral,
    "--color-raspberry": GOLDEN_MISCHIEF_COLORS.raspberry,
    "--color-berry": GOLDEN_MISCHIEF_COLORS.berry,
    "--color-result-honey": GOLDEN_MISCHIEF_COLORS.resultHoney,
    "--color-result-clay": GOLDEN_MISCHIEF_COLORS.resultClay,
} as const;

export const GOLDEN_MISCHIEF_WEB_RGB_TOKENS = Object.fromEntries(
    Object.entries(GOLDEN_MISCHIEF_WEB_COLOR_TOKENS).map(([name, value]) => {
        const colorName = name.replace("--color-", "--rgb-");
        const { red, green, blue } = parseHexColor(value);
        return [colorName, `${red} ${green} ${blue}`];
    }),
) as Readonly<Record<`--rgb-${string}`, string>>;

export const GOLDEN_MISCHIEF_WEB_ATMOSPHERE_INITIALS = {
    "--atmosphere-a": GOLDEN_MISCHIEF_COLORS.sunflower,
    "--atmosphere-b": GOLDEN_MISCHIEF_COLORS.apricot,
    "--atmosphere-highlight": GOLDEN_MISCHIEF_COLORS.softCream,
} as const;

/** Authoritative VID Card-family scenes at the neutral level-three intensity. */
export const GOLDEN_MISCHIEF_ATMOSPHERES = {
    CURIOSITY: { start: "#FFE49A", end: "#FFB347", motif: "#B86516" },
    INNER_SELF: { start: "#FFC18A", end: "#E97D5D", motif: "#884434" },
    CONNECTION: { start: "#FFAD75", end: "#FF7485", motif: "#9C4050" },
    UNFILTERED: { start: "#FFC44D", end: "#FF7A1A", motif: "#9B470F" },
    INTIMATE_TALK: { start: "#FF9A78", end: "#E85D82", motif: "#8B3550" },
    DESIRE_STORIES: { start: "#FF775F", end: "#D84670", motif: "#792A48" },
    MISCHIEF: { start: "#FFD45F", end: "#FF8A1F", motif: "#9E4B0D" },
    SOCIAL_CHAOS: { start: "#FFB13D", end: "#F0602A", motif: "#853718" },
    AFFECTION: { start: "#FFB58E", end: "#F67C74", motif: "#91483F" },
    FLIRT: { start: "#FF906D", end: "#E94775", motif: "#812B49" },
    REVEAL: { start: "#EE8A4F", end: "#9F4A64", motif: "#613245" },
    HEAT: { start: "#E85065", end: "#942C59", motif: "#FFD0B5" },
    GENERIC_DARE: { start: "#FFC05A", end: "#FF8A1F", motif: "#91400E" },
    CONVERSATION_META: { start: "#FFF1C7", end: "#FFD166", motif: "#9B6B4E" },
} as const;

export type GoldenMischiefAtmosphereFamily = keyof typeof GOLDEN_MISCHIEF_ATMOSPHERES;
