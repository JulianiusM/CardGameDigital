<script lang="ts">
    import { gameModes, messages } from "./i18n";
    import { dareTypeIds, operationalFlagIds, questionCategoryIds } from "./gameSettingsOptions";
    import type { GameProfileSummary, VersionedRoomGameSettings } from "./multiplayer";

    export let settings: VersionedRoomGameSettings;
    export let profiles: readonly GameProfileSummary[] = [];

    $: mode = gameModes.find(([id]) => id === settings.mode);
    $: profile = profiles.find(({ id }) => id === settings.profileId);
    $: includesDares = ["CLASSIC_TRUTH_OR_DARE", "RANDOM_TRUTH_OR_DARE"].includes(settings.mode);
    $: enabledQuestions = questionCategoryIds.filter((id) =>
        settings.configuration.enabledQuestionCategoryIds.includes(id),
    );
    $: disabledQuestions = questionCategoryIds.filter(
        (id) => !settings.configuration.enabledQuestionCategoryIds.includes(id),
    );
    $: enabledDares = dareTypeIds.filter((id) =>
        settings.configuration.enabledDareTypeIds.includes(id),
    );
    $: disabledDares = dareTypeIds.filter(
        (id) => !settings.configuration.enabledDareTypeIds.includes(id),
    );
    $: enabledRules = operationalFlagIds.filter(
        (id) => !settings.configuration.blockedOperationalFlags.includes(id),
    );
    $: disabledRules = operationalFlagIds.filter((id) =>
        settings.configuration.blockedOperationalFlags.includes(id),
    );
</script>

<div class="game-settings-summary-full">
    <dl class="settings-facts">
        <div>
            <dt>{messages.room.gameMode}</dt>
            <dd>{mode?.[1] ?? settings.mode}</dd>
        </div>
        <div>
            <dt>{messages.room.profile}</dt>
            <dd>{profile?.name ?? settings.profileId}</dd>
        </div>
        <div>
            <dt>{messages.room.cardLanguage}</dt>
            <dd>{settings.cardLocale}</dd>
        </div>
        <div>
            <dt>{messages.room.maximumIntensity}</dt>
            <dd>{settings.configuration.maximumIntensity} / 5</dd>
        </div>
        {#if settings.mode === "RANDOM_TRUTH_OR_DARE"}
            <div>
                <dt>{messages.room.questionRatio}</dt>
                <dd>{Math.round(settings.configuration.randomQuestionRatio * 100)}%</dd>
            </div>
            <div>
                <dt>{messages.setup.typeStreak}</dt>
                <dd>{settings.configuration.maximumTypeStreak}</dd>
            </div>
        {/if}
        {#if settings.mode === "LETS_TALK"}
            <div>
                <dt>{messages.setup.talkInterval}</dt>
                <dd>{settings.configuration.letsTalkMetaInterval}</dd>
            </div>
        {/if}
    </dl>

    <section class="settings-summary-section">
        <h3>{messages.setup.questionsHeading}</h3>
        <p>
            <strong>{messages.room.enabled}</strong>
            {enabledQuestions.map((id) => messages.taxonomy[id]).join(", ") || "–"}
        </p>
        <p>
            <strong>{messages.room.disabled}</strong>
            {disabledQuestions.map((id) => messages.taxonomy[id]).join(", ") || "–"}
        </p>
    </section>
    {#if includesDares}
        <section class="settings-summary-section">
            <h3>{messages.setup.daresHeading}</h3>
            <p>
                <strong>{messages.room.enabled}</strong>
                {enabledDares.map((id) => messages.taxonomy[id]).join(", ") || "–"}
            </p>
            <p>
                <strong>{messages.room.disabled}</strong>
                {disabledDares.map((id) => messages.taxonomy[id]).join(", ") || "–"}
            </p>
        </section>
    {/if}
    <section class="settings-summary-section">
        <h3>{messages.setup.operationsHeading}</h3>
        <p>
            <strong>{messages.room.enabled}</strong>
            {enabledRules.map((id) => messages.boundaries.flags[id]).join(", ") || "–"}
        </p>
        <p>
            <strong>{messages.room.disabled}</strong>
            {disabledRules.map((id) => messages.boundaries.flags[id]).join(", ") || "–"}
        </p>
    </section>
</div>
