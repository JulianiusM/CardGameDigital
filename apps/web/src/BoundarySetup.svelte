<script lang="ts">
    import { messages } from "./i18n";
    export let onSave: (boundaries: BoundarySelection) => void;

    export type BoundarySelection = {
        disabledQuestionCategoryIds: string[];
        disabledDareTypeIds: string[];
        blockedOperationalFlags: string[];
    };

    const questionCategories = Object.entries(messages.boundaries.questionCategories);
    const dareTypes = Object.entries(messages.boundaries.dareTypes);
    const operationalFlags = Object.entries(messages.boundaries.flags);

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
        {#each questionCategories as category}
            <label>
                <input
                    type="checkbox"
                    checked={disabledQuestions.includes(category[0])}
                    on:change={() => (disabledQuestions = toggle(disabledQuestions, category[0]))}
                />
                {category[1]}
            </label>
        {/each}
    </fieldset>

    <fieldset>
        <legend>{messages.boundaries.dares}</legend>
        {#each dareTypes as dareType}
            <label>
                <input
                    type="checkbox"
                    checked={disabledDares.includes(dareType[0])}
                    on:change={() => (disabledDares = toggle(disabledDares, dareType[0]))}
                />
                {dareType[1]}
            </label>
        {/each}
    </fieldset>

    <fieldset>
        <legend>{messages.boundaries.restrictions}</legend>
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
