import "./style.css";
import "./experience.css";
import {
    bootstrapAccountLanguagePreferences,
    loadLanguagePreferences,
} from "./languagePreferences";

async function start(): Promise<void> {
    await bootstrapAccountLanguagePreferences();
    const [{ mount }, { default: App }, { locale, messages }, { reloadWithoutNavigationPrompt }] =
        await Promise.all([
            import("svelte"),
            import("./App.svelte"),
            import("./i18n"),
            import("./router"),
        ]);
    document.documentElement.lang = locale;
    document.title = messages.documentTitle;
    mount(App, { target: document.getElementById("app")! });
    window.addEventListener("languagechange", () => {
        if (loadLanguagePreferences().useSystemLanguage) reloadWithoutNavigationPrompt();
    });
}

void start();
