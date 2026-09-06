import type {
    CardPolicyDirectives,
    CardPolicyPredicate,
    CardPolicyRule,
    CardPolicyScope,
    PlayableCard,
    Card,
} from "../game-core";

export type CardPolicyOwner = {
    dataSpaceId: string;
    groupId: string | null;
    ownerKey: string;
    name: "DataSpace" | "Group";
};

export type StoredPolicyDefault = { directives: CardPolicyDirectives; revision: number };
export type StoredPolicyRule = CardPolicyRule & { revision: number };
export type StoredExactCardPolicy = {
    cardId: string;
    directives: CardPolicyDirectives;
    revision: number;
};
export type StoredCardPolicyScope = {
    owner: CardPolicyOwner;
    revision: number;
    scopeDefault: StoredPolicyDefault;
    rules: readonly StoredPolicyRule[];
    exactCards: readonly StoredExactCardPolicy[];
};

export type PortableCardPolicyScope = {
    scopeDefault: CardPolicyDirectives;
    rules: readonly {
        name: string;
        enabled: boolean;
        predicate: CardPolicyPredicate;
        directives: CardPolicyDirectives;
    }[];
    exactCards: readonly { cardId: string; directives: CardPolicyDirectives }[];
};

export type ManagedCardSearch = {
    locale: string;
    query?: string;
    cursor?: string;
    limit: number;
    cardType?: PlayableCard["cardType"];
    questionCategoryId?: string;
    dareTypeId?: string;
    socialSensitivity?: PlayableCard["socialSensitivity"];
    operationalFlag?: PlayableCard["operationalFlags"][number];
    yesNoAnswerPossible?: boolean;
    playerCount?: number;
    lifecycle?: "ACTIVE" | "RETIRED";
};

export type ManagedCatalogCard = PlayableCard & {
    lifecycle: "ACTIVE" | "RETIRED";
    taxonomyLabel: string | null;
};

export interface CardPolicyRepository {
    load(owner: CardPolicyOwner): Promise<StoredCardPolicyScope>;
    loadScopes(owners: readonly CardPolicyOwner[]): Promise<StoredCardPolicyScope[]>;
    summary(owner: CardPolicyOwner): Promise<Omit<StoredCardPolicyScope, "exactCards">>;
    putDefault(
        owner: CardPolicyOwner,
        directives: CardPolicyDirectives,
        expectedRevision: number,
    ): Promise<StoredPolicyDefault>;
    createRule(
        owner: CardPolicyOwner,
        input: {
            name: string;
            enabled: boolean;
            predicate: CardPolicyPredicate;
            directives: CardPolicyDirectives;
        },
    ): Promise<StoredPolicyRule>;
    updateRule(
        owner: CardPolicyOwner,
        id: string,
        input: {
            name: string;
            enabled: boolean;
            predicate: CardPolicyPredicate;
            directives: CardPolicyDirectives;
        },
        expectedRevision: number,
    ): Promise<StoredPolicyRule | null>;
    deleteRule(owner: CardPolicyOwner, id: string, expectedRevision: number): Promise<boolean>;
    reorderRules(
        owner: CardPolicyOwner,
        ids: readonly string[],
        expectedScopeRevision: number,
    ): Promise<readonly StoredPolicyRule[]>;
    putExactCard(
        owner: CardPolicyOwner,
        cardId: string,
        directives: CardPolicyDirectives,
        expectedRevision: number,
    ): Promise<StoredExactCardPolicy | null>;
    deleteExactCard(
        owner: CardPolicyOwner,
        cardId: string,
        expectedRevision: number,
    ): Promise<boolean>;
    replaceScope(
        owner: CardPolicyOwner,
        input: PortableCardPolicyScope,
        expectedScopeRevision: number,
    ): Promise<void>;
    listMatchingCardIds(search: Omit<ManagedCardSearch, "cursor" | "limit">): Promise<string[]>;
    putExactCards(
        owner: CardPolicyOwner,
        cardIds: readonly string[],
        directives: CardPolicyDirectives,
        expectedScopeRevision: number,
    ): Promise<number>;
    searchCards(search: ManagedCardSearch): Promise<{
        cards: readonly ManagedCatalogCard[];
        total: number;
        nextCursor: string | null;
    }>;
    scanPolicyCards(locale: string): AsyncIterable<Card>;
    policyPreviewSamples(
        ids: readonly string[],
        locale: string,
    ): Promise<readonly ManagedCatalogCard[]>;
    catalogProvenance(): Promise<{
        catalogId: string;
        sequence: number;
        catalogVersion: string;
        contract: string;
        artifactDigest: string;
    }>;
}

export function toDomainPolicyScope(stored: StoredCardPolicyScope): CardPolicyScope {
    return {
        name: stored.owner.name,
        scopeDefault: stored.scopeDefault.directives,
        conditionalRules: stored.rules,
        exactCards: new Map(stored.exactCards.map((entry) => [entry.cardId, entry.directives])),
    };
}
