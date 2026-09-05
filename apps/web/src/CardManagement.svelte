<script lang="ts">
    import { onMount } from "svelte";
    import CardPolicyDirectiveEditor from "./CardPolicyDirectiveEditor.svelte";
    import ResponsiveTabs, { type ResponsiveTab } from "./ResponsiveTabs.svelte";
    import { cardPolicyApi } from "./cardPolicyApi";
    import { locale, messages } from "./i18n";
    import { loadCardLocales, loadGroups } from "./multiplayer";
    import { CARD_TYPES, SOCIAL_SENSITIVITY_ORDER } from "../../../packages/game-core";
    import type {
        CardPolicyRulePreviewResponse,
        CardPolicyDirectives,
        CardPolicyPredicate,
        GroupSummary,
        ManagedCard,
        PortableCardPolicy,
        SessionCardPolicy,
        StoredDefault,
        StoredRule,
    } from "../../../packages/protocol";
    import { operationalFlagIds } from "./gameSettingsOptions";
    import { cardTaxonomies, ensureCardTaxonomy, taxonomyLabel } from "./cardTaxonomy";
    import { dismissNotification, showNotification } from "./notifications";
    import { animateState, panelTransition, revealTransition } from "./motion";
    import { loadSetup, saveSetup } from "./setup";
    import UiIcon from "./UiIcon.svelte";
    import { randomUuidV4 } from "./randomUuid";
    import WrappingSelect, { type WrappingSelectOption } from "./WrappingSelect.svelte";

    export let embedded = false;

    type Tab = "defaults" | "rules" | "cards";
    type PredicateListProperty =
        | "cardTypes"
        | "questionCategoryIds"
        | "dareTypeIds"
        | "dareAffinityCategoryIds"
        | "socialSensitivities"
        | "operationalFlagsAll"
        | "operationalFlagsAny"
        | "operationalFlagsNone";
    type RulePreviewCard = CardPolicyRulePreviewResponse["cards"][number];
    type CardPage = {
        cursor?: string;
        cards: ManagedCard[];
        nextCursor: string | null;
    };

    const routeQuery = new URLSearchParams(location.search);
    const sessionMode = !embedded && routeQuery.get("scope") === "session";
    const requestedReturnTo = routeQuery.get("returnTo");
    const backHref =
        sessionMode && requestedReturnTo?.startsWith("/play/") ? requestedReturnTo : "/play/";
    const propertyNames = [
        "availability",
        "alwaysEligible",
        "repeatableInSession",
        "repeatCooldown",
        "intensity",
        "weight",
        "socialSensitivity",
        "playerCount",
    ] as const;
    const sensitivityIds = SOCIAL_SENSITIVITY_ORDER;
    const cardTypeIds = Object.values(CARD_TYPES);
    const operationalFlagLabels: Record<string, string> = messages.boundaries.flags;
    const rulePageSize = 10;
    const groupPageSize = 8;
    const cardPageSize = 24;

    let tab: Tab = "defaults";
    let groups: GroupSummary[] = [];
    let groupId: string | null = null;
    let scopePickerOpen = false;
    let groupQuery = "";
    let groupPage = 0;
    let sessionPolicy: SessionCardPolicy = {
        scopeDefault: {},
        conditionalRules: [],
        exactCards: [],
    };
    let cardLocale = locale === "de" ? "de-DE" : "en-GB";
    let scopeDefault: StoredDefault = { directives: {}, revision: 0 };
    let rules: StoredRule[] = [];
    let selectedRule: StoredRule | null = null;
    let ruleQuery = "";
    let rulePage = 0;
    let previewCount: number | null = null;
    let previewCards: RulePreviewCard[] = [];
    let deleteRulePending = false;
    let cardPages: CardPage[] = [];
    let cardPageIndex = 0;
    let selectedCard: ManagedCard | null = null;
    let cardDirectives: CardPolicyDirectives = {};
    let searchText = "";
    let cardType = "";
    let questionCategoryId = "";
    let dareTypeId = "";
    let sensitivity = "";
    let operationalFlag = "";
    let yesNoAnswerPossible = "";
    let playerCount = "";
    let lifecycle = "ACTIVE";
    let cardTotal = 0;
    let filtersOpen = false;
    let bulkPending = false;
    let clearCardPending = false;
    let pendingImport: { name: string; policy: PortableCardPolicy } | null = null;
    let busy = true;
    let unavailable = false;

    $: tabs = [
        { id: "defaults", label: messages.cardManagement.defaultsTab, icon: "content" },
        { id: "rules", label: messages.cardManagement.rulesTab, icon: "advanced" },
        { id: "cards", label: messages.cardManagement.cardsTab, icon: "card-intensity" },
    ] satisfies ResponsiveTab[];
    $: selectedGroup = groups.find(({ id }) => id === groupId) ?? null;
    $: normalizedGroupQuery = groupQuery.trim().toLocaleLowerCase(locale);
    $: matchingGroups = groups.filter((group) =>
        [group.name, ...group.members].some((value) =>
            value.toLocaleLowerCase(locale).includes(normalizedGroupQuery),
        ),
    );
    $: groupPageCount = Math.max(1, Math.ceil(matchingGroups.length / groupPageSize));
    $: if (groupPage >= groupPageCount) groupPage = groupPageCount - 1;
    $: visibleGroups = matchingGroups.slice(
        groupPage * groupPageSize,
        groupPage * groupPageSize + groupPageSize,
    );
    $: normalizedRuleQuery = ruleQuery.trim().toLocaleLowerCase(locale);
    $: filteredRules = rules.filter(({ name }) =>
        name.toLocaleLowerCase(locale).includes(normalizedRuleQuery),
    );
    $: rulePageCount = Math.max(1, Math.ceil(filteredRules.length / rulePageSize));
    $: if (rulePage >= rulePageCount) rulePage = rulePageCount - 1;
    $: visibleRules = filteredRules.slice(
        rulePage * rulePageSize,
        rulePage * rulePageSize + rulePageSize,
    );
    $: currentCardPage = cardPages[cardPageIndex];
    $: cards = currentCardPage?.cards ?? [];
    $: nextCursor = currentCardPage?.nextCursor ?? null;
    $: cardRangeStart = cardTotal && cards.length ? cardPageIndex * cardPageSize + 1 : 0;
    $: cardRangeEnd = Math.min(cardPageIndex * cardPageSize + cards.length, cardTotal);
    $: activeFilterCount = [
        cardType,
        questionCategoryId,
        dareTypeId,
        sensitivity,
        operationalFlag,
        yesNoAnswerPossible,
        playerCount,
        lifecycle && lifecycle !== "ACTIVE" ? lifecycle : "",
    ].filter(Boolean).length;
    $: localDirectiveCount = Object.keys(cardDirectives).length;
    $: taxonomy = $cardTaxonomies[cardLocale];
    $: questionCategoryIds = taxonomy?.questionCategories.map(({ id }) => id) ?? [];
    $: dareTypeIds = taxonomy?.dareTypes.map(({ id }) => id) ?? [];
    $: questionCategoryOptions = [
        { value: "", label: messages.cardManagement.anyValue },
        ...questionCategoryIds.map((id) => ({ value: id, label: taxonomyLabel(taxonomy, id) })),
    ] satisfies WrappingSelectOption[];
    $: dareTypeOptions = [
        { value: "", label: messages.cardManagement.anyValue },
        ...dareTypeIds.map((id) => ({ value: id, label: taxonomyLabel(taxonomy, id) })),
    ] satisfies WrappingSelectOption[];
    onMount(async () => {
        try {
            if (sessionMode) {
                const setup = loadSetup();
                cardLocale = setup.cardLocale;
                groupId = setup.groupChoice === "SELECT" ? setup.groupId : null;
                sessionPolicy = structuredClone(
                    setup.cardPolicy ?? {
                        scopeDefault: {},
                        conditionalRules: [],
                        exactCards: [],
                    },
                );
            }
            const [loadedGroups, locales] = await Promise.all([
                sessionMode ? Promise.resolve([]) : loadGroups(),
                loadCardLocales(),
            ]);
            groups = [...loadedGroups].sort((left, right) => left.name.localeCompare(right.name));
            const supported = locales.locales.find(({ id }) => id === cardLocale);
            cardLocale = supported?.id ?? locales.defaultLocale;
            await ensureCardTaxonomy(cardLocale);
            await reloadScope();
        } catch (cause) {
            unavailable = true;
            notifyError(cause);
        } finally {
            busy = false;
        }
    });

    function notifyError(cause: unknown): void {
        showNotification(
            cause instanceof Error ? cause.message : messages.common.requestFailed,
            "error",
        );
    }

    async function perform(action: () => Promise<void>, success?: string): Promise<void> {
        if (busy) return;
        busy = true;
        dismissNotification();
        try {
            await action();
            if (success) showNotification(success, "success");
        } catch (cause) {
            notifyError(cause);
        } finally {
            busy = false;
        }
    }

    async function reloadScope(): Promise<void> {
        if (sessionMode) {
            scopeDefault = { directives: structuredClone(sessionPolicy.scopeDefault), revision: 0 };
            rules = sessionPolicy.conditionalRules.map((rule) => ({ ...rule, revision: 0 }));
        } else {
            const [defaults, loadedRules] = await Promise.all([
                cardPolicyApi.loadDefault(groupId),
                cardPolicyApi.loadRules(groupId),
            ]);
            scopeDefault = defaults.scopeDefault;
            rules = loadedRules.rules;
        }
        selectedRule = rules[0] ? structuredClone(rules[0]) : null;
        rulePage = 0;
        resetRulePreview();
        await searchCards();
    }

    function persistSessionPolicy(next: SessionCardPolicy): void {
        sessionPolicy = structuredClone(next);
        const setup = loadSetup();
        saveSetup({ ...setup, cardPolicy: structuredClone(next) });
    }

    function propertyLabel(property: (typeof propertyNames)[number]): string {
        switch (property) {
            case "availability":
                return messages.cardManagement.availability;
            case "alwaysEligible":
                return messages.cardManagement.alwaysEligible;
            case "repeatableInSession":
                return messages.cardManagement.repeatableInSession;
            case "repeatCooldown":
                return messages.cardManagement.repeatCooldown;
            case "intensity":
                return messages.cardManagement.intensity;
            case "weight":
                return messages.cardManagement.weight;
            case "socialSensitivity":
                return messages.cardManagement.sensitivity;
            case "playerCount":
                return messages.cardManagement.playerCount;
        }
    }

    function selectScope(value: string | null): void {
        scopePickerOpen = false;
        if (groupId === value) return;
        groupId = value;
        void perform(reloadScope);
    }

    async function readImport(event: Event): Promise<void> {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        try {
            pendingImport = {
                name: file.name,
                policy: JSON.parse(await file.text()) as PortableCardPolicy,
            };
        } catch (cause) {
            notifyError(cause);
        }
    }

    function confirmImport(): void {
        if (!pendingImport) return;
        const policy = pendingImport.policy;
        void perform(async () => {
            await cardPolicyApi.importScope(groupId, policy);
            pendingImport = null;
            await reloadScope();
        }, messages.cardManagement.imported);
    }

    function saveDefault(): void {
        void perform(async () => {
            if (sessionMode) {
                persistSessionPolicy({
                    ...sessionPolicy,
                    scopeDefault: structuredClone(scopeDefault.directives),
                });
                await searchCards();
                return;
            }
            const result = await cardPolicyApi.saveDefault(
                groupId,
                scopeDefault.directives,
                scopeDefault.revision,
            );
            scopeDefault = result.scopeDefault;
        }, messages.cardManagement.saved);
    }

    function resetRulePreview(): void {
        previewCount = null;
        previewCards = [];
        deleteRulePending = false;
    }

    function addRule(): void {
        void perform(async () => {
            if (sessionMode) {
                const rule: StoredRule = {
                    id: randomUuidV4(),
                    name: messages.cardManagement.ruleNamePlaceholder,
                    order: Math.max(0, ...rules.map(({ order }) => order)) + 10,
                    enabled: false,
                    predicate: {},
                    directives: { availability: "EXCLUDE" },
                    revision: 0,
                };
                rules = [...rules, rule];
                persistSessionPolicy({
                    ...sessionPolicy,
                    conditionalRules: rules.map(({ revision: _revision, ...entry }) => entry),
                });
                chooseRule(rule);
                rulePage = Math.floor((rules.length - 1) / rulePageSize);
                return;
            }
            const result = await cardPolicyApi.createRule(groupId, {
                name: messages.cardManagement.ruleNamePlaceholder,
                enabled: false,
                predicate: {},
                directives: { availability: "EXCLUDE" },
            });
            rules = [...rules, result.rule];
            chooseRule(result.rule);
            rulePage = Math.floor((rules.length - 1) / rulePageSize);
        }, messages.cardManagement.ruleDraftCreated);
    }

    function chooseRule(rule: StoredRule): void {
        selectedRule = structuredClone(rule);
        resetRulePreview();
    }

    function setRuleEnabled(): void {
        if (!selectedRule) return;
        selectedRule = { ...selectedRule, enabled: !selectedRule.enabled };
    }

    function saveRule(): void {
        if (!selectedRule || !selectedRule.name.trim()) return;
        void perform(async () => {
            if (sessionMode) {
                rules = rules.map((rule) =>
                    rule.id === selectedRule?.id ? structuredClone(selectedRule) : rule,
                );
                persistSessionPolicy({
                    ...sessionPolicy,
                    conditionalRules: rules.map(({ revision: _revision, ...entry }) => entry),
                });
                await searchCards();
                return;
            }
            const result = await cardPolicyApi.updateRule(groupId, selectedRule!);
            rules = rules.map((rule) => (rule.id === result.rule.id ? result.rule : rule));
            selectedRule = structuredClone(result.rule);
        }, messages.cardManagement.saved);
    }

    function deleteRule(): void {
        if (!selectedRule) return;
        const removed = selectedRule;
        void perform(async () => {
            if (sessionMode) {
                rules = rules.filter(({ id }) => id !== removed.id);
                persistSessionPolicy({
                    ...sessionPolicy,
                    conditionalRules: rules.map(({ revision: _revision, ...entry }) => entry),
                });
                selectedRule = rules[0] ? structuredClone(rules[0]) : null;
                resetRulePreview();
                await searchCards();
                return;
            }
            await cardPolicyApi.deleteRule(groupId, removed);
            rules = rules.filter(({ id }) => id !== removed.id);
            selectedRule = rules[0] ? structuredClone(rules[0]) : null;
            resetRulePreview();
        }, messages.cardManagement.ruleDeleted);
    }

    function updatePredicateValue(property: keyof CardPolicyPredicate, value: unknown): void {
        if (!selectedRule) return;
        const predicate = { ...selectedRule.predicate } as Record<string, unknown>;
        if (value === "" || value === undefined) delete predicate[property];
        else predicate[property] = value;
        selectedRule = { ...selectedRule, predicate: predicate as CardPolicyPredicate };
        resetRulePreview();
    }

    function togglePredicateList(property: PredicateListProperty, value: string): void {
        if (!selectedRule) return;
        const predicate = { ...selectedRule.predicate } as Record<string, unknown>;
        const current = ((predicate[property] as string[] | undefined) ?? []).filter(
            (entry) => entry !== value,
        );
        const wasSelected = (predicate[property] as string[] | undefined)?.includes(value) ?? false;
        if (!wasSelected) current.push(value);
        if (current.length) predicate[property] = current;
        else delete predicate[property];
        selectedRule = { ...selectedRule, predicate: predicate as CardPolicyPredicate };
        resetRulePreview();
    }

    function predicateIncludes(property: PredicateListProperty, value: string): boolean {
        return (
            (selectedRule?.predicate as Record<string, string[]> | undefined)?.[property] ?? []
        ).includes(value);
    }

    function previewRule(): void {
        if (!selectedRule) return;
        void perform(async () => {
            const preview = await (sessionMode
                ? cardPolicyApi.previewSession(selectedRule!.predicate, cardLocale)
                : cardPolicyApi.preview(groupId, selectedRule!.predicate, cardLocale));
            previewCount = preview.matchCount;
            previewCards = preview.cards;
        });
    }

    function moveRule(ruleId: string, offset: number): void {
        const index = rules.findIndex(({ id }) => id === ruleId);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= rules.length) return;
        const ordered = [...rules];
        [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
        const selectedRuleId = selectedRule?.id;
        void perform(async () => {
            if (sessionMode) {
                rules = ordered.map((rule, ruleIndex) => ({
                    ...rule,
                    order: (ruleIndex + 1) * 10,
                }));
                persistSessionPolicy({
                    ...sessionPolicy,
                    conditionalRules: rules.map(({ revision: _revision, ...entry }) => entry),
                });
            } else {
                rules = (
                    await cardPolicyApi.reorderRules(
                        groupId,
                        ordered.map(({ id }) => id),
                    )
                ).rules;
            }
            if (selectedRuleId) {
                const selected = rules.find(({ id }) => id === selectedRuleId);
                selectedRule = selected ? structuredClone(selected) : null;
            }
            const visibleIndex = rules
                .filter(({ name }) => name.toLocaleLowerCase(locale).includes(normalizedRuleQuery))
                .findIndex(({ id }) => id === ruleId);
            if (visibleIndex >= 0) rulePage = Math.floor(visibleIndex / rulePageSize);
        }, messages.cardManagement.orderSaved);
    }

    function searchParameters(cursor?: string): Record<string, string> {
        const input: Record<string, string> = {
            locale: cardLocale,
            limit: String(cardPageSize),
        };
        if (searchText.trim()) input.query = searchText.trim();
        if (cardType) input.cardType = cardType;
        if (questionCategoryId) input.questionCategoryId = questionCategoryId;
        if (dareTypeId) input.dareTypeId = dareTypeId;
        if (sensitivity) input.socialSensitivity = sensitivity;
        if (operationalFlag) input.operationalFlag = operationalFlag;
        if (yesNoAnswerPossible) input.yesNoAnswerPossible = yesNoAnswerPossible;
        if (playerCount) input.playerCount = playerCount;
        if (lifecycle) input.lifecycle = lifecycle;
        if (cursor) input.cursor = cursor;
        return input;
    }

    async function requestCardPage(cursor?: string) {
        const parameters = searchParameters(cursor);
        return sessionMode
            ? cardPolicyApi.searchSession(groupId, sessionPolicy, parameters)
            : cardPolicyApi.search(groupId, parameters);
    }

    async function searchCards(): Promise<void> {
        const result = await requestCardPage();
        cardPages = [{ cards: result.cards, nextCursor: result.nextCursor }];
        cardPageIndex = 0;
        cardTotal = result.total;
        selectFirstCard(undefined, result.cards);
    }

    function runCardSearch(): void {
        bulkPending = false;
        clearCardPending = false;
        void perform(searchCards);
    }

    function clearCardFilters(): void {
        cardType = "";
        questionCategoryId = "";
        dareTypeId = "";
        sensitivity = "";
        operationalFlag = "";
        yesNoAnswerPossible = "";
        playerCount = "";
        lifecycle = "ACTIVE";
        runCardSearch();
    }

    function selectFirstCard(preferredId?: string, sourceCards = cards): void {
        const preferred = preferredId
            ? sourceCards.find(({ id }) => id === preferredId)
            : undefined;
        const next = preferred ?? sourceCards[0] ?? null;
        selectedCard = next;
        cardDirectives = structuredClone(next?.localDirectives ?? {});
        clearCardPending = false;
    }

    function previousCardPage(): void {
        if (cardPageIndex === 0) return;
        cardPageIndex -= 1;
        selectFirstCard(undefined, cardPages[cardPageIndex].cards);
    }

    function nextCardPage(): void {
        if (!nextCursor) return;
        if (cardPages[cardPageIndex + 1]) {
            cardPageIndex += 1;
            selectFirstCard(undefined, cardPages[cardPageIndex].cards);
            return;
        }
        const cursor = nextCursor;
        void perform(async () => {
            const result = await requestCardPage(cursor);
            cardPages = [
                ...cardPages,
                { cursor, cards: result.cards, nextCursor: result.nextCursor },
            ];
            cardPageIndex += 1;
            selectFirstCard(undefined, result.cards);
        });
    }

    function chooseCard(card: ManagedCard): void {
        selectedCard = card;
        cardDirectives = structuredClone(card.localDirectives);
        clearCardPending = false;
        bulkPending = false;
    }

    function saveCard(): void {
        if (!selectedCard) return;
        const selectedId = selectedCard.id;
        void perform(async () => {
            if (!Object.keys(cardDirectives).length) {
                if (selectedCard!.localRevision > 0) await removeCardOverride(false);
                return;
            }
            if (sessionMode) {
                const exactCards = [
                    ...sessionPolicy.exactCards.filter(({ cardId }) => cardId !== selectedId),
                    { cardId: selectedId, directives: structuredClone(cardDirectives) },
                ];
                persistSessionPolicy({ ...sessionPolicy, exactCards });
            } else {
                await cardPolicyApi.saveCard(
                    groupId,
                    selectedId,
                    cardDirectives,
                    selectedCard!.localRevision,
                );
            }
            await searchCards();
            selectFirstCard(selectedId, cardPages[0].cards);
        }, messages.cardManagement.saved);
    }

    async function removeCardOverride(refresh = true): Promise<void> {
        if (!selectedCard || selectedCard.localRevision === 0) return;
        const selectedId = selectedCard.id;
        if (sessionMode) {
            persistSessionPolicy({
                ...sessionPolicy,
                exactCards: sessionPolicy.exactCards.filter(({ cardId }) => cardId !== selectedId),
            });
        } else {
            await cardPolicyApi.deleteCard(groupId, selectedId, selectedCard.localRevision);
        }
        clearCardPending = false;
        if (refresh) {
            await searchCards();
            selectFirstCard(selectedId, cardPages[0].cards);
        }
    }

    function clearCard(): void {
        void perform(() => removeCardOverride(), messages.cardManagement.deleted);
    }

    function applyCardToResults(): void {
        if (sessionMode || cardTotal === 0 || !Object.keys(cardDirectives).length) return;
        void perform(async () => {
            const result = await cardPolicyApi.bulkApply(
                groupId,
                searchParameters(),
                cardDirectives,
                cardTotal,
            );
            bulkPending = false;
            await searchCards();
            showNotification(messages.cardManagement.bulkApplied(result.appliedCount), "success");
        });
    }

    function displayValue(property: string, value: unknown): string {
        if (value === null) return messages.cardManagement.unbounded;
        if (property === "availability") {
            return messages.cardManagement.availabilityDirectives[String(value)] ?? String(value);
        }
        if (typeof value === "boolean") return value ? messages.common.yes : messages.common.no;
        if (typeof value === "number") return new Intl.NumberFormat(locale).format(value);
        if (typeof value === "object") {
            const range = value as { minimum?: number; maximum?: number | null };
            if (range.minimum !== undefined) {
                const maximum = range.maximum ?? "∞";
                return `${range.minimum}–${maximum}`;
            }
            return messages.cardManagement.complexValue;
        }
        const key = String(value);
        return messages.cardManagement.sensitivityNames[key] ?? key;
    }

    function displayDirective(property: string): string {
        const value = (cardDirectives as Record<string, unknown>)[property];
        if (!value) return messages.cardManagement.booleanDirectives.INHERIT;
        if (typeof value === "string") {
            return (
                messages.cardManagement.availabilityDirectives[value] ??
                messages.cardManagement.booleanDirectives[value] ??
                value
            );
        }
        const directive = value as { mode: string; value?: unknown };
        if (directive.mode !== "SET") return messages.cardManagement.scalarModes[directive.mode];
        return `${messages.cardManagement.scalarModes.SET}: ${displayValue(property, directive.value)}`;
    }

    function displayProvenance(source: string): string {
        if (source === "Catalog") return messages.cardManagement.catalogSource;
        const ruleMatch = /^(DataSpace|Group|Session) rule “(.+)”$/.exec(source);
        if (ruleMatch) {
            return messages.cardManagement.ruleSource(scopeName(ruleMatch[1]), ruleMatch[2]);
        }
        const defaultMatch = /^(DataSpace|Group|Session) Scope Default$/.exec(source);
        if (defaultMatch) return messages.cardManagement.defaultSource(scopeName(defaultMatch[1]));
        const exactMatch = /^(DataSpace|Group|Session) Exact Card$/.exec(source);
        if (exactMatch) return messages.cardManagement.exactSource(scopeName(exactMatch[1]));
        return messages.cardManagement.unknownSource;
    }

    function scopeName(value: string): string {
        if (value === "DataSpace") return messages.cardManagement.dataSpace;
        if (value === "Group") return messages.cardManagement.group;
        return messages.cardManagement.sessionScope;
    }

    function cardTypeName(value: string): string {
        return messages.cardManagement.cardTypeNames[value] ?? messages.cardManagement.unknownValue;
    }

    function lifecycleName(value: string): string {
        return value === "ACTIVE"
            ? messages.cardManagement.active
            : messages.cardManagement.retired;
    }

    function conditionCount(predicate: CardPolicyPredicate): number {
        return Object.values(predicate).filter((value) =>
            Array.isArray(value) ? value.length > 0 : value !== undefined,
        ).length;
    }
</script>

<svelte:element
    this={embedded ? "div" : "main"}
    class:embedded
    class:standalone={!embedded}
    class="card-management-shell"
    aria-busy={busy}
    in:panelTransition
>
    {#if !embedded}
        <a class="secondary button-link card-management-back" href={backHref}>
            <span aria-hidden="true">‹</span>
            {sessionMode ? messages.cardManagement.backToSetup : messages.common.backToMain}
        </a>
    {/if}

    <div class={embedded ? "card-management-content" : "card-panel card-management-frame"}>
        {#if embedded}
            <section class="account-explainer card-management-explainer">
                <span class="account-section-icon" aria-hidden="true"
                    ><UiIcon name="content" /></span
                >
                <div>
                    <span class="eyebrow">{messages.cardManagement.eyebrow}</span>
                    <h2>{messages.cardManagement.explainerTitle}</h2>
                    <p>{messages.cardManagement.intro}</p>
                </div>
            </section>
        {:else}
            <header class="card-management-header">
                <span class="card-management-icon" aria-hidden="true"
                    ><UiIcon name="content" /></span
                >
                <div>
                    <span class="eyebrow">{messages.cardManagement.eyebrow}</span>
                    <h1>{messages.cardManagement.title}</h1>
                    <p>{messages.cardManagement.intro}</p>
                </div>
            </header>
        {/if}

        {#if unavailable}
            <section class="card-panel card-management-unavailable" role="alert" in:panelTransition>
                <span aria-hidden="true"><UiIcon name="privacy" /></span>
                <div>
                    <h2>{messages.cardManagement.unavailableTitle}</h2>
                    <p>{messages.cardManagement.unavailable}</p>
                </div>
            </section>
        {:else if busy && !rules.length && !cardPages.length}
            <section class="card-panel policy-loading" aria-live="polite" in:panelTransition>
                <span class="policy-loading-symbol" aria-hidden="true"
                    ><UiIcon name="content" /></span
                >
                <div>
                    <strong>{messages.cardManagement.loading}</strong>
                    <small>{messages.cardManagement.loadingHint}</small>
                </div>
            </section>
        {:else}
            <section
                class="card-panel policy-scope-card"
                aria-labelledby="policy-scope-heading"
                use:animateState={sessionMode ? "session" : (groupId ?? "dataspace")}
                in:panelTransition
            >
                <div class="policy-scope-summary">
                    <span class="policy-scope-symbol" aria-hidden="true"
                        ><UiIcon
                            name={sessionMode ? "session" : selectedGroup ? "group" : "service"}
                        /></span
                    >
                    <div>
                        <span class="eyebrow" id="policy-scope-heading">
                            {sessionMode
                                ? messages.cardManagement.sessionPolicyLevel
                                : selectedGroup
                                  ? messages.cardManagement.groupPolicyLevel
                                  : messages.cardManagement.dataSpacePolicyLevel}
                        </span>
                        <strong>
                            {#if sessionMode}
                                {messages.cardManagement.sessionScope}
                            {:else if selectedGroup}
                                {selectedGroup.name}
                            {:else}
                                {messages.cardManagement.currentDataSpace}
                            {/if}
                        </strong>
                        <small>
                            {sessionMode
                                ? messages.cardManagement.sessionScopeHint
                                : selectedGroup
                                  ? messages.cardManagement.groupScopeHint
                                  : messages.cardManagement.dataSpaceScopeHint}
                        </small>
                    </div>
                </div>

                {#if !sessionMode}
                    <div class="policy-scope-actions">
                        <button
                            class="secondary"
                            type="button"
                            aria-expanded={scopePickerOpen}
                            on:click={() => (scopePickerOpen = !scopePickerOpen)}
                        >
                            <UiIcon name="group" />
                            {messages.cardManagement.changeScope}
                        </button>
                        <a
                            class="secondary policy-action-link"
                            href={cardPolicyApi.exportHref(groupId)}
                            download="card-policy.json"
                        >
                            <span aria-hidden="true">↓</span>
                            {messages.cardManagement.exportPolicy}
                        </a>
                        <label class="secondary policy-import-label">
                            <span aria-hidden="true">↑</span>
                            {messages.cardManagement.importPolicy}
                            <input
                                class="visually-hidden-input"
                                type="file"
                                accept="application/json,.json"
                                on:change={readImport}
                            />
                        </label>
                    </div>
                {/if}

                {#if scopePickerOpen && !sessionMode}
                    <div class="policy-scope-picker" transition:revealTransition>
                        <header class="policy-scope-picker-heading">
                            <strong>{messages.cardManagement.scopePickerTitle}</strong>
                            <small>{messages.cardManagement.scopePickerHint}</small>
                        </header>

                        <section class="policy-scope-tier" aria-labelledby="policy-dataspace-tier">
                            <header>
                                <span class="eyebrow" id="policy-dataspace-tier"
                                    >{messages.cardManagement.dataSpaceTier}</span
                                >
                                <small>{messages.cardManagement.dataSpaceTierHint}</small>
                            </header>
                            <button
                                type="button"
                                class:selected={!groupId}
                                class="policy-scope-option"
                                on:click={() => selectScope(null)}
                            >
                                <span aria-hidden="true"><UiIcon name="service" /></span>
                                <span>
                                    <strong>{messages.cardManagement.currentDataSpace}</strong>
                                    <small>{messages.cardManagement.dataSpaceOptionHint}</small>
                                </span>
                                {#if !groupId}<b>{messages.account.selected}</b>{/if}
                            </button>
                        </section>

                        <section class="policy-scope-tier" aria-labelledby="policy-group-tier">
                            <header>
                                <span class="eyebrow" id="policy-group-tier"
                                    >{messages.cardManagement.groupTier}</span
                                >
                                <small>{messages.cardManagement.groupTierHint}</small>
                            </header>
                            {#if groups.length}
                                <label class="policy-search-field">
                                    <span>{messages.cardManagement.searchGroups}</span>
                                    <span class="policy-search-control">
                                        <UiIcon name="group" />
                                        <input
                                            type="search"
                                            bind:value={groupQuery}
                                            placeholder={messages.cardManagement
                                                .searchGroupsPlaceholder}
                                            on:input={() => (groupPage = 0)}
                                        />
                                    </span>
                                </label>
                                <div class="policy-picker-summary" aria-live="polite">
                                    <span
                                        >{messages.cardManagement.groupResults(
                                            matchingGroups.length,
                                        )}</span
                                    >
                                    <small
                                        >{messages.cardManagement.resultRange(
                                            groupPage * groupPageSize + 1,
                                            Math.min(
                                                groupPage * groupPageSize + groupPageSize,
                                                matchingGroups.length,
                                            ),
                                        )}</small
                                    >
                                </div>
                                <div class="policy-scope-group-list">
                                    {#each visibleGroups as group (group.id)}
                                        <button
                                            type="button"
                                            class:selected={group.id === groupId}
                                            class="policy-scope-option"
                                            on:click={() => selectScope(group.id)}
                                        >
                                            <span aria-hidden="true"><UiIcon name="group" /></span>
                                            <span>
                                                <strong>{group.name}</strong>
                                                <small
                                                    >{messages.cardManagement.groupMembers(
                                                        group.members.length,
                                                    )}</small
                                                >
                                            </span>
                                            {#if group.id === groupId}
                                                <b>{messages.account.selected}</b>
                                            {/if}
                                        </button>
                                    {:else}
                                        <div class="policy-empty-compact" role="status">
                                            {messages.cardManagement.noMatchingGroups}
                                        </div>
                                    {/each}
                                </div>
                                {#if groupPageCount > 1}
                                    <nav
                                        class="policy-pagination"
                                        aria-label={messages.cardManagement.groupPages}
                                    >
                                        <button
                                            type="button"
                                            class="secondary"
                                            disabled={groupPage === 0}
                                            on:click={() => (groupPage -= 1)}
                                            >‹ {messages.common.previous}</button
                                        >
                                        <span>{groupPage + 1} / {groupPageCount}</span>
                                        <button
                                            type="button"
                                            class="secondary"
                                            disabled={groupPage === groupPageCount - 1}
                                            on:click={() => (groupPage += 1)}
                                            >{messages.common.next} ›</button
                                        >
                                    </nav>
                                {/if}
                            {:else}
                                <div class="policy-empty-compact" role="status">
                                    {messages.cardManagement.noGroupsHint}
                                </div>
                            {/if}
                        </section>
                    </div>
                {/if}

                {#if pendingImport}
                    <div class="policy-confirmation-card" role="alert" transition:revealTransition>
                        <span class="policy-confirmation-icon" aria-hidden="true"
                            ><UiIcon name="privacy" /></span
                        >
                        <div>
                            <strong>{messages.cardManagement.importTitle}</strong>
                            <p>{messages.cardManagement.importConfirm}</p>
                            <small>{pendingImport.name}</small>
                        </div>
                        <div class="policy-confirmation-actions">
                            <button
                                class="secondary"
                                type="button"
                                on:click={() => (pendingImport = null)}
                                >{messages.common.cancel}</button
                            >
                            <button class="danger" type="button" on:click={confirmImport}
                                >{messages.cardManagement.replaceScope}</button
                            >
                        </div>
                    </div>
                {/if}
            </section>

            <ResponsiveTabs
                {tabs}
                selected={tab}
                label={messages.cardManagement.tabsLabel}
                onSelect={(id) => {
                    tab = id as Tab;
                    bulkPending = false;
                    clearCardPending = false;
                    deleteRulePending = false;
                }}
            />

            {#if tab === "defaults"}
                <section
                    class="card-policy-workspace card-panel"
                    role="tabpanel"
                    in:panelTransition
                >
                    <div class="policy-section-heading">
                        <div>
                            <span class="eyebrow">{messages.cardManagement.tierOne}</span>
                            <h2>{messages.cardManagement.defaultsTab}</h2>
                            <p>{messages.cardManagement.defaultsHint}</p>
                        </div>
                        <button
                            class="primary"
                            type="button"
                            disabled={busy}
                            on:click={saveDefault}
                        >
                            <UiIcon name="content" />
                            {messages.cardManagement.save}
                        </button>
                    </div>

                    <CardPolicyDirectiveEditor
                        directives={scopeDefault.directives}
                        editorKey={`default:${sessionMode ? "session" : (groupId ?? "dataspace")}`}
                        onChange={(directives) => (scopeDefault = { ...scopeDefault, directives })}
                        disabled={busy}
                        showSocialSensitivity={!sessionMode}
                    />
                </section>
            {:else if tab === "rules"}
                <section
                    class="card-policy-workspace policy-master-detail card-panel"
                    role="tabpanel"
                    in:panelTransition
                >
                    <aside class="policy-master-pane" aria-label={messages.cardManagement.rulesTab}>
                        <div class="policy-pane-heading">
                            <div>
                                <span class="eyebrow">{messages.cardManagement.tierTwo}</span>
                                <h2>{messages.cardManagement.rulesTab}</h2>
                            </div>
                            <span class="account-count-badge">{rules.length}</span>
                        </div>
                        <p>{messages.cardManagement.rulesHint}</p>
                        <button
                            class="primary policy-add-action"
                            type="button"
                            disabled={busy}
                            on:click={addRule}
                        >
                            <UiIcon name="add" />
                            {messages.cardManagement.addRule}
                        </button>

                        {#if rules.length}
                            <label class="policy-search-field">
                                <span>{messages.cardManagement.searchRules}</span>
                                <span class="policy-search-control">
                                    <UiIcon name="advanced" />
                                    <input
                                        type="search"
                                        bind:value={ruleQuery}
                                        placeholder={messages.cardManagement.searchRulesPlaceholder}
                                        on:input={() => (rulePage = 0)}
                                    />
                                </span>
                            </label>
                            <div class="policy-picker-summary" aria-live="polite">
                                <span
                                    >{messages.cardManagement.ruleResults(
                                        filteredRules.length,
                                    )}</span
                                >
                                <small
                                    >{messages.cardManagement.resultRange(
                                        rulePage * rulePageSize + 1,
                                        Math.min(
                                            rulePage * rulePageSize + rulePageSize,
                                            filteredRules.length,
                                        ),
                                    )}</small
                                >
                            </div>
                        {/if}

                        <div
                            class="policy-rule-list"
                            role="listbox"
                            aria-label={messages.cardManagement.rulesTab}
                        >
                            {#each visibleRules as rule, index (rule.id)}
                                <div class="policy-rule-row" role="presentation">
                                    <button
                                        class="policy-rule-select"
                                        type="button"
                                        role="option"
                                        aria-selected={selectedRule?.id === rule.id}
                                        class:selected={selectedRule?.id === rule.id}
                                        on:click={() => chooseRule(rule)}
                                    >
                                        <span class="policy-order-badge"
                                            >{rulePage * rulePageSize + index + 1}</span
                                        >
                                        <span>
                                            <strong>{rule.name}</strong>
                                            <small
                                                >{messages.cardManagement.conditions(
                                                    conditionCount(rule.predicate),
                                                )}</small
                                            >
                                        </span>
                                        <b class:inactive={!rule.enabled}
                                            >{rule.enabled
                                                ? messages.cardManagement.enabled
                                                : messages.cardManagement.disabled}</b
                                        >
                                    </button>
                                    <div
                                        class="policy-rule-row-actions"
                                        aria-label={`${messages.cardManagement.moveUp} / ${messages.cardManagement.moveDown}`}
                                    >
                                        <button
                                            class="secondary"
                                            type="button"
                                            aria-label={`${messages.cardManagement.moveUp}: ${rule.name}`}
                                            title={messages.cardManagement.moveUp}
                                            disabled={busy || rules[0]?.id === rule.id}
                                            on:click={() => moveRule(rule.id, -1)}>↑</button
                                        >
                                        <button
                                            class="secondary"
                                            type="button"
                                            aria-label={`${messages.cardManagement.moveDown}: ${rule.name}`}
                                            title={messages.cardManagement.moveDown}
                                            disabled={busy ||
                                                rules[rules.length - 1]?.id === rule.id}
                                            on:click={() => moveRule(rule.id, 1)}>↓</button
                                        >
                                    </div>
                                </div>
                            {:else}
                                <div class="policy-empty-state" role="status">
                                    <span aria-hidden="true"><UiIcon name="advanced" /></span>
                                    <strong>
                                        {rules.length
                                            ? messages.cardManagement.noMatchingRules
                                            : messages.cardManagement.emptyRules}
                                    </strong>
                                    <small>{messages.cardManagement.emptyRulesHint}</small>
                                </div>
                            {/each}
                        </div>

                        {#if rulePageCount > 1}
                            <nav
                                class="policy-pagination"
                                aria-label={messages.cardManagement.rulePages}
                            >
                                <button
                                    type="button"
                                    class="secondary"
                                    disabled={rulePage === 0}
                                    on:click={() => (rulePage -= 1)}
                                    >‹ {messages.common.previous}</button
                                >
                                <span>{rulePage + 1} / {rulePageCount}</span>
                                <button
                                    type="button"
                                    class="secondary"
                                    disabled={rulePage === rulePageCount - 1}
                                    on:click={() => (rulePage += 1)}
                                    >{messages.common.next} ›</button
                                >
                            </nav>
                        {/if}
                    </aside>

                    <div
                        class="policy-detail-pane"
                        use:animateState={selectedRule?.id ?? "empty-rule"}
                    >
                        {#if selectedRule}
                            <div class="policy-detail-heading">
                                <div>
                                    <span class="eyebrow"
                                        >{messages.cardManagement.selectedRule}</span
                                    >
                                    <h2>{selectedRule.name}</h2>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    class:active={selectedRule.enabled}
                                    class="policy-switch"
                                    aria-checked={selectedRule.enabled}
                                    on:click={setRuleEnabled}
                                >
                                    <span aria-hidden="true"></span>
                                    {selectedRule.enabled
                                        ? messages.cardManagement.enabled
                                        : messages.cardManagement.disabled}
                                </button>
                            </div>

                            <label class="policy-field">
                                <span>{messages.cardManagement.ruleName}</span>
                                <input
                                    class="policy-text-input"
                                    maxlength="100"
                                    bind:value={selectedRule.name}
                                />
                            </label>

                            <section
                                class="policy-editor-section"
                                aria-labelledby="rule-conditions-title"
                            >
                                <header>
                                    <div>
                                        <span class="eyebrow">{messages.cardManagement.when}</span>
                                        <h3 id="rule-conditions-title">
                                            {messages.cardManagement.filters}
                                        </h3>
                                        <p>{messages.cardManagement.filtersHint}</p>
                                    </div>
                                    <span class="account-count-badge"
                                        >{conditionCount(selectedRule.predicate)}</span
                                    >
                                </header>

                                <details open class="policy-filter-section">
                                    <summary>
                                        <span>
                                            <strong
                                                >{messages.cardManagement.identityFilters}</strong
                                            >
                                            <small
                                                >{messages.cardManagement
                                                    .identityFiltersHint}</small
                                            >
                                        </span>
                                    </summary>
                                    <div class="policy-filter-content">
                                        <fieldset class="policy-choice-fieldset">
                                            <legend>{messages.cardManagement.cardType}</legend>
                                            <div class="policy-choice-chip-grid compact">
                                                {#each cardTypeIds as id}
                                                    <button
                                                        type="button"
                                                        class:selected={predicateIncludes(
                                                            "cardTypes",
                                                            id,
                                                        )}
                                                        aria-pressed={predicateIncludes(
                                                            "cardTypes",
                                                            id,
                                                        )}
                                                        on:click={() =>
                                                            togglePredicateList("cardTypes", id)}
                                                        >{cardTypeName(id)}</button
                                                    >
                                                {/each}
                                            </div>
                                        </fieldset>
                                        <fieldset class="policy-choice-fieldset">
                                            <legend>{messages.cardManagement.category}</legend>
                                            <div class="policy-choice-chip-grid">
                                                {#each questionCategoryIds as id}
                                                    <button
                                                        type="button"
                                                        class:selected={predicateIncludes(
                                                            "questionCategoryIds",
                                                            id,
                                                        )}
                                                        aria-pressed={predicateIncludes(
                                                            "questionCategoryIds",
                                                            id,
                                                        )}
                                                        on:click={() =>
                                                            togglePredicateList(
                                                                "questionCategoryIds",
                                                                id,
                                                            )}>{taxonomyLabel(taxonomy, id)}</button
                                                    >
                                                {/each}
                                            </div>
                                        </fieldset>
                                        <fieldset class="policy-choice-fieldset">
                                            <legend>{messages.cardManagement.dareType}</legend>
                                            <div class="policy-choice-chip-grid">
                                                {#each dareTypeIds as id}
                                                    <button
                                                        type="button"
                                                        class:selected={predicateIncludes(
                                                            "dareTypeIds",
                                                            id,
                                                        )}
                                                        aria-pressed={predicateIncludes(
                                                            "dareTypeIds",
                                                            id,
                                                        )}
                                                        on:click={() =>
                                                            togglePredicateList("dareTypeIds", id)}
                                                        >{taxonomyLabel(taxonomy, id)}</button
                                                    >
                                                {/each}
                                            </div>
                                        </fieldset>
                                        <fieldset class="policy-choice-fieldset">
                                            <legend>{messages.cardManagement.dareAffinity}</legend>
                                            <div class="policy-choice-chip-grid">
                                                {#each questionCategoryIds as id}
                                                    <button
                                                        type="button"
                                                        class:selected={predicateIncludes(
                                                            "dareAffinityCategoryIds",
                                                            id,
                                                        )}
                                                        aria-pressed={predicateIncludes(
                                                            "dareAffinityCategoryIds",
                                                            id,
                                                        )}
                                                        on:click={() =>
                                                            togglePredicateList(
                                                                "dareAffinityCategoryIds",
                                                                id,
                                                            )}>{taxonomyLabel(taxonomy, id)}</button
                                                    >
                                                {/each}
                                            </div>
                                        </fieldset>
                                    </div>
                                </details>

                                <details class="policy-filter-section">
                                    <summary>
                                        <span>
                                            <strong>{messages.cardManagement.contentFilters}</strong
                                            >
                                            <small
                                                >{messages.cardManagement.contentFiltersHint}</small
                                            >
                                        </span>
                                    </summary>
                                    <div class="policy-filter-content">
                                        <fieldset class="policy-choice-fieldset">
                                            <legend>{messages.cardManagement.sensitivity}</legend>
                                            <div class="policy-choice-chip-grid">
                                                {#each sensitivityIds as id}
                                                    <button
                                                        type="button"
                                                        class:selected={predicateIncludes(
                                                            "socialSensitivities",
                                                            id,
                                                        )}
                                                        aria-pressed={predicateIncludes(
                                                            "socialSensitivities",
                                                            id,
                                                        )}
                                                        on:click={() =>
                                                            togglePredicateList(
                                                                "socialSensitivities",
                                                                id,
                                                            )}
                                                        >{messages.cardManagement.sensitivityNames[
                                                            id
                                                        ]}</button
                                                    >
                                                {/each}
                                            </div>
                                        </fieldset>
                                        {#each [["operationalFlagsAll", messages.cardManagement.flagsAll], ["operationalFlagsAny", messages.cardManagement.flagsAny], ["operationalFlagsNone", messages.cardManagement.flagsNone]] as flagGroup}
                                            <fieldset class="policy-choice-fieldset">
                                                <legend>{flagGroup[1]}</legend>
                                                <div class="policy-choice-chip-grid">
                                                    {#each operationalFlagIds as flag}
                                                        <button
                                                            type="button"
                                                            class:selected={predicateIncludes(
                                                                flagGroup[0] as PredicateListProperty,
                                                                flag,
                                                            )}
                                                            aria-pressed={predicateIncludes(
                                                                flagGroup[0] as PredicateListProperty,
                                                                flag,
                                                            )}
                                                            on:click={() =>
                                                                togglePredicateList(
                                                                    flagGroup[0] as PredicateListProperty,
                                                                    flag,
                                                                )}
                                                            >{operationalFlagLabels[flag]}</button
                                                        >
                                                    {/each}
                                                </div>
                                            </fieldset>
                                        {/each}
                                    </div>
                                </details>

                                <details class="policy-filter-section">
                                    <summary>
                                        <span>
                                            <strong>{messages.cardManagement.numericFilters}</strong
                                            >
                                            <small
                                                >{messages.cardManagement.numericFiltersHint}</small
                                            >
                                        </span>
                                    </summary>
                                    <div class="policy-filter-content policy-filter-grid">
                                        <label class="policy-field">
                                            <span>{messages.cardManagement.lifecycle}</span>
                                            <span class="policy-select-shell">
                                                <select
                                                    value={selectedRule.predicate.lifecycle ?? ""}
                                                    on:change={(event) =>
                                                        updatePredicateValue(
                                                            "lifecycle",
                                                            event.currentTarget.value || undefined,
                                                        )}
                                                >
                                                    <option value=""
                                                        >{messages.cardManagement.anyValue}</option
                                                    >
                                                    <option value="ACTIVE"
                                                        >{messages.cardManagement.active}</option
                                                    >
                                                    <option value="RETIRED"
                                                        >{messages.cardManagement.retired}</option
                                                    >
                                                </select>
                                            </span>
                                        </label>
                                        <label class="policy-field">
                                            <span
                                                >{messages.cardManagement.yesNoAnswerPossible}</span
                                            >
                                            <span class="policy-select-shell">
                                                <select
                                                    value={selectedRule.predicate
                                                        .yesNoAnswerPossible === undefined
                                                        ? ""
                                                        : String(
                                                              selectedRule.predicate
                                                                  .yesNoAnswerPossible,
                                                          )}
                                                    on:change={(event) =>
                                                        updatePredicateValue(
                                                            "yesNoAnswerPossible",
                                                            event.currentTarget.value === ""
                                                                ? undefined
                                                                : event.currentTarget.value ===
                                                                      "true",
                                                        )}
                                                >
                                                    <option value=""
                                                        >{messages.cardManagement.anyValue}</option
                                                    >
                                                    <option value="true"
                                                        >{messages.common.yes}</option
                                                    >
                                                    <option value="false"
                                                        >{messages.common.no}</option
                                                    >
                                                </select>
                                            </span>
                                        </label>
                                        {#each [["minimumIntensity", messages.cardManagement.minimumIntensity, "1", "5", "1"], ["maximumIntensity", messages.cardManagement.maximumIntensity, "1", "5", "1"], ["minimumRepeatCooldown", messages.cardManagement.minimumRepeatCooldown, "0", undefined, "1"], ["maximumRepeatCooldown", messages.cardManagement.maximumRepeatCooldown, "0", undefined, "1"], ["minimumWeight", messages.cardManagement.minimumWeight, "0.01", undefined, "0.1"], ["maximumWeight", messages.cardManagement.maximumWeight, "0.01", undefined, "0.1"], ["minimumPlayerCountAtLeast", messages.cardManagement.minimumPlayersAtLeast, "2", undefined, "1"], ["maximumPlayerCountAtMost", messages.cardManagement.maximumPlayersAtMost, "2", undefined, "1"]] as numericFilter}
                                            <label class="policy-field">
                                                <span>{numericFilter[1]}</span>
                                                <input
                                                    class="policy-number-input"
                                                    type="number"
                                                    min={numericFilter[2]}
                                                    max={numericFilter[3]}
                                                    step={numericFilter[4]}
                                                    value={(
                                                        selectedRule.predicate as Record<
                                                            string,
                                                            number
                                                        >
                                                    )[numericFilter[0]!] ?? ""}
                                                    on:input={(event) =>
                                                        updatePredicateValue(
                                                            numericFilter[0] as keyof CardPolicyPredicate,
                                                            event.currentTarget.value
                                                                ? Number(event.currentTarget.value)
                                                                : undefined,
                                                        )}
                                                />
                                            </label>
                                        {/each}
                                        {#each [["alwaysEligible", messages.cardManagement.alwaysEligible], ["repeatableInSession", messages.cardManagement.repeatableInSession]] as booleanFilter}
                                            <label class="policy-field">
                                                <span>{booleanFilter[1]}</span>
                                                <span class="policy-select-shell">
                                                    <select
                                                        value={(
                                                            selectedRule.predicate as Record<
                                                                string,
                                                                boolean | undefined
                                                            >
                                                        )[booleanFilter[0]] === undefined
                                                            ? ""
                                                            : String(
                                                                  (
                                                                      selectedRule.predicate as Record<
                                                                          string,
                                                                          boolean
                                                                      >
                                                                  )[booleanFilter[0]],
                                                              )}
                                                        on:change={(event) =>
                                                            updatePredicateValue(
                                                                booleanFilter[0] as keyof CardPolicyPredicate,
                                                                event.currentTarget.value === ""
                                                                    ? undefined
                                                                    : event.currentTarget.value ===
                                                                          "true",
                                                            )}
                                                    >
                                                        <option value=""
                                                            >{messages.cardManagement
                                                                .anyValue}</option
                                                        >
                                                        <option value="true"
                                                            >{messages.common.yes}</option
                                                        >
                                                        <option value="false"
                                                            >{messages.common.no}</option
                                                        >
                                                    </select>
                                                </span>
                                            </label>
                                        {/each}
                                    </div>
                                </details>

                                <div class="policy-preview-panel">
                                    <div>
                                        <strong>{messages.cardManagement.matchPreview}</strong>
                                        <small>{messages.cardManagement.matchPreviewHint}</small>
                                    </div>
                                    <button
                                        class="secondary"
                                        type="button"
                                        disabled={busy}
                                        on:click={previewRule}
                                    >
                                        <UiIcon name="quick" />
                                        {messages.cardManagement.checkMatches}
                                    </button>
                                    {#if previewCount !== null}
                                        <div
                                            class:warning={previewCount === 0}
                                            class="rule-match-result"
                                            role="status"
                                            transition:revealTransition
                                        >
                                            <strong
                                                >{messages.cardManagement.matches(
                                                    previewCount,
                                                )}</strong
                                            >
                                            <small>
                                                {previewCount === 0
                                                    ? messages.cardManagement.zeroMatches
                                                    : messages.cardManagement.previewReady}
                                            </small>
                                        </div>
                                        {#if previewCards.length}
                                            <ul
                                                class="rule-preview-cards"
                                                transition:revealTransition
                                            >
                                                {#each previewCards.slice(0, 5) as card}
                                                    <li>
                                                        <span
                                                            >{cardTypeName(
                                                                card.cardType ?? "",
                                                            )}</span
                                                        >
                                                        <strong>{card.text}</strong>
                                                    </li>
                                                {/each}
                                            </ul>
                                        {/if}
                                    {:else}
                                        <p
                                            class="policy-preview-required"
                                            transition:revealTransition
                                        >
                                            {messages.cardManagement.previewOptional}
                                        </p>
                                    {/if}
                                </div>
                            </section>

                            <section
                                class="policy-editor-section"
                                aria-labelledby="rule-actions-title"
                            >
                                <header>
                                    <div>
                                        <span class="eyebrow">{messages.cardManagement.then}</span>
                                        <h3 id="rule-actions-title">
                                            {messages.cardManagement.properties}
                                        </h3>
                                        <p>{messages.cardManagement.ruleActionsHint}</p>
                                    </div>
                                </header>
                                <CardPolicyDirectiveEditor
                                    directives={selectedRule.directives}
                                    editorKey={`rule:${selectedRule.id}`}
                                    onChange={(directives) =>
                                        (selectedRule = { ...selectedRule!, directives })}
                                    disabled={busy}
                                    showSocialSensitivity={!sessionMode}
                                />
                            </section>

                            <div class="policy-sticky-actions">
                                <button
                                    class="danger-outline"
                                    type="button"
                                    disabled={busy}
                                    on:click={() => (deleteRulePending = true)}
                                    >{messages.cardManagement.deleteRule}</button
                                >
                                <button
                                    class="primary"
                                    type="button"
                                    disabled={busy || !selectedRule.name.trim()}
                                    on:click={saveRule}>{messages.common.save}</button
                                >
                            </div>

                            {#if deleteRulePending}
                                <div
                                    class="policy-confirmation-card destructive"
                                    role="alert"
                                    transition:revealTransition
                                >
                                    <span class="policy-confirmation-icon" aria-hidden="true"
                                        ><UiIcon name="privacy" /></span
                                    >
                                    <div>
                                        <strong>{messages.cardManagement.deleteRuleTitle}</strong>
                                        <p>{messages.cardManagement.deleteRuleConfirm}</p>
                                        <small>{selectedRule.name}</small>
                                    </div>
                                    <div class="policy-confirmation-actions">
                                        <button
                                            class="secondary"
                                            type="button"
                                            on:click={() => (deleteRulePending = false)}
                                            >{messages.common.cancel}</button
                                        >
                                        <button class="danger" type="button" on:click={deleteRule}
                                            >{messages.cardManagement.deleteRule}</button
                                        >
                                    </div>
                                </div>
                            {/if}
                        {:else}
                            <div class="policy-empty-state large" role="status">
                                <span aria-hidden="true"><UiIcon name="advanced" /></span>
                                <strong>{messages.cardManagement.selectRule}</strong>
                                <small>{messages.cardManagement.selectRuleHint}</small>
                            </div>
                        {/if}
                    </div>
                </section>
            {:else}
                <section
                    class="card-policy-workspace policy-master-detail card-panel"
                    role="tabpanel"
                    in:panelTransition
                >
                    <aside
                        class="policy-master-pane card-search-pane"
                        aria-label={messages.cardManagement.cardsTab}
                    >
                        <div class="policy-pane-heading">
                            <div>
                                <span class="eyebrow">{messages.cardManagement.tierThree}</span>
                                <h2>{messages.cardManagement.cardsTab}</h2>
                            </div>
                            <span class="account-count-badge">{cardTotal}</span>
                        </div>
                        <p>{messages.cardManagement.cardsHint}</p>

                        <form class="managed-card-search" on:submit|preventDefault={runCardSearch}>
                            <label class="policy-search-field">
                                <span>{messages.cardManagement.search}</span>
                                <span class="policy-search-control">
                                    <UiIcon name="content" />
                                    <textarea
                                        bind:value={searchText}
                                        maxlength="200"
                                        rows="1"
                                        wrap="soft"
                                        placeholder={messages.cardManagement.searchPlaceholder}
                                    ></textarea>
                                </span>
                            </label>

                            <details class="card-filter-drawer" bind:open={filtersOpen}>
                                <summary>
                                    <span>
                                        <strong>{messages.cardManagement.filters}</strong>
                                        <small>{messages.cardManagement.cardFiltersHint}</small>
                                    </span>
                                    {#if activeFilterCount}<b>{activeFilterCount}</b>{/if}
                                </summary>
                                <div class="search-filters">
                                    <label class="policy-field">
                                        <span>{messages.cardManagement.cardType}</span>
                                        <span class="policy-select-shell">
                                            <select bind:value={cardType}>
                                                <option value=""
                                                    >{messages.cardManagement.anyValue}</option
                                                >
                                                {#each cardTypeIds as id}
                                                    <option value={id}>{cardTypeName(id)}</option>
                                                {/each}
                                            </select>
                                        </span>
                                    </label>
                                    <div class="policy-field">
                                        <span>{messages.cardManagement.category}</span>
                                        <WrappingSelect
                                            value={questionCategoryId}
                                            options={questionCategoryOptions}
                                            label={messages.cardManagement.category}
                                            onChange={(value) => (questionCategoryId = value)}
                                        />
                                    </div>
                                    <div class="policy-field">
                                        <span>{messages.cardManagement.dareType}</span>
                                        <WrappingSelect
                                            value={dareTypeId}
                                            options={dareTypeOptions}
                                            label={messages.cardManagement.dareType}
                                            onChange={(value) => (dareTypeId = value)}
                                        />
                                    </div>
                                    <label class="policy-field">
                                        <span>{messages.cardManagement.sensitivity}</span>
                                        <span class="policy-select-shell">
                                            <select bind:value={sensitivity}>
                                                <option value=""
                                                    >{messages.cardManagement.anyValue}</option
                                                >
                                                {#each sensitivityIds as id}
                                                    <option value={id}
                                                        >{messages.cardManagement.sensitivityNames[
                                                            id
                                                        ]}</option
                                                    >
                                                {/each}
                                            </select>
                                        </span>
                                    </label>
                                    <label class="policy-field">
                                        <span>{messages.cardManagement.operationalFlag}</span>
                                        <span class="policy-select-shell">
                                            <select bind:value={operationalFlag}>
                                                <option value=""
                                                    >{messages.cardManagement.anyValue}</option
                                                >
                                                {#each operationalFlagIds as id}
                                                    <option value={id}
                                                        >{operationalFlagLabels[id]}</option
                                                    >
                                                {/each}
                                            </select>
                                        </span>
                                    </label>
                                    <label class="policy-field">
                                        <span>{messages.cardManagement.yesNoAnswerPossible}</span>
                                        <span class="policy-select-shell">
                                            <select bind:value={yesNoAnswerPossible}>
                                                <option value=""
                                                    >{messages.cardManagement.anyValue}</option
                                                >
                                                <option value="true">{messages.common.yes}</option>
                                                <option value="false">{messages.common.no}</option>
                                            </select>
                                        </span>
                                    </label>
                                    <label class="policy-field">
                                        <span>{messages.cardManagement.lifecycle}</span>
                                        <span class="policy-select-shell">
                                            <select bind:value={lifecycle}>
                                                <option value=""
                                                    >{messages.cardManagement.anyValue}</option
                                                >
                                                <option value="ACTIVE"
                                                    >{messages.cardManagement.active}</option
                                                >
                                                <option value="RETIRED"
                                                    >{messages.cardManagement.retired}</option
                                                >
                                            </select>
                                        </span>
                                    </label>
                                    <label class="policy-field">
                                        <span>{messages.cardManagement.fitsPlayerCount}</span>
                                        <input
                                            class="policy-number-input"
                                            type="number"
                                            min="2"
                                            bind:value={playerCount}
                                            placeholder={messages.cardManagement
                                                .playerCountPlaceholder}
                                        />
                                    </label>
                                </div>
                                <button
                                    class="text-button policy-clear-filters"
                                    type="button"
                                    on:click={clearCardFilters}
                                    >{messages.cardManagement.clearFilters}</button
                                >
                            </details>

                            <button class="primary" disabled={busy}>
                                <UiIcon name="quick" />
                                {messages.cardManagement.searchAction}
                            </button>
                        </form>

                        <div class="policy-picker-summary card-result-summary" aria-live="polite">
                            <span
                                >{messages.cardManagement.results(
                                    cardRangeStart,
                                    cardRangeEnd,
                                    cardTotal,
                                )}</span
                            >
                            <small>{messages.cardManagement.serverPaged}</small>
                        </div>

                        <div
                            class="managed-card-list"
                            role="listbox"
                            aria-label={messages.cardManagement.cardsTab}
                        >
                            {#each cards as card (card.id)}
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={selectedCard?.id === card.id}
                                    class:selected={selectedCard?.id === card.id}
                                    on:click={() => chooseCard(card)}
                                >
                                    <span
                                        class="managed-card-type"
                                        data-type={card.cardType}
                                        aria-hidden="true"
                                    >
                                        <UiIcon
                                            name={card.cardType === "QUESTION"
                                                ? "question"
                                                : card.cardType === "DARE"
                                                  ? "dare"
                                                  : "conversation"}
                                        />
                                    </span>
                                    <span class="managed-card-copy">
                                        <strong>{card.text}</strong>
                                        <small
                                            >{cardTypeName(card.cardType)}{#if card.taxonomyLabel}
                                                · {card.taxonomyLabel}{/if}</small
                                        >
                                    </span>
                                    {#if card.localRevision > 0}
                                        <b>{messages.cardManagement.overridden}</b>
                                    {/if}
                                </button>
                            {:else}
                                <div class="policy-empty-state" role="status">
                                    <span aria-hidden="true"><UiIcon name="content" /></span>
                                    <strong>{messages.cardManagement.noCards}</strong>
                                    <small>{messages.cardManagement.noCardsHint}</small>
                                </div>
                            {/each}
                        </div>

                        <nav
                            class="policy-pagination"
                            aria-label={messages.cardManagement.cardPages}
                        >
                            <button
                                type="button"
                                class="secondary"
                                disabled={busy || cardPageIndex === 0}
                                on:click={previousCardPage}>‹ {messages.common.previous}</button
                            >
                            <span>{messages.cardManagement.page(cardPageIndex + 1)}</span>
                            <button
                                type="button"
                                class="secondary"
                                disabled={busy || !nextCursor}
                                on:click={nextCardPage}>{messages.common.next} ›</button
                            >
                        </nav>
                    </aside>

                    <div
                        class="policy-detail-pane card-policy-detail"
                        use:animateState={selectedCard?.id ?? "empty-card"}
                    >
                        {#if selectedCard}
                            <header class="managed-card-header">
                                <div class="managed-card-badges">
                                    <span>{cardTypeName(selectedCard.cardType)}</span>
                                    <span class:retired={selectedCard.lifecycle === "RETIRED"}
                                        >{lifecycleName(selectedCard.lifecycle)}</span
                                    >
                                    {#if selectedCard.localRevision > 0}
                                        <span class="local"
                                            >{messages.cardManagement.overridden}</span
                                        >
                                    {/if}
                                </div>
                                <h2>{selectedCard.text}</h2>
                                <p class="managed-card-meta">
                                    <span class="managed-card-taxonomy">
                                        {selectedCard.taxonomyLabel ??
                                            messages.cardManagement.noTaxonomy}
                                    </span>
                                    <span class="managed-card-id">
                                        {messages.cardManagement.cardId(selectedCard.id)}
                                    </span>
                                </p>
                                {#if selectedCard.operationalFlags.length}
                                    <div
                                        class="managed-card-flags"
                                        aria-label={messages.cardManagement.operationalFlags}
                                    >
                                        {#each selectedCard.operationalFlags as flag}
                                            <span>{operationalFlagLabels[flag]}</span>
                                        {/each}
                                    </div>
                                {/if}
                            </header>

                            <section
                                class="policy-editor-section provenance-section"
                                aria-labelledby="card-provenance-title"
                            >
                                <header>
                                    <div>
                                        <span class="eyebrow"
                                            >{messages.cardManagement.resolution}</span
                                        >
                                        <h3 id="card-provenance-title">
                                            {messages.cardManagement.properties}
                                        </h3>
                                        <p>{messages.cardManagement.provenanceHint}</p>
                                    </div>
                                </header>
                                <div class="property-provenance-grid" role="list">
                                    {#each propertyNames as property}
                                        <article class="property-provenance-card" role="listitem">
                                            <header>
                                                <strong>{propertyLabel(property)}</strong>
                                                <span
                                                    >{displayValue(
                                                        property,
                                                        selectedCard.effective[property],
                                                    )}</span
                                                >
                                            </header>
                                            <dl>
                                                <div>
                                                    <dt>{messages.cardManagement.source}</dt>
                                                    <dd>
                                                        {displayProvenance(
                                                            selectedCard.provenance[property],
                                                        )}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>{messages.cardManagement.producerValue}</dt>
                                                    <dd>
                                                        {displayValue(
                                                            property,
                                                            selectedCard.producer[property],
                                                        )}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>
                                                        {messages.cardManagement.localDirective}
                                                    </dt>
                                                    <dd>{displayDirective(property)}</dd>
                                                </div>
                                            </dl>
                                        </article>
                                    {/each}
                                </div>
                            </section>

                            <section
                                class="policy-editor-section"
                                aria-labelledby="card-override-title"
                            >
                                <header>
                                    <div>
                                        <span class="eyebrow"
                                            >{messages.cardManagement.localChange}</span
                                        >
                                        <h3 id="card-override-title">
                                            {messages.cardManagement.editOverride}
                                        </h3>
                                        <p>{messages.cardManagement.editOverrideHint}</p>
                                    </div>
                                    <span class="account-count-badge">{localDirectiveCount}</span>
                                </header>
                                <CardPolicyDirectiveEditor
                                    directives={cardDirectives}
                                    editorKey={`card:${selectedCard.id}`}
                                    onChange={(directives) => {
                                        cardDirectives = directives;
                                        bulkPending = false;
                                    }}
                                    disabled={busy}
                                    showSocialSensitivity={!sessionMode}
                                />
                            </section>

                            <div class="policy-sticky-actions card-policy-actions">
                                {#if !sessionMode}
                                    <button
                                        class="secondary"
                                        type="button"
                                        disabled={busy ||
                                            cardTotal === 0 ||
                                            localDirectiveCount === 0}
                                        on:click={() => (bulkPending = true)}
                                        >{messages.cardManagement.applyToResults(cardTotal)}</button
                                    >
                                {/if}
                                <button
                                    class="danger-outline"
                                    type="button"
                                    disabled={busy || selectedCard.localRevision === 0}
                                    on:click={() => (clearCardPending = true)}
                                    >{messages.cardManagement.clearOverride}</button
                                >
                                <button
                                    class="primary"
                                    type="button"
                                    disabled={busy}
                                    on:click={saveCard}
                                >
                                    {localDirectiveCount
                                        ? messages.common.save
                                        : messages.cardManagement.keepInherited}
                                </button>
                            </div>

                            {#if bulkPending}
                                <div
                                    class="policy-confirmation-card"
                                    role="alert"
                                    transition:revealTransition
                                >
                                    <span class="policy-confirmation-icon" aria-hidden="true"
                                        ><UiIcon name="content" /></span
                                    >
                                    <div>
                                        <strong
                                            >{messages.cardManagement.bulkTitle(cardTotal)}</strong
                                        >
                                        <p>{messages.cardManagement.bulkConfirm(cardTotal)}</p>
                                        <small>{messages.cardManagement.bulkStableHint}</small>
                                    </div>
                                    <div class="policy-confirmation-actions">
                                        <button
                                            class="secondary"
                                            type="button"
                                            on:click={() => (bulkPending = false)}
                                            >{messages.common.cancel}</button
                                        >
                                        <button
                                            class="primary"
                                            type="button"
                                            on:click={applyCardToResults}
                                            >{messages.cardManagement.applyNow}</button
                                        >
                                    </div>
                                </div>
                            {/if}

                            {#if clearCardPending}
                                <div
                                    class="policy-confirmation-card destructive"
                                    role="alert"
                                    transition:revealTransition
                                >
                                    <span class="policy-confirmation-icon" aria-hidden="true"
                                        ><UiIcon name="privacy" /></span
                                    >
                                    <div>
                                        <strong>{messages.cardManagement.clearOverrideTitle}</strong
                                        >
                                        <p>{messages.cardManagement.clearOverrideConfirm}</p>
                                    </div>
                                    <div class="policy-confirmation-actions">
                                        <button
                                            class="secondary"
                                            type="button"
                                            on:click={() => (clearCardPending = false)}
                                            >{messages.common.cancel}</button
                                        >
                                        <button class="danger" type="button" on:click={clearCard}
                                            >{messages.cardManagement.clearOverride}</button
                                        >
                                    </div>
                                </div>
                            {/if}
                        {:else}
                            <div class="policy-empty-state large" role="status">
                                <span aria-hidden="true"><UiIcon name="content" /></span>
                                <strong>{messages.cardManagement.selectCard}</strong>
                                <small>{messages.cardManagement.selectCardHint}</small>
                            </div>
                        {/if}
                    </div>
                </section>
            {/if}
        {/if}
    </div>
</svelte:element>
