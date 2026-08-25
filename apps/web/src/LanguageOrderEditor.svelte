<script lang="ts">
    import LanguageSelector, { type LanguageOption } from "./LanguageSelector.svelte";
    import { messages } from "./i18n";

    export let options: readonly LanguageOption[];
    export let order: readonly string[];
    export let onChange: (order: string[]) => void;
    $: available = options.filter((option) => !order.includes(option.id));

    function move(index: number, direction: -1 | 1): void {
        const target = index + direction;
        if (target < 0 || target >= order.length) return;
        const next = [...order];
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    }
</script>

<div class="language-order-editor">
    {#if order.length}
        <ol class="language-order-list">
            {#each order as id, index}
                <li>
                    <span class="language-order-number">{index + 1}</span>
                    <span
                        ><strong
                            >{options.find((option) => option.id === id)?.nativeName ?? id}</strong
                        ><small>{id}</small></span
                    >
                    <span class="language-order-actions">
                        <button
                            type="button"
                            class="icon"
                            disabled={index === 0}
                            aria-label={messages.settings.moveLanguageUp}
                            on:click={() => move(index, -1)}>↑</button
                        >
                        <button
                            type="button"
                            class="icon"
                            disabled={index === order.length - 1}
                            aria-label={messages.settings.moveLanguageDown}
                            on:click={() => move(index, 1)}>↓</button
                        >
                        <button
                            type="button"
                            class="icon remove"
                            aria-label={messages.settings.removeLanguage}
                            on:click={() => onChange(order.filter((entry) => entry !== id))}
                            >×</button
                        >
                    </span>
                </li>
            {/each}
        </ol>
    {:else}
        <p class="language-order-empty">{messages.settings.noFallbackLanguages}</p>
    {/if}
    {#if available.length}
        <LanguageSelector
            options={available}
            label={messages.settings.addFallbackLanguage}
            onSelect={(id) => onChange([...order, id])}
        />
    {/if}
</div>
