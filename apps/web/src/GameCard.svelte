<script lang="ts">
    import { messages } from "./i18n";
    import { motifSymbolFor, type PresentedCard } from "./presentationMapping";
    import UiIcon from "./UiIcon.svelte";
    import { cardTaxonomies, requestCardTaxonomy, taxonomyLabel } from "./cardTaxonomy";

    export let card: PresentedCard;
    export let cardLocale: string;
    export let showIntensity = false;
    export let replacementDraw = false;
    export let compact = false;

    $: motifSymbol = motifSymbolFor(card);
    $: requestCardTaxonomy(cardLocale);
    $: taxonomy = $cardTaxonomies[cardLocale];
    $: classificationId = card.questionCategoryId ?? card.dareTypeId;
    $: classification = classificationId ? taxonomyLabel(taxonomy, classificationId) : "";
</script>

<article
    class:replacement-draw={replacementDraw}
    class:result-compact={compact}
    class="game-card"
    data-type={card.cardType}
>
    <svg class="card-symbol" aria-hidden="true" focusable="false" viewBox="0 0 64 64">
        <use href={`/play/motifs/motif-symbols.svg#${motifSymbol}`}></use>
    </svg>
    <span class="card-type">
        {messages.cardTypes[card.cardType]}
        {#if classification}<i>·</i>{classification}{/if}
    </span>
    <p>{card.cardText}</p>
    {#if showIntensity}
        <span class="intensity-pair">
            <span
                class="intensity-meter card-intensity"
                role="img"
                aria-label={`${messages.common.cardIntensityLabel} ${card.cardIntensity}`}
            >
                <UiIcon name="card-intensity" />
                <span class="intensity-dots" aria-hidden="true"
                    >{"●".repeat(card.cardIntensity)}{"○".repeat(5 - card.cardIntensity)}</span
                >
            </span>
            <span
                class="intensity-meter global-intensity"
                role="img"
                aria-label={`${messages.common.globalIntensityLabel} ${card.intensity}`}
            >
                <UiIcon name="global-intensity" />
                <span class="intensity-dots" aria-hidden="true"
                    >{"●".repeat(card.intensity)}{"○".repeat(5 - card.intensity)}</span
                >
            </span>
        </span>
    {/if}
</article>
