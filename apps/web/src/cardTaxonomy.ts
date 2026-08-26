import { get, writable } from "svelte/store";
import { loadCardTaxonomies, type CardTaxonomyCatalog } from "./multiplayer";

export const cardTaxonomies = writable<Readonly<Record<string, CardTaxonomyCatalog>>>({});

const pending = new Map<string, Promise<void>>();

/** Loads immutable catalog copy once per Card locale and shares it across every screen. */
export function ensureCardTaxonomy(cardLocale: string): Promise<void> {
    if (!cardLocale || get(cardTaxonomies)[cardLocale]) return Promise.resolve();
    const existing = pending.get(cardLocale);
    if (existing) return existing;

    const request = loadCardTaxonomies(cardLocale)
        .then((taxonomy) => {
            cardTaxonomies.update((catalogs) => ({ ...catalogs, [taxonomy.locale]: taxonomy }));
        })
        .finally(() => pending.delete(cardLocale));
    pending.set(cardLocale, request);
    return request;
}

export function requestCardTaxonomy(cardLocale: string): void {
    void ensureCardTaxonomy(cardLocale).catch(() => undefined);
}

export function taxonomyLabel(
    taxonomy: CardTaxonomyCatalog | undefined,
    taxonomyId: string,
): string {
    const entries = [...(taxonomy?.questionCategories ?? []), ...(taxonomy?.dareTypes ?? [])];
    return entries.find(({ id }) => id === taxonomyId)?.label ?? taxonomyId;
}
