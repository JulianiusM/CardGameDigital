<script lang="ts">
    import { messages } from "./i18n";
    import type { PresentedCard } from "./presentationMapping";

    export let card: PresentedCard;
    export let showIntensity = false;

    const symbols: Record<string, string> = { QUESTION: "?", DARE: "↝", CONVERSATION: "◌" };
    $: classificationId = card.questionCategoryId ?? card.dareTypeId;
    $: classification = classificationId
        ? (messages.taxonomy[classificationId] ?? classificationId)
        : "";
</script>

<article class="game-card" data-type={card.cardType}>
    <div class="card-shine"></div>
    <span class="card-symbol" aria-hidden="true">{symbols[card.cardType] ?? "◇"}</span>
    <span class="card-type">
        {messages.cardTypes[card.cardType]}
        {#if classification}<i>·</i>{classification}{/if}
    </span>
    <p>{card.cardText}</p>
    {#if showIntensity}
        <span class="dots" aria-label={`${messages.common.intensityLabel} ${card.intensity}`}>
            {"●".repeat(card.intensity)}{"○".repeat(5 - card.intensity)}
        </span>
    {/if}
</article>
