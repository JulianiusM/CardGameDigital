import { de } from "./de";
import { en } from "./en";

export const defaultLocale = "de";
export const localeDefinitions = {
    de: { languageTag: "de-DE", nativeName: "Deutsch", messages: de },
    en: { languageTag: "en-GB", nativeName: "English", messages: en },
};
export const localeCatalogs = Object.fromEntries(
    Object.entries(localeDefinitions).map(([id, definition]) => [id, definition.messages]),
) as {
    [Key in keyof typeof localeDefinitions]: (typeof localeDefinitions)[Key]["messages"];
};
export type MessageCatalog = (typeof localeCatalogs)[keyof typeof localeCatalogs];
