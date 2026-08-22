import { de } from "./de";

export const defaultLocale = "de";
export const localeDefinitions = { de: { messages: de } };
export const localeCatalogs = { de: localeDefinitions.de.messages };
export type MessageCatalog = (typeof localeCatalogs)[keyof typeof localeCatalogs];
