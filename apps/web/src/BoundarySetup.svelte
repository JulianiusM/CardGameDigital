<script lang="ts">
    import { messages } from "./i18n";
    import BulkSelectionActions from "./BulkSelectionActions.svelte";
    import { cardTaxonomies, requestCardTaxonomy } from "./cardTaxonomy";
    export let onSave: (boundaries: BoundarySelection) => void;
    export let cardLocale: string;

    export type BoundarySelection = {
        disabledQuestionCategoryIds: string[];
        disabledDareTypeIds: string[];
        blockedOperationalFlags: string[];
    };

    const operationalFlags = Object.entries(messages.boundaries.flags);

    $: requestCardTaxonomy(cardLocale);
    $: taxonomy = $cardTaxonomies[cardLocale];
    $: questionCategories = taxonomy?.questionCategories ?? [];
    $: dareTypes = taxonomy?.dareTypes ?? [];

    let disabledQuestions: string[] = [];
    let disabledDares: string[] = [];
    let blockedFlags: string[] = [];

    function toggle(values: string[], id: string): string[] {
        return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
    }

    function save(): void {
        onSave({
            disabledQuestionCategoryIds: disabledQuestions,
            disabledDareTypeIds: disabledDares,
            blockedOperationalFlags: blockedFlags,
        });
    }
</script>

<section class="boundary-panel" aria-labelledby="boundary-heading">
    <h3 id="boundary-heading">{messages.boundaries.heading}</h3>
    <p>{messages.boundaries.privacy}</p>

    <fieldset>
        <legend>{messages.boundaries.questions}</legend>
        <BulkSelectionActions
            onAll={() => (disabledQuestions = [])}
            onNone={() => (disabledQuestions = questionCategories.map(({ id }) => id))}
        />
        {#each questionCategories as category (category.id)}
            <label>
                <input
                    type="checkbox"
                    checked={disabledQuestions.includes(category.id)}
                    on:change={() => (disabledQuestions = toggle(disabledQuestions, category.id))}
                />
                {category.label}
            </label>
        {/each}
    </fieldset>

    <fieldset>
        <legend>{messages.boundaries.dares}</legend>
        <BulkSelectionActions
            onAll={() => (disabledDares = [])}
            onNone={() => (disabledDares = dareTypes.map(({ id }) => id))}
        />
        {#each dareTypes as dareType (dareType.id)}
            <label>
                <input
                    type="checkbox"
                    checked={disabledDares.includes(dareType.id)}
                    on:change={() => (disabledDares = toggle(disabledDares, dareType.id))}
                />
                {dareType.label}
            </label>
        {/each}
    </fieldset>

    <fieldset>
        <legend>{messages.boundaries.restrictions}</legend>
        <BulkSelectionActions
            onAll={() => (blockedFlags = [])}
            onNone={() => (blockedFlags = operationalFlags.map(([id]) => id))}
        />
        {#each operationalFlags as flag}
            <label>
                <input
                    type="checkbox"
                    checked={blockedFlags.includes(flag[0])}
                    on:change={() => (blockedFlags = toggle(blockedFlags, flag[0]))}
                />
                {flag[1]}
            </label>
        {/each}
    </fieldset>

    <button class="secondary" on:click={save}>{messages.boundaries.save}</button>
</section>
