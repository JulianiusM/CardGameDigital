<script lang="ts">
    import { gameModes, messages } from "./i18n";
    import NumberInput from "./NumberInput.svelte";
    import type {
        CardLocaleSummary,
        GameProfileSummary,
        RoomGameSettings,
    } from "../../../packages/protocol";
    import {
        GAME_MODES,
        INTENSITY_PROGRESSION_UNITS,
        SOCIAL_SENSITIVITY_ORDER,
    } from "../../../packages/game-core";
    import { operationalFlagIds } from "./gameSettingsOptions";
    import { cardTaxonomies, requestCardTaxonomy } from "./cardTaxonomy";
    import { updateLinkedRange } from "./linkedRange";
    import BulkSelectionActions from "./BulkSelectionActions.svelte";
    import LanguageSelector from "./LanguageSelector.svelte";
    import LanguageOrderEditor from "./LanguageOrderEditor.svelte";
    import { navigate } from "./router";
    import PolicyScaleControl from "./PolicyScaleControl.svelte";
    import EligibleCardPreview from "./EligibleCardPreview.svelte";

    export let settings: RoomGameSettings;
    export let profiles: readonly GameProfileSummary[] = [];
    export let cardLocales: readonly CardLocaleSummary[] = [];
    export let showMode = true;
    export let showProfile = true;
    export let onChange: (settings: RoomGameSettings) => void;
    export let onCardLocaleSelect: ((locale: string) => void) | undefined = undefined;
    export let sessionManagementHref: string | undefined = undefined;
    export let playerCount = 2;
    export let showEligibility = true;

    type Configuration = RoomGameSettings["configuration"];
    const operationalFlagLabels: Record<string, string> = messages.boundaries.flags;
    const sensitivityIds = SOCIAL_SENSITIVITY_ORDER;
    const sensitivityOptions = sensitivityIds.map((value) => ({
        value,
        label: messages.cardManagement.sensitivityNames[value],
    }));
    $: includesDares = settings.mode === GAME_MODES.CLASSIC || settings.mode === GAME_MODES.RANDOM;
    $: localeOptions = cardLocales.length
        ? cardLocales
        : [{ id: settings.cardLocale, nativeName: settings.cardLocale, coverage: 1 }];
    $: requestCardTaxonomy(settings.cardLocale);
    $: taxonomy = $cardTaxonomies[settings.cardLocale];
    $: questionCategories = taxonomy?.questionCategories ?? [];
    $: dareTypes = taxonomy?.dareTypes ?? [];
    $: enabledQuestionCategoryIds = new Set<string>(
        settings.configuration.enabledQuestionCategoryIds,
    );
    $: enabledDareTypeIds = new Set<string>(settings.configuration.enabledDareTypeIds);
    $: blockedOperationalFlags = new Set<string>(settings.configuration.blockedOperationalFlags);

    function update(next: Partial<RoomGameSettings>): void {
        onChange({ ...settings, ...next });
    }
    function updateConfiguration(next: Partial<RoomGameSettings["configuration"]>): void {
        update({ configuration: { ...settings.configuration, ...next } });
    }
    function toggle(values: readonly string[], id: string): string[] {
        return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
    }
    function questionIds(values: readonly string[]): Configuration["enabledQuestionCategoryIds"] {
        return [...values] as Configuration["enabledQuestionCategoryIds"];
    }
    function dareIds(values: readonly string[]): Configuration["enabledDareTypeIds"] {
        return [...values] as Configuration["enabledDareTypeIds"];
    }
    function operationalFlags(values: readonly string[]): Configuration["blockedOperationalFlags"] {
        return [...values] as Configuration["blockedOperationalFlags"];
    }
    function chooseProfile(profile: GameProfileSummary): void {
        update({
            profileId: profile.id,
            adultContentConfirmed: false,
            configuration: {
                enabledQuestionCategoryIds: questionIds(profile.enabledQuestionCategoryIds),
                enabledDareTypeIds: dareIds(profile.enabledDareTypeIds),
                blockedOperationalFlags: operationalFlags(profile.blockedOperationalFlags),
                maximumSocialSensitivity: profile.maximumSocialSensitivity,
                startingIntensity: profile.startingIntensity as 1 | 2 | 3 | 4 | 5,
                maximumIntensity: profile.maximumIntensity as 1 | 2 | 3 | 4 | 5,
                intensityProgressionUnit: profile.intensityProgressionUnit,
                intensityProgressionInterval: profile.intensityProgressionInterval,
                intensityProgressionIncrement: profile.intensityProgressionIncrement,
                randomQuestionRatio: profile.randomQuestionRatio,
                maximumTypeStreak: profile.maximumTypeStreak,
                letsTalkMetaInterval: profile.letsTalkMetaInterval,
            },
        });
    }
    function chooseCardLocale(cardLocale: string): void {
        update({
            cardLocale,
            cardFallbackLocales: settings.cardFallbackLocales.filter(
                (fallback) => fallback !== cardLocale,
            ),
        });
        onCardLocaleSelect?.(cardLocale);
    }

    function toggleCardFallback(enabled: boolean): void {
        const existing = settings.cardFallbackLocales.filter(
            (fallback) => fallback !== settings.cardLocale,
        );
        const defaultFallback = localeOptions.find(({ id }) => id !== settings.cardLocale)?.id;
        update({
            cardFallbackEnabled: enabled,
            cardFallbackLocales:
                enabled && existing.length === 0 && defaultFallback ? [defaultFallback] : existing,
        });
    }
    function changeIntensity(changed: "start" | "end", value: number): void {
        const range = updateLinkedRange(
            {
                start: settings.configuration.startingIntensity,
                end: settings.configuration.maximumIntensity,
            },
            changed,
            value,
            1,
            5,
        );
        updateConfiguration({
            startingIntensity: range.start as 1 | 2 | 3 | 4 | 5,
            maximumIntensity: range.end as 1 | 2 | 3 | 4 | 5,
        });
    }
</script>

<div class="game-settings-editor">
    {#if showEligibility}<EligibleCardPreview
            {settings}
            {playerCount}
            onConfirmAdult={(adultContentConfirmed) => update({ adultContentConfirmed })}
        />{/if}
    {#if showMode}
        <section class="settings-section-card">
            <h3>{messages.setup.chooseMode}</h3>
            <div class="choice-chip-grid compact">
                {#each gameModes as mode}
                    <button
                        type="button"
                        class:selected={settings.mode === mode[0]}
                        aria-pressed={settings.mode === mode[0]}
                        on:click={() => update({ mode: mode[0] })}
                    >
                        <strong>{mode[1]}</strong><small>{mode[2]}</small>
                    </button>
                {/each}
            </div>
        </section>
    {/if}

    {#if settings.mode === "NEVER_HAVE_I_EVER"}
        <section class="settings-section-card priority-setting">
            <h3>{messages.room.answerReveal}</h3>
            <div class="choice-chip-grid compact reveal-mode-options">
                {#each messages.setup.neverRevealOptions as option}
                    <button
                        type="button"
                        class:selected={settings.neverHaveIEverRevealMode === option[0]}
                        aria-pressed={settings.neverHaveIEverRevealMode === option[0]}
                        on:click={() => update({ neverHaveIEverRevealMode: option[0] })}
                    >
                        <strong>{option[1]}</strong><small>{option[2]}</small>
                    </button>
                {/each}
            </div>
        </section>
    {/if}

    <section class="settings-section-card priority-setting">
        <h3>{messages.room.cardLanguage}</h3>
        <LanguageSelector
            options={localeOptions}
            selected={settings.cardLocale}
            label={messages.room.cardLanguage}
            onSelect={chooseCardLocale}
        />
        <label class="setting-row card-fallback-toggle">
            <span
                ><strong>{messages.settings.cardFallback}</strong><small
                    >{messages.settings.cardFallbackHint}</small
                ></span
            >
            <input
                type="checkbox"
                checked={settings.cardFallbackEnabled}
                on:change={(event) => toggleCardFallback(event.currentTarget.checked)}
            />
        </label>
        {#if settings.cardFallbackEnabled}
            <LanguageOrderEditor
                options={localeOptions.filter(({ id }) => id !== settings.cardLocale)}
                order={settings.cardFallbackLocales}
                onChange={(cardFallbackLocales) => update({ cardFallbackLocales })}
            />
        {/if}
    </section>

    {#if showProfile && profiles.length}
        <section class="settings-section-card">
            <h3>{messages.setup.chooseProfile}</h3>
            <div class="choice-chip-grid">
                {#each profiles as profile}
                    <button
                        type="button"
                        class:selected={settings.profileId === profile.id}
                        aria-pressed={settings.profileId === profile.id}
                        on:click={() => chooseProfile(profile)}
                    >
                        <strong>{profile.name}</strong><small>{profile.description}</small>
                    </button>
                {/each}
            </div>
        </section>
    {/if}

    <section class="settings-section-card priority-setting sensitivity-setting">
        <h3>{messages.cardManagement.maximumSensitivity}</h3>
        <p>{messages.cardManagement.maximumSensitivityHint}</p>
        <PolicyScaleControl
            label={messages.cardManagement.maximumSensitivity}
            options={sensitivityOptions}
            value={settings.configuration.maximumSocialSensitivity}
            onChange={(value) =>
                updateConfiguration({
                    maximumSocialSensitivity: value as Configuration["maximumSocialSensitivity"],
                })}
        />
    </section>

    {#if sessionManagementHref}
        <section class="settings-section-card">
            <h3>{messages.cardManagement.sessionScope}</h3>
            <p>{messages.cardManagement.sessionScopeHint}</p>
            <a
                class="text-action"
                href={sessionManagementHref}
                on:click|preventDefault={() => navigate(sessionManagementHref!, { force: true })}
                >{messages.cardManagement.openManagement} →</a
            >
        </section>
    {/if}

    <section class="settings-section-card behavior-settings priority-setting">
        <h3>{messages.setup.behaviorHeading}</h3>
        <label class="setting-row">
            <span
                ><strong>{messages.room.startingIntensity}</strong><small
                    >{settings.configuration.startingIntensity} / 5</small
                ></span
            >
            <input
                type="range"
                min="1"
                max="5"
                value={settings.configuration.startingIntensity}
                on:input={(event) => changeIntensity("start", Number(event.currentTarget.value))}
            />
        </label>
        <label class="setting-row">
            <span
                ><strong>{messages.room.endingIntensity}</strong><small
                    >{settings.configuration.maximumIntensity} / 5</small
                ></span
            >
            <input
                type="range"
                min="1"
                max="5"
                value={settings.configuration.maximumIntensity}
                on:input={(event) => changeIntensity("end", Number(event.currentTarget.value))}
            />
        </label>
        <div class="setting-row progression-setting">
            <span><strong>{messages.room.intensityPacing}</strong></span>
            <div class="choice-chip-grid compact progression-unit-options">
                <button
                    type="button"
                    class:selected={settings.configuration.intensityProgressionUnit ===
                        INTENSITY_PROGRESSION_UNITS.ROUNDS}
                    aria-pressed={settings.configuration.intensityProgressionUnit ===
                        INTENSITY_PROGRESSION_UNITS.ROUNDS}
                    on:click={() =>
                        updateConfiguration({
                            intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.ROUNDS,
                        })}>{messages.room.progressionRounds}</button
                >
                <button
                    type="button"
                    class:selected={settings.configuration.intensityProgressionUnit ===
                        INTENSITY_PROGRESSION_UNITS.CARDS}
                    aria-pressed={settings.configuration.intensityProgressionUnit ===
                        INTENSITY_PROGRESSION_UNITS.CARDS}
                    on:click={() =>
                        updateConfiguration({
                            intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.CARDS,
                        })}>{messages.room.progressionCards}</button
                >
            </div>
        </div>
        <div class="setting-row">
            <span id="progression-interval-label"
                ><strong>{messages.room.progressionInterval}</strong><small
                    >{settings.configuration.intensityProgressionInterval}
                    {settings.configuration.intensityProgressionUnit ===
                    INTENSITY_PROGRESSION_UNITS.ROUNDS
                        ? messages.common.rounds
                        : messages.common.cards}</small
                ></span
            >
            <NumberInput
                min={1}
                max={100}
                value={settings.configuration.intensityProgressionInterval}
                labelledBy="progression-interval-label"
                decreaseLabel={`${messages.common.decrease}: ${messages.room.progressionInterval}`}
                increaseLabel={`${messages.common.increase}: ${messages.room.progressionInterval}`}
                onChange={(value) =>
                    updateConfiguration({
                        intensityProgressionInterval: value,
                    })}
            />
        </div>
        <label class="setting-row">
            <span
                ><strong>{messages.room.progressionIncrement}</strong><small
                    >+{settings.configuration.intensityProgressionIncrement}</small
                ></span
            >
            <input
                type="range"
                min="0.5"
                max="4"
                step="0.5"
                value={settings.configuration.intensityProgressionIncrement}
                on:input={(event) =>
                    updateConfiguration({
                        intensityProgressionIncrement: Number(event.currentTarget.value),
                    })}
            />
        </label>
        {#if settings.mode === "RANDOM_TRUTH_OR_DARE"}
            <label class="setting-row">
                <span
                    ><strong>{messages.room.questionRatio}</strong><small
                        >{Math.round(settings.configuration.randomQuestionRatio * 100)}%</small
                    ></span
                >
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.configuration.randomQuestionRatio}
                    on:input={(event) =>
                        updateConfiguration({
                            randomQuestionRatio: Number(event.currentTarget.value),
                        })}
                />
            </label>
            <label class="setting-row">
                <span
                    ><strong>{messages.setup.typeStreak}</strong><small
                        >{settings.configuration.maximumTypeStreak}</small
                    ></span
                >
                <input
                    type="range"
                    min="1"
                    max="10"
                    value={settings.configuration.maximumTypeStreak}
                    on:input={(event) =>
                        updateConfiguration({
                            maximumTypeStreak: Number(event.currentTarget.value),
                        })}
                />
            </label>
        {/if}
        {#if settings.mode === "LETS_TALK"}
            <label class="setting-row">
                <span
                    ><strong>{messages.setup.talkInterval}</strong><small
                        >{settings.configuration.letsTalkMetaInterval}</small
                    ></span
                >
                <input
                    type="range"
                    min="1"
                    max="20"
                    value={settings.configuration.letsTalkMetaInterval}
                    on:input={(event) =>
                        updateConfiguration({
                            letsTalkMetaInterval: Number(event.currentTarget.value),
                        })}
                />
            </label>
        {/if}
    </section>

    <section class="settings-section-card">
        <div class="selection-section-heading">
            <h3>{messages.setup.questionsHeading}</h3>
            <BulkSelectionActions
                onAll={() =>
                    updateConfiguration({
                        enabledQuestionCategoryIds: questionIds(
                            questionCategories.map(({ id }) => id),
                        ),
                    })}
                onNone={() => updateConfiguration({ enabledQuestionCategoryIds: [] })}
            />
        </div>
        <div class="toggle-chip-grid">
            {#each questionCategories as category (category.id)}
                <button
                    type="button"
                    class:selected={enabledQuestionCategoryIds.has(category.id)}
                    aria-pressed={enabledQuestionCategoryIds.has(category.id)}
                    on:click={() =>
                        updateConfiguration({
                            enabledQuestionCategoryIds: questionIds(
                                toggle(
                                    settings.configuration.enabledQuestionCategoryIds,
                                    category.id,
                                ),
                            ),
                        })}>{category.label}</button
                >
            {/each}
        </div>
    </section>

    {#if includesDares}
        <section class="settings-section-card">
            <div class="selection-section-heading">
                <h3>{messages.setup.daresHeading}</h3>
                <BulkSelectionActions
                    onAll={() =>
                        updateConfiguration({
                            enabledDareTypeIds: dareIds(dareTypes.map(({ id }) => id)),
                        })}
                    onNone={() => updateConfiguration({ enabledDareTypeIds: [] })}
                />
            </div>
            <div class="toggle-chip-grid">
                {#each dareTypes as dareType (dareType.id)}
                    <button
                        type="button"
                        class:selected={enabledDareTypeIds.has(dareType.id)}
                        aria-pressed={enabledDareTypeIds.has(dareType.id)}
                        on:click={() =>
                            updateConfiguration({
                                enabledDareTypeIds: dareIds(
                                    toggle(settings.configuration.enabledDareTypeIds, dareType.id),
                                ),
                            })}>{dareType.label}</button
                    >
                {/each}
            </div>
        </section>
    {/if}

    <section class="settings-section-card">
        <div class="selection-section-heading">
            <h3>{messages.setup.operationsHeading}</h3>
            <BulkSelectionActions
                onAll={() => updateConfiguration({ blockedOperationalFlags: [] })}
                onNone={() =>
                    updateConfiguration({
                        blockedOperationalFlags: operationalFlags(operationalFlagIds),
                    })}
            />
        </div>
        <div class="toggle-chip-grid">
            {#each operationalFlagIds as id}
                <button
                    type="button"
                    class:selected={!blockedOperationalFlags.has(id)}
                    aria-pressed={!blockedOperationalFlags.has(id)}
                    on:click={() =>
                        updateConfiguration({
                            blockedOperationalFlags: operationalFlags(
                                toggle(settings.configuration.blockedOperationalFlags, id),
                            ),
                        })}>{operationalFlagLabels[id]}</button
                >
            {/each}
        </div>
    </section>
</div>
