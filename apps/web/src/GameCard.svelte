<script lang="ts">
    import { messages } from "./i18n";
    import { atmosphereFor, type PresentedCard } from "./presentationMapping";
    import UiIcon from "./UiIcon.svelte";

    export let card: PresentedCard;
    export let showIntensity = false;
    export let replacementDraw = false;
    export let compact = false;

    $: atmosphere = atmosphereFor(card);
    $: motifUrl = atmosphere
        ? `/play/motifs/${atmosphere.family.toLowerCase().replaceAll("_", "-")}.svg`
        : "/play/motifs/general.svg";
    $: classificationId = card.questionCategoryId ?? card.dareTypeId;
    $: classification = classificationId
        ? (messages.taxonomy[classificationId] ?? classificationId)
        : "";
</script>

<article
    class:replacement-draw={replacementDraw}
    class:result-compact={compact}
    class="game-card"
    data-type={card.cardType}
>
    <span class="card-symbol" aria-hidden="true" style={`--card-motif-url: url('${motifUrl}')`}
    ></span>
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
