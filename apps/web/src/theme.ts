import { GOLDEN_MISCHIEF_THEME_COLOR } from "./generated/golden-mischief-theme.ts";

export const WEB_THEME_COLOR_MARKER = "__GOLDEN_MISCHIEF_THEME_COLOR__";
export const WEB_THEME_COLOR = GOLDEN_MISCHIEF_THEME_COLOR;

export function injectWebThemeColor(html: string): string {
    if (!html.includes(WEB_THEME_COLOR_MARKER)) {
        throw new Error("Web shell is missing the Golden Mischief theme-color marker");
    }
    return html.replaceAll(WEB_THEME_COLOR_MARKER, WEB_THEME_COLOR);
}
