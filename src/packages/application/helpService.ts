import { MESSAGE_KEYS } from "../localization/keys";
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { ExpectedError } from "../../modules/lib/errors";
import { translate, type Locale } from "../localization/messages";

export type HelpDocument = { slug: string; title: string; html: string };

function documentationDirectory(locale: Locale): string {
    const bundled = path.join(__dirname, "..", "..", "docs", "user-guide", locale);
    return fs.existsSync(bundled)
        ? bundled
        : path.join(process.cwd(), "docs", "user-guide", locale);
}

function availableFiles(locale: Locale): string[] {
    return fs
        .readdirSync(documentationDirectory(locale))
        .filter((file) => file.endsWith(".md"))
        .sort();
}

function titleOf(locale: Locale, markdown: string): string {
    return (
        /^#\s+([^\r\n]+)/m.exec(markdown)?.[1].trim() ?? translate(locale, MESSAGE_KEYS.HELP_TITLE)
    );
}

export function listHelpDocuments(locale: Locale): Array<Pick<HelpDocument, "slug" | "title">> {
    return availableFiles(locale).map((file) => {
        const markdown = fs.readFileSync(path.join(documentationDirectory(locale), file), "utf8");
        return { slug: path.basename(file, ".md").toLowerCase(), title: titleOf(locale, markdown) };
    });
}

export function getHelpDocument(locale: Locale, slug = "readme"): HelpDocument {
    if (!/^[a-z0-9_-]+$/i.test(slug))
        throw new ExpectedError(MESSAGE_KEYS.HELP_NOT_FOUND, "error", 404);
    const file = availableFiles(locale).find(
        (candidate) => path.basename(candidate, ".md").toLowerCase() === slug.toLowerCase(),
    );
    if (!file) throw new ExpectedError(MESSAGE_KEYS.HELP_NOT_FOUND, "error", 404);
    const markdown = fs.readFileSync(path.join(documentationDirectory(locale), file), "utf8");
    return {
        slug: slug.toLowerCase(),
        title: titleOf(locale, markdown),
        html: marked.parse(markdown) as string,
    };
}
