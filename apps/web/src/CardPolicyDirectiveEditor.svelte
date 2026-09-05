<script lang="ts">
    import { messages } from "./i18n";
    import { revealTransition } from "./motion";
    import {
        AVAILABILITY_DIRECTIVES,
        BOOLEAN_DIRECTIVES,
        INTENSITY_LEVELS,
        SCALAR_DIRECTIVE_MODES,
        SOCIAL_SENSITIVITY_ORDER,
    } from "../../../packages/game-core";
    import type { CardPolicyDirectives, ScalarDirective } from "../../../packages/protocol";
    import PolicyScaleControl from "./PolicyScaleControl.svelte";
    import PolicySegmentedControl from "./PolicySegmentedControl.svelte";
    import UiIcon from "./UiIcon.svelte";

    export let directives: CardPolicyDirectives;
    export let onChange: (directives: CardPolicyDirectives) => void;
    export let disabled = false;
    export let editorKey = "policy";
    export let showSocialSensitivity = true;

    const sensitivityIds = SOCIAL_SENSITIVITY_ORDER;
    let activeEditorKey = "";
    let savedSetValues: Partial<Record<keyof CardPolicyDirectives, unknown>> = {};

    $: availabilityOptions = AVAILABILITY_DIRECTIVES.map((value) => ({
        value,
        label: messages.cardManagement.availabilityDirectives[value],
    }));
    $: booleanOptions = BOOLEAN_DIRECTIVES.map((value) => ({
        value,
        label: messages.cardManagement.booleanDirectives[value],
    }));
    $: groupHistoryOptions = BOOLEAN_DIRECTIVES.map((value) => ({
        value,
        label: messages.cardManagement.groupHistoryDirectives[value],
    }));
    $: scalarOptions = SCALAR_DIRECTIVE_MODES.map((value) => ({
        value,
        label: messages.cardManagement.scalarModes[value],
    }));
    $: intensityOptions = INTENSITY_LEVELS.map((value) => ({
        value: String(value),
        label: String(value),
    }));
    $: sensitivityOptions = sensitivityIds.map((value) => ({
        value,
        label: messages.cardManagement.sensitivityNames[value],
    }));
    $: if (activeEditorKey !== editorKey) {
        activeEditorKey = editorKey;
        savedSetValues = {};
        rememberSetValues(directives);
    }
    $: rememberSetValues(directives);

    function rememberSetValues(currentDirectives: CardPolicyDirectives): void {
        const next = { ...savedSetValues };
        for (const property of [
            "repeatCooldown",
            "intensity",
            "weight",
            "socialSensitivity",
            "playerCount",
        ] as const) {
            const directive = currentDirectives[property];
            if (directive?.mode === "SET") next[property] = directive.value;
        }
        savedSetValues = next;
    }

    function replace(next: CardPolicyDirectives): void {
        onChange(next);
    }

    function setSimple(
        property: "availability" | "alwaysEligible" | "repeatableInSession",
        value: string,
    ): void {
        const next = { ...directives } as Record<string, unknown>;
        if (value === "INHERIT") delete next[property];
        else next[property] = value;
        replace(next as CardPolicyDirectives);
    }

    function scalarMode<T>(
        property: keyof CardPolicyDirectives,
        current: ScalarDirective<T> | undefined,
        mode: "INHERIT" | "CATALOG" | "SET",
        defaultValue: T,
    ): void {
        const next = { ...directives } as Record<string, unknown>;
        if (current?.mode === "SET") {
            savedSetValues = { ...savedSetValues, [property]: current.value };
        }
        if (mode === "INHERIT") delete next[property];
        else if (mode === "CATALOG") next[property] = { mode: "CATALOG" };
        else if (current?.mode === "SET") next[property] = current;
        else {
            const savedValue = savedSetValues[property] as T | undefined;
            next[property] = { mode: "SET", value: savedValue ?? defaultValue };
        }
        replace(next as CardPolicyDirectives);
    }

    function setScalar<T>(property: keyof CardPolicyDirectives, value: T): void {
        savedSetValues = { ...savedSetValues, [property]: value };
        replace({ ...directives, [property]: { mode: "SET", value } });
    }

    function updatePlayerCount(value: Partial<{ minimum: number; maximum: number | null }>): void {
        const playerCount = directives.playerCount;
        if (playerCount?.mode !== "SET") return;
        setScalar("playerCount", { ...playerCount.value, ...value });
    }
</script>

<div class="directive-editor">
    <section class="directive-family" aria-labelledby="policy-access-title">
        <header>
            <span class="directive-family-icon" aria-hidden="true"><UiIcon name="content" /></span>
            <div>
                <h3 id="policy-access-title">{messages.cardManagement.accessAndHistory}</h3>
                <p>{messages.cardManagement.accessAndHistoryHint}</p>
            </div>
        </header>

        <div class="directive-card-grid">
            <div class="directive-card">
                <div class="directive-card-copy">
                    <strong>{messages.cardManagement.availability}</strong>
                    <small>{messages.cardManagement.availabilityHint}</small>
                </div>
                <PolicySegmentedControl
                    label={messages.cardManagement.availability}
                    options={availabilityOptions}
                    value={directives.availability ?? "INHERIT"}
                    onChange={(value) => setSimple("availability", value)}
                    {disabled}
                />
            </div>

            <div class="directive-card">
                <div class="directive-card-copy">
                    <strong>{messages.cardManagement.alwaysEligible}</strong>
                    <small>{messages.cardManagement.alwaysEligibleHint}</small>
                </div>
                <PolicySegmentedControl
                    label={messages.cardManagement.alwaysEligible}
                    options={groupHistoryOptions}
                    value={directives.alwaysEligible ?? "INHERIT"}
                    onChange={(value) => setSimple("alwaysEligible", value)}
                    {disabled}
                />
            </div>

            <div class="directive-card">
                <div class="directive-card-copy">
                    <strong>{messages.cardManagement.repeatableInSession}</strong>
                    <small>{messages.cardManagement.repeatableInSessionHint}</small>
                </div>
                <PolicySegmentedControl
                    label={messages.cardManagement.repeatableInSession}
                    options={booleanOptions}
                    value={directives.repeatableInSession ?? "INHERIT"}
                    onChange={(value) => setSimple("repeatableInSession", value)}
                    {disabled}
                />
            </div>
        </div>
    </section>

    <section class="directive-family" aria-labelledby="policy-tuning-title">
        <header>
            <span class="directive-family-icon alternate" aria-hidden="true"
                ><UiIcon name="advanced" /></span
            >
            <div>
                <h3 id="policy-tuning-title">{messages.cardManagement.cardTuning}</h3>
                <p>{messages.cardManagement.cardTuningHint}</p>
            </div>
        </header>

        <div class="directive-card-grid">
            <div class="directive-card">
                <div class="directive-card-copy">
                    <strong>{messages.cardManagement.repeatCooldown}</strong>
                    <small>{messages.cardManagement.repeatCooldownHint}</small>
                </div>
                <PolicySegmentedControl
                    label={messages.cardManagement.repeatCooldown}
                    options={scalarOptions}
                    value={directives.repeatCooldown?.mode ?? "INHERIT"}
                    onChange={(value) =>
                        scalarMode(
                            "repeatCooldown",
                            directives.repeatCooldown,
                            value as "INHERIT" | "CATALOG" | "SET",
                            0,
                        )}
                    {disabled}
                />
                {#if directives.repeatCooldown?.mode === "SET"}
                    <label class="policy-value-field" transition:revealTransition>
                        <span>{messages.cardManagement.cardsBetweenRepeats}</span>
                        <input
                            class="policy-number-input"
                            type="number"
                            min="0"
                            value={directives.repeatCooldown.value}
                            {disabled}
                            on:input={(event) =>
                                setScalar("repeatCooldown", Number(event.currentTarget.value))}
                        />
                    </label>
                {/if}
            </div>

            <div class="directive-card">
                <div class="directive-card-copy">
                    <strong>{messages.cardManagement.intensity}</strong>
                    <small>{messages.cardManagement.intensityHint}</small>
                </div>
                <PolicySegmentedControl
                    label={messages.cardManagement.intensity}
                    options={scalarOptions}
                    value={directives.intensity?.mode ?? "INHERIT"}
                    onChange={(value) =>
                        scalarMode(
                            "intensity",
                            directives.intensity,
                            value as "INHERIT" | "CATALOG" | "SET",
                            1,
                        )}
                    {disabled}
                />
                {#if directives.intensity?.mode === "SET"}
                    <div class="policy-editor-reveal" transition:revealTransition>
                        <PolicyScaleControl
                            label={messages.cardManagement.intensity}
                            options={intensityOptions}
                            value={String(directives.intensity.value)}
                            valueText={messages.cardManagement.intensityValue(
                                directives.intensity.value,
                            )}
                            onChange={(value) =>
                                setScalar("intensity", Number(value) as 1 | 2 | 3 | 4 | 5)}
                            {disabled}
                        />
                        <p class="policy-replacement-warning">
                            {messages.cardManagement.intensityReplacementWarning(
                                directives.intensity.value,
                            )}
                        </p>
                    </div>
                {/if}
            </div>

            <div class="directive-card">
                <div class="directive-card-copy">
                    <strong>{messages.cardManagement.weight}</strong>
                    <small>{messages.cardManagement.weightHint}</small>
                </div>
                <PolicySegmentedControl
                    label={messages.cardManagement.weight}
                    options={scalarOptions}
                    value={directives.weight?.mode ?? "INHERIT"}
                    onChange={(value) =>
                        scalarMode(
                            "weight",
                            directives.weight,
                            value as "INHERIT" | "CATALOG" | "SET",
                            1,
                        )}
                    {disabled}
                />
                {#if directives.weight?.mode === "SET"}
                    <label class="policy-value-field" transition:revealTransition>
                        <span>{messages.cardManagement.weightValue}</span>
                        <input
                            class="policy-number-input"
                            type="number"
                            min="0.01"
                            step="0.1"
                            value={directives.weight.value}
                            {disabled}
                            on:input={(event) =>
                                setScalar("weight", Number(event.currentTarget.value))}
                        />
                    </label>
                {/if}
            </div>

            {#if showSocialSensitivity}
                <div class="directive-card directive-card-wide">
                    <div class="directive-card-copy">
                        <strong>{messages.cardManagement.sensitivity}</strong>
                        <small>{messages.cardManagement.sensitivityHint}</small>
                    </div>
                    <PolicySegmentedControl
                        label={messages.cardManagement.sensitivity}
                        options={scalarOptions}
                        value={directives.socialSensitivity?.mode ?? "INHERIT"}
                        onChange={(value) =>
                            scalarMode(
                                "socialSensitivity",
                                directives.socialSensitivity,
                                value as "INHERIT" | "CATALOG" | "SET",
                                "EXPLICIT",
                            )}
                        {disabled}
                    />
                    {#if directives.socialSensitivity?.mode === "SET"}
                        <div class="policy-editor-reveal" transition:revealTransition>
                            <PolicyScaleControl
                                label={messages.cardManagement.sensitivity}
                                options={sensitivityOptions}
                                value={directives.socialSensitivity.value}
                                onChange={(value) => setScalar("socialSensitivity", value)}
                                {disabled}
                            />
                        </div>
                    {/if}
                </div>
            {/if}

            <div class="directive-card directive-card-wide">
                <div class="directive-card-copy">
                    <strong>{messages.cardManagement.playerCount}</strong>
                    <small>{messages.cardManagement.playerCountHint}</small>
                </div>
                <PolicySegmentedControl
                    label={messages.cardManagement.playerCount}
                    options={scalarOptions}
                    value={directives.playerCount?.mode ?? "INHERIT"}
                    onChange={(value) =>
                        scalarMode(
                            "playerCount",
                            directives.playerCount,
                            value as "INHERIT" | "CATALOG" | "SET",
                            { minimum: 2, maximum: null },
                        )}
                    {disabled}
                />
                {#if directives.playerCount?.mode === "SET"}
                    <div class="policy-range-fields" transition:revealTransition>
                        <label class="policy-value-field">
                            <span>{messages.cardManagement.minimumPlayers}</span>
                            <input
                                class="policy-number-input"
                                type="number"
                                min="2"
                                value={directives.playerCount.value.minimum}
                                {disabled}
                                on:input={(event) =>
                                    updatePlayerCount({
                                        minimum: Number(event.currentTarget.value),
                                    })}
                            />
                        </label>
                        <label class="policy-value-field">
                            <span>{messages.cardManagement.maximumPlayers}</span>
                            <input
                                class="policy-number-input"
                                type="number"
                                min={directives.playerCount.value.minimum}
                                placeholder="∞"
                                value={directives.playerCount.value.maximum ?? ""}
                                {disabled}
                                on:input={(event) =>
                                    updatePlayerCount({
                                        maximum: event.currentTarget.value
                                            ? Number(event.currentTarget.value)
                                            : null,
                                    })}
                            />
                        </label>
                    </div>
                {/if}
            </div>
        </div>
    </section>
</div>
