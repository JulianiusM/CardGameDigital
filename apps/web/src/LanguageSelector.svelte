<script lang="ts">
    import { locale, messages } from "./i18n";

    export type LanguageOption = { id: string; nativeName: string };
    export let options: readonly LanguageOption[];
    export let selected: string | null = null;
    export let label: string;
    export let onSelect: (id: string) => void;
    let query = "";

    const displayNames = new Intl.DisplayNames([locale], { type: "language" });
    $: normalizedQuery = query.trim().toLocaleLowerCase(locale);
    $: matching = options
        .map((option) => ({
            ...option,
            interfaceName: displayNames.of(option.id) ?? option.id,
        }))
        .filter((option) => {
            if (!normalizedQuery) return true;
            return [option.id, option.nativeName, option.interfaceName].some((value) =>
                value.toLocaleLowerCase(locale).includes(normalizedQuery),
            );
        })
        .sort((left, right) => {
            if (left.id === selected) return -1;
            if (right.id === selected) return 1;
            return left.nativeName.localeCompare(right.nativeName, locale);
        });
</script>

<div class="language-selector">
    <label class="language-search-field">
        <span>{label}</span>
        <input type="search" bind:value={query} placeholder={messages.settings.searchLanguages} />
    </label>
    <div
        class="language-results"
        role="listbox"
        aria-label={`${label}: ${messages.settings.languageResults}`}
    >
        {#each matching as option}
            <button
                type="button"
                role="option"
                class:selected={selected === option.id}
                aria-selected={selected === option.id}
                on:click={() => onSelect(option.id)}
            >
                <span
                    ><strong>{option.nativeName}</strong><small>{option.interfaceName}</small></span
                >
                <b>{option.id}</b>
            </button>
        {:else}
            <p class="language-empty">{messages.settings.noLanguagesFound}</p>
        {/each}
    </div>
</div>
