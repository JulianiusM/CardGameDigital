import type { Card } from "../cards/card";
import type { SocialSensitivity } from "../cards/socialSensitivity";

export const AVAILABILITY_DIRECTIVES = ["INHERIT", "INCLUDE", "EXCLUDE"] as const;
export type AvailabilityDirective = (typeof AVAILABILITY_DIRECTIVES)[number];
export const BOOLEAN_DIRECTIVES = ["INHERIT", "ENABLE", "DISABLE"] as const;
export type BooleanDirective = (typeof BOOLEAN_DIRECTIVES)[number];
export const SCALAR_DIRECTIVE_MODES = ["INHERIT", "CATALOG", "SET"] as const;

export type ScalarDirective<T> =
    { mode: "INHERIT" } | { mode: "CATALOG" } | { mode: "SET"; value: T };

export type PlayerCountRange = { minimum: number; maximum: number | null };

export type CardPolicyDirectives = {
    availability?: AvailabilityDirective;
    alwaysEligible?: BooleanDirective;
    repeatableInSession?: BooleanDirective;
    repeatCooldown?: ScalarDirective<number>;
    intensity?: ScalarDirective<1 | 2 | 3 | 4 | 5>;
    weight?: ScalarDirective<number>;
    socialSensitivity?: ScalarDirective<SocialSensitivity>;
    playerCount?: ScalarDirective<PlayerCountRange>;
};

export type CardPolicyPredicate = {
    cardTypes?: readonly Card["cardType"][];
    questionCategoryIds?: readonly NonNullable<Card["questionCategoryId"]>[];
    dareTypeIds?: readonly NonNullable<Card["dareTypeId"]>[];
    dareAffinityCategoryIds?: readonly NonNullable<Card["dareAffinityCategoryId"]>[];
    yesNoAnswerPossible?: boolean;
    socialSensitivities?: readonly SocialSensitivity[];
    operationalFlagsAll?: readonly Card["operationalFlags"][number][];
    operationalFlagsAny?: readonly Card["operationalFlags"][number][];
    operationalFlagsNone?: readonly Card["operationalFlags"][number][];
    minimumIntensity?: number;
    maximumIntensity?: number;
    alwaysEligible?: boolean;
    repeatableInSession?: boolean;
    minimumRepeatCooldown?: number;
    maximumRepeatCooldown?: number;
    minimumWeight?: number;
    maximumWeight?: number;
    minimumPlayerCountAtLeast?: number;
    maximumPlayerCountAtMost?: number;
    lifecycle?: "ACTIVE" | "RETIRED";
};

export type CardPolicyRule = {
    id: string;
    name: string;
    order: number;
    enabled: boolean;
    predicate: CardPolicyPredicate;
    directives: CardPolicyDirectives;
};

export type CardPolicyScope = {
    name: string;
    scopeDefault?: CardPolicyDirectives;
    conditionalRules?: readonly CardPolicyRule[];
    exactCards?: ReadonlyMap<string, CardPolicyDirectives>;
};

export const MANAGED_CARD_PROPERTIES = [
    "availability",
    "alwaysEligible",
    "repeatableInSession",
    "repeatCooldown",
    "intensity",
    "weight",
    "socialSensitivity",
    "playerCount",
] as const;
export type ManagedCardProperty = (typeof MANAGED_CARD_PROPERTIES)[number];
export type PolicyProvenance = Record<ManagedCardProperty, string>;

export type EffectivePolicyCard<T extends Card = Card> = T & {
    policyAvailable: boolean;
    provenance: PolicyProvenance;
};

function includes<T>(values: readonly T[] | undefined, value: T | null): boolean {
    return !values?.length || (value !== null && values.includes(value));
}

function matchesOptionalValue<T>(expected: T | undefined, actual: T): boolean {
    return expected === undefined || expected === actual;
}

function matchesRange(value: number, minimum?: number, maximum?: number): boolean {
    return (
        (minimum === undefined || value >= minimum) && (maximum === undefined || value <= maximum)
    );
}

function matchesTaxonomy(card: Card, predicate: CardPolicyPredicate): boolean {
    return (
        includes(predicate.cardTypes, card.cardType) &&
        includes(predicate.questionCategoryIds, card.questionCategoryId) &&
        includes(predicate.dareTypeIds, card.dareTypeId) &&
        includes(predicate.dareAffinityCategoryIds, card.dareAffinityCategoryId) &&
        includes(predicate.socialSensitivities, card.socialSensitivity)
    );
}

function matchesOperationalFlags(card: Card, predicate: CardPolicyPredicate): boolean {
    const flags = new Set(card.operationalFlags);
    if (predicate.operationalFlagsAll?.some((flag) => !flags.has(flag))) return false;
    if (
        predicate.operationalFlagsAny?.length &&
        !predicate.operationalFlagsAny.some((flag) => flags.has(flag))
    )
        return false;
    return !predicate.operationalFlagsNone?.some((flag) => flags.has(flag));
}

function matchesPlayerCount(card: Card, predicate: CardPolicyPredicate): boolean {
    if (!matchesRange(card.minimumPlayerCount, predicate.minimumPlayerCountAtLeast)) return false;
    if (predicate.maximumPlayerCountAtMost === undefined) return true;
    return (
        card.maximumPlayerCount !== null &&
        card.maximumPlayerCount <= predicate.maximumPlayerCountAtMost
    );
}

export function matchesCardPolicyPredicate(card: Card, predicate: CardPolicyPredicate): boolean {
    return (
        matchesTaxonomy(card, predicate) &&
        matchesOptionalValue(predicate.yesNoAnswerPossible, card.yesNoAnswerPossible) &&
        matchesOptionalValue(predicate.lifecycle, card.active ? "ACTIVE" : "RETIRED") &&
        matchesOptionalValue(predicate.alwaysEligible, card.alwaysEligible) &&
        matchesOptionalValue(predicate.repeatableInSession, card.repeatableInSession) &&
        matchesRange(card.intensity, predicate.minimumIntensity, predicate.maximumIntensity) &&
        matchesRange(
            card.repeatCooldown,
            predicate.minimumRepeatCooldown,
            predicate.maximumRepeatCooldown,
        ) &&
        matchesRange(card.weight, predicate.minimumWeight, predicate.maximumWeight) &&
        matchesPlayerCount(card, predicate) &&
        matchesOperationalFlags(card, predicate)
    );
}

function applyBoolean(value: boolean, directive: BooleanDirective | undefined): boolean {
    if (directive === "ENABLE") return true;
    if (directive === "DISABLE") return false;
    return value;
}

function applyScalar<T>(producer: T, value: T, directive: ScalarDirective<T> | undefined): T {
    if (!directive || directive.mode === "INHERIT") return value;
    if (directive.mode === "CATALOG") return producer;
    return directive.value;
}

function applyDirectives<T extends Card>(
    current: EffectivePolicyCard<T>,
    producer: T,
    directives: CardPolicyDirectives | undefined,
    source: string,
    includeAvailability: boolean,
): EffectivePolicyCard<T> {
    if (!directives) return current;
    const next = current;
    if (includeAvailability && isAvailabilityOverride(directives.availability)) {
        next.policyAvailable = directives.availability === "INCLUDE";
        next.provenance.availability = source;
    }
    if (directives.alwaysEligible && directives.alwaysEligible !== "INHERIT") {
        next.alwaysEligible = applyBoolean(next.alwaysEligible, directives.alwaysEligible);
        next.provenance.alwaysEligible = source;
    }
    if (directives.repeatableInSession && directives.repeatableInSession !== "INHERIT") {
        next.repeatableInSession = applyBoolean(
            next.repeatableInSession,
            directives.repeatableInSession,
        );
        next.provenance.repeatableInSession = source;
    }
    for (const property of [
        "repeatCooldown",
        "intensity",
        "weight",
        "socialSensitivity",
    ] as const) {
        const directive = directives[property] as ScalarDirective<never> | undefined;
        if (!directive || directive.mode === "INHERIT") continue;
        next[property] = applyScalar(
            producer[property] as never,
            next[property] as never,
            directive,
        );
        next.provenance[property] = directive.mode === "CATALOG" ? "Catalog" : source;
    }
    applyPlayerCountDirective<T>(directives, producer, next, source);
    return next;
}

function applyPlayerCountDirective<T extends Card>(
    directives: CardPolicyDirectives,
    producer: T,
    next: T & {
        provenance: {
            alwaysEligible: string;
            repeatableInSession: string;
            availability: string;
            repeatCooldown: string;
            intensity: string;
            weight: string;
            socialSensitivity: string;
            playerCount: string;
        };
        policyAvailable: boolean;
    },
    source: string,
) {
    const playerCount = directives.playerCount;
    if (playerCount && playerCount.mode !== "INHERIT") {
        const range = applyScalar(
            { minimum: producer.minimumPlayerCount, maximum: producer.maximumPlayerCount },
            { minimum: next.minimumPlayerCount, maximum: next.maximumPlayerCount },
            playerCount,
        );
        next.minimumPlayerCount = range.minimum;
        next.maximumPlayerCount = range.maximum;
        next.provenance.playerCount = playerCount.mode === "CATALOG" ? "Catalog" : source;
    }
}

function applyScope<T extends Card>(
    card: EffectivePolicyCard<T>,
    producer: T,
    scope: CardPolicyScope | undefined,
    includeAvailability: boolean,
): EffectivePolicyCard<T> {
    if (!scope) return card;
    const current = { ...card, provenance: { ...card.provenance } };
    const unresolved = new Set<keyof CardPolicyDirectives>([
        "availability",
        "alwaysEligible",
        "repeatableInSession",
        "repeatCooldown",
        "intensity",
        "weight",
        "socialSensitivity",
        "playerCount",
    ]);
    if (!includeAvailability) unresolved.delete("availability");
    const overrides = (directives: CardPolicyDirectives) =>
        Object.entries(directives).filter(([property, directive]) => {
            if (
                !unresolved.has(property as keyof CardPolicyDirectives) ||
                !directive ||
                directive === "INHERIT"
            )
                return false;
            return typeof directive === "string" || directive.mode !== "INHERIT";
        });
    const apply = (entries: ReturnType<typeof overrides>, source: string) => {
        if (!entries.length) return;
        applyDirectives(
            current,
            producer,
            Object.fromEntries(entries),
            source,
            includeAvailability,
        );
        for (const [property] of entries) unresolved.delete(property as keyof CardPolicyDirectives);
    };
    apply(overrides(scope.exactCards?.get(producer.id) ?? {}), `${scope.name} Exact Card`);
    // Predicates always refer to producer metadata. The last non-inherited directive
    // for each independent property wins, so earlier shadowed rules need no evaluation.
    const rules = sortedScopeRules(scope);
    for (let index = rules.length - 1; index >= 0 && unresolved.size; index--) {
        const rule = rules[index];
        const entries = overrides(rule.directives);
        if (entries.length && matchesCardPolicyPredicate(producer, rule.predicate))
            apply(entries, `${scope.name} rule “${rule.name}”`);
    }
    apply(overrides(scope.scopeDefault ?? {}), `${scope.name} Scope Default`);
    return current;
}

export function resolveCardPolicy<T extends Card>(input: {
    card: T;
    dataSpace?: CardPolicyScope;
    group?: CardPolicyScope;
    session?: CardPolicyScope;
}): EffectivePolicyCard<T> {
    const producer = input.card;
    let current: EffectivePolicyCard<T> = {
        ...producer,
        policyAvailable: true,
        provenance: {
            availability: "Catalog",
            alwaysEligible: "Catalog",
            repeatableInSession: "Catalog",
            repeatCooldown: "Catalog",
            intensity: "Catalog",
            weight: "Catalog",
            socialSensitivity: "Catalog",
            playerCount: "Catalog",
        },
    };
    current = applyScope(current, producer, input.dataSpace, true);
    current = applyScope(current, producer, input.group, true);
    // Availability and the other properties are independent. Applying Session
    // directives together preserves precedence without rebuilding a second scope.
    return applyScope(current, producer, input.session, true);
}

const sortedRules = new WeakMap<CardPolicyScope, readonly CardPolicyRule[]>();
function sortedScopeRules(scope: CardPolicyScope): readonly CardPolicyRule[] {
    const cached = sortedRules.get(scope);
    if (cached) return cached;
    const rules = [...(scope.conditionalRules ?? [])]
        .filter((rule) => rule.enabled)
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    sortedRules.set(scope, rules);
    return rules;
}

export function isValidPlayerCountRange(range: PlayerCountRange): boolean {
    return (
        Number.isInteger(range.minimum) &&
        range.minimum >= 2 &&
        (range.maximum === null ||
            (Number.isInteger(range.maximum) && range.maximum >= range.minimum))
    );
}

export function cardPolicyScopeFromJson(input: {
    name: string;
    scopeDefault?: CardPolicyDirectives;
    conditionalRules?: readonly CardPolicyRule[];
    exactCards?: readonly { cardId: string; directives: CardPolicyDirectives }[];
}): CardPolicyScope {
    return {
        name: input.name,
        scopeDefault: input.scopeDefault,
        conditionalRules: input.conditionalRules,
        exactCards: new Map(
            input.exactCards?.map((entry) => [entry.cardId, entry.directives]) ?? [],
        ),
    };
}

export function emptySessionCardPolicy() {
    return {
        scopeDefault: {} as CardPolicyDirectives,
        conditionalRules: [] as CardPolicyRule[],
        exactCards: [] as { cardId: string; directives: CardPolicyDirectives }[],
    };
}

export type SessionCardPolicyInput = ReturnType<typeof emptySessionCardPolicy>;

function isAvailabilityOverride(directive: CardPolicyDirectives["availability"]): boolean {
    return directive !== undefined && directive !== "INHERIT";
}
