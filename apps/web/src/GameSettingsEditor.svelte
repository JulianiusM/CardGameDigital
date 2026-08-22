<script lang="ts">
    import { gameModes, messages } from "./i18n";
    import type { GameProfileSummary, RoomGameSettings } from "./multiplayer";

    export let settings: RoomGameSettings;
    export let profiles: readonly GameProfileSummary[] = [];
    export let showMode = true;
    export let showProfile = true;
    export let onChange: (settings: RoomGameSettings) => void;

    const questionCategoryIds = [
        "CAT_EVERYDAY",
        "CAT_CHILDHOOD",
        "CAT_PERSONALITY",
        "CAT_SCENARIO",
        "CAT_INTOXICATION",
        "CAT_FRIENDSHIP",
        "CAT_RELATIONSHIP",
        "CAT_BODY",
        "CAT_SEXUALITY",
        "CAT_SEX_OPENNESS",
        "CAT_SEX_TENSION",
        "CAT_SEX_EXPERIENCE",
    ];
    const dareTypeIds = [
        "DARE_SILLY",
        "DARE_THIRD_PARTY",
        "DARE_KISS",
        "DARE_KISS_SPICY",
        "DARE_TOUCH",
        "DARE_TOUCH_SPICY",
        "DARE_TOUCH_SEXY",
        "DARE_CLOTHING",
        "DARE_NUDITY",
        "DARE_SEXUAL_TENSION",
        "DARE_BORDERLINE_SEX",
        "DARE_SEX",
        "DARE_OTHER",
    ];
    const operationalFlagIds = Object.keys(messages.boundaries.flags);
    const operationalFlagLabels: Record<string, string> = messages.boundaries.flags;
    $: includesDares = ["CLASSIC_TRUTH_OR_DARE", "RANDOM_TRUTH_OR_DARE"].includes(settings.mode);

    function update(next: Partial<RoomGameSettings>): void {
        onChange({ ...settings, ...next });
    }
    function updateConfiguration(next: Partial<RoomGameSettings["configuration"]>): void {
        update({ configuration: { ...settings.configuration, ...next } });
    }
    function toggle(values: string[], id: string): string[] {
        return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
    }
    function chooseProfile(profile: GameProfileSummary): void {
        update({
            profileId: profile.id,
            adultContentConfirmed: false,
            configuration: {
                enabledQuestionCategoryIds: [...profile.enabledQuestionCategoryIds],
                enabledDareTypeIds: [...profile.enabledDareTypeIds],
                blockedOperationalFlags: [...profile.blockedOperationalFlags],
                maximumIntensity: profile.maximumIntensity as 1 | 2 | 3 | 4 | 5,
                randomQuestionRatio: profile.randomQuestionRatio,
                maximumTypeStreak: profile.maximumTypeStreak,
                letsTalkMetaInterval: profile.letsTalkMetaInterval,
            },
        });
    }
</script>

<div class="game-settings-editor">
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
            {#if profiles.find(({ id }) => id === settings.profileId)?.requiresAdultConfirmation}
                <label class="adult-confirmation">
                    <input
                        type="checkbox"
                        checked={settings.adultContentConfirmed}
                        on:change={(event) =>
                            update({ adultContentConfirmed: event.currentTarget.checked })}
                    />{messages.room.adultConfirmation}
                </label>
            {/if}
        </section>
    {/if}

    <section class="settings-section-card">
        <h3>{messages.setup.questionsHeading}</h3>
        <div class="toggle-chip-grid">
            {#each questionCategoryIds as id}
                <button
                    type="button"
                    class:selected={settings.configuration.enabledQuestionCategoryIds.includes(id)}
                    aria-pressed={settings.configuration.enabledQuestionCategoryIds.includes(id)}
                    on:click={() =>
                        updateConfiguration({
                            enabledQuestionCategoryIds: toggle(
                                settings.configuration.enabledQuestionCategoryIds,
                                id,
                            ),
                        })}>{messages.taxonomy[id] ?? id}</button
                >
            {/each}
        </div>
    </section>

    {#if includesDares}
        <section class="settings-section-card">
            <h3>{messages.setup.daresHeading}</h3>
            <div class="toggle-chip-grid">
                {#each dareTypeIds as id}
                    <button
                        type="button"
                        class:selected={settings.configuration.enabledDareTypeIds.includes(id)}
                        aria-pressed={settings.configuration.enabledDareTypeIds.includes(id)}
                        on:click={() =>
                            updateConfiguration({
                                enabledDareTypeIds: toggle(
                                    settings.configuration.enabledDareTypeIds,
                                    id,
                                ),
                            })}>{messages.taxonomy[id] ?? id}</button
                    >
                {/each}
            </div>
        </section>
    {/if}

    <section class="settings-section-card">
        <h3>{messages.setup.operationsHeading}</h3>
        <div class="toggle-chip-grid">
            {#each operationalFlagIds as id}
                <button
                    type="button"
                    class:selected={!settings.configuration.blockedOperationalFlags.includes(id)}
                    aria-pressed={!settings.configuration.blockedOperationalFlags.includes(id)}
                    on:click={() =>
                        updateConfiguration({
                            blockedOperationalFlags: toggle(
                                settings.configuration.blockedOperationalFlags,
                                id,
                            ),
                        })}>{operationalFlagLabels[id]}</button
                >
            {/each}
        </div>
    </section>

    <section class="settings-section-card behavior-settings">
        <h3>{messages.setup.behaviorHeading}</h3>
        <label class="setting-row">
            <span
                ><strong>{messages.room.maximumIntensity}</strong><small
                    >{settings.configuration.maximumIntensity} / 5</small
                ></span
            >
            <input
                type="range"
                min="1"
                max="5"
                value={settings.configuration.maximumIntensity}
                on:input={(event) =>
                    updateConfiguration({
                        maximumIntensity: Number(event.currentTarget.value) as 1 | 2 | 3 | 4 | 5,
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
</div>
