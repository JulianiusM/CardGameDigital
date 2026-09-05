import fs from "node:fs";
import path from "node:path";
import {
    GOLDEN_MISCHIEF_COLORS,
    GOLDEN_MISCHIEF_WEB_ATMOSPHERE_INITIALS,
    GOLDEN_MISCHIEF_WEB_COLOR_TOKENS,
    GOLDEN_MISCHIEF_WEB_RGB_TOKENS,
} from "../../packages/design-tokens";

const cssOutputFile = path.resolve("apps/web/src/generated/golden-mischief.css");
const themeOutputFile = path.resolve("apps/web/src/generated/golden-mischief-theme.ts");
const checkOnly = process.argv.includes("--check");

function property(name: keyof typeof GOLDEN_MISCHIEF_WEB_ATMOSPHERE_INITIALS): string {
    return `@property ${name} {
    syntax: "<color>";
    inherits: true;
    initial-value: ${GOLDEN_MISCHIEF_WEB_ATMOSPHERE_INITIALS[name].toLowerCase()};
}`;
}

const properties = Object.keys(GOLDEN_MISCHIEF_WEB_ATMOSPHERE_INITIALS)
    .map((name) => property(name as keyof typeof GOLDEN_MISCHIEF_WEB_ATMOSPHERE_INITIALS))
    .join("\n");
const colors = Object.entries(GOLDEN_MISCHIEF_WEB_COLOR_TOKENS)
    .map(([name, value]) => `    ${name}: ${value.toLowerCase()};`)
    .join("\n");
const colorChannels = Object.entries(GOLDEN_MISCHIEF_WEB_RGB_TOKENS)
    .map(([name, value]) => `    ${name}: ${value};`)
    .join("\n");
const generatedCss = `/* AUTO-GENERATED from packages/design-tokens. Do not edit. */
${properties}
:root {
${colors}
${colorChannels}
}
`;
const generatedTheme = `/* AUTO-GENERATED from packages/design-tokens. Do not edit. */
export const GOLDEN_MISCHIEF_THEME_COLOR = "${GOLDEN_MISCHIEF_COLORS.sunflower.toLowerCase()}";
`;

const outputs = [
    { path: cssOutputFile, content: generatedCss },
    { path: themeOutputFile, content: generatedTheme },
];
const staleOutputs = outputs.filter(
    (output) =>
        !fs.existsSync(output.path) || fs.readFileSync(output.path, "utf8") !== output.content,
);
if (staleOutputs.length === 0) {
    console.log("Web design tokens are current");
} else if (checkOnly) {
    const stalePaths = staleOutputs.map((output) => path.relative(process.cwd(), output.path));
    throw new Error(
        `Generated web design tokens are out of date (${stalePaths.join(", ")}); run npm run generate:web-tokens`,
    );
} else {
    for (const output of staleOutputs) {
        fs.mkdirSync(path.dirname(output.path), { recursive: true });
        fs.writeFileSync(output.path, output.content, "utf8");
        console.log(`Wrote ${path.relative(process.cwd(), output.path)}`);
    }
}
