import { MESSAGE_KEYS } from "../../../../packages/localization/keys";
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { ExpectedError } from "../modules/lib/errors";
import { resolveRuntimeAssetPath } from "../modules/runtimeAssets";
import { translate, type Locale } from "../../../../packages/localization/messages";

export type HelpDocument = { slug: string; title: string; html: string };
type HelpTopic = { slug: string; order: number };

function documentationDirectory(locale: Locale): string {
    return resolveRuntimeAssetPath(path.join("docs", "user-guide", locale));
}

function helpTopics(locale: Locale): HelpTopic[] {
    const directory = documentationDirectory(locale);
    const manifestPath = path.join(directory, "..", "topics.json");
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Help topic manifest must be an array.");
    const topics = parsed.map((candidate, index) => validateHelpTopic(candidate, index));
    const markdownFiles = fs.readdirSync(directory).filter((file) => file.endsWith(".md"));
    const markdownFileNames = new Set(markdownFiles);
    const slugs = new Set<string>();
    const orders = new Set<number>();
    for (const topic of topics) {
        if (slugs.has(topic.slug)) throw new Error(`Duplicate help topic slug: ${topic.slug}`);
        if (orders.has(topic.order)) throw new Error(`Duplicate help topic order: ${topic.order}`);
        if (!markdownFileNames.has(`${topic.slug}.md`))
            throw new Error(`Missing ${locale} help document: ${topic.slug}.md`);
        slugs.add(topic.slug);
        orders.add(topic.order);
    }
    const unregistered = markdownFiles
        .map((file) => path.basename(file, ".md").toLowerCase())
        .find((slug) => !slugs.has(slug));
    if (unregistered) throw new Error(`Unregistered ${locale} help document: ${unregistered}.md`);
    return topics.sort((left, right) => left.order - right.order);
}

function validateHelpTopic(candidate: unknown, index: number): HelpTopic {
    if (!candidate || typeof candidate !== "object")
        throw new Error(`Invalid help topic at index ${index}.`);
    const topic = candidate as Record<string, unknown>;
    if (typeof topic.slug !== "string" || !/^[a-z0-9_-]+$/.test(topic.slug))
        throw new Error(`Invalid help topic slug at index ${index}.`);
    if (typeof topic.order !== "number" || !Number.isSafeInteger(topic.order))
        throw new Error(`Invalid help topic order for ${topic.slug}.`);
    return { slug: topic.slug, order: topic.order };
}

function titleOf(locale: Locale, markdown: string): string {
    return (
        /^#\s+([^\r\n]+)/m.exec(markdown)?.[1].trim() ?? translate(locale, MESSAGE_KEYS.HELP_TITLE)
    );
}

export function listHelpDocuments(locale: Locale): Array<Pick<HelpDocument, "slug" | "title">> {
    return helpTopics(locale).map(({ slug }) => {
        const markdown = fs.readFileSync(
            path.join(documentationDirectory(locale), `${slug}.md`),
            "utf8",
        );
        return { slug, title: titleOf(locale, markdown) };
    });
}

export function getHelpDocument(locale: Locale, slug = "readme"): HelpDocument {
    if (!/^[a-z0-9_-]+$/i.test(slug))
        throw new ExpectedError(MESSAGE_KEYS.HELP_NOT_FOUND, "error", 404);
    const canonicalSlug = slug.toLowerCase();
    if (!helpTopics(locale).some((topic) => topic.slug === canonicalSlug))
        throw new ExpectedError(MESSAGE_KEYS.HELP_NOT_FOUND, "error", 404);
    const markdown = fs.readFileSync(
        path.join(documentationDirectory(locale), `${canonicalSlug}.md`),
        "utf8",
    );
    return {
        slug: canonicalSlug,
        title: titleOf(locale, markdown),
        html: marked.parse(markdown) as string,
    };
}
