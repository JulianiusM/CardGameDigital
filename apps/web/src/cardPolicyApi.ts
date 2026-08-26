import { fetchJsonResponse } from "./http";
import { messages } from "./i18n";
import type {
    CardPolicyDirectives,
    CardPolicyPredicate,
    CardPolicyRule,
    RoomGameSettings,
} from "./multiplayer";

export type EligibilityPreview = {
    total: number;
    availableAtStart: number;
    byType: Record<"QUESTION" | "DARE" | "CONVERSATION_META", number>;
    atStartByType: Record<"QUESTION" | "DARE" | "CONVERSATION_META", number>;
    playerCount: number;
};
export type RoomEligibilityAccess = {
    roomCode: string;
    participantCredential: string;
};

export type PolicyScope = {
    dataSpaceId: string;
    groupId: string | null;
    ownerKey: string;
    name: "DataSpace" | "Group";
};
export type StoredDefault = { directives: CardPolicyDirectives; revision: number };
export type StoredRule = CardPolicyRule & { revision: number };
export type ManagedCard = {
    id: string;
    text: string;
    locale: string;
    lifecycle: "ACTIVE" | "RETIRED";
    cardType: string;
    yesNoAnswerPossible: boolean;
    questionCategoryId: string | null;
    dareTypeId: string | null;
    dareAffinityCategoryId: string | null;
    taxonomyLabel: string | null;
    operationalFlags: string[];
    producer: Record<string, unknown>;
    effective: Record<string, unknown>;
    provenance: Record<string, string>;
    localDirectives: CardPolicyDirectives;
    localRevision: number;
};
export type PortableCardPolicy = {
    format: "party-game-card-policy/v2";
    scopeDefault: CardPolicyDirectives;
    rules: Pick<StoredRule, "name" | "enabled" | "predicate" | "directives">[];
    exactCards: { cardId: string; directives: CardPolicyDirectives }[];
};

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { response, body } = await fetchJsonResponse(path, init);
    if (!response.ok) {
        const error = body as { error?: { message?: string } };
        throw new Error(error.error?.message ?? messages.common.requestFailed);
    }
    return body as T;
}

function scopeQuery(groupId: string | null, extra: Record<string, string> = {}): string {
    const query = new URLSearchParams(extra);
    if (groupId) query.set("groupId", groupId);
    const encoded = query.toString();
    return encoded ? `?${encoded}` : "";
}

function projectRoomGameSettings(settings: RoomGameSettings): RoomGameSettings {
    return {
        mode: settings.mode,
        profileId: settings.profileId,
        groupId: settings.groupId,
        adultContentConfirmed: settings.adultContentConfirmed,
        cardLocale: settings.cardLocale,
        cardFallbackEnabled: settings.cardFallbackEnabled,
        cardFallbackLocales: settings.cardFallbackLocales,
        neverHaveIEverRevealMode: settings.neverHaveIEverRevealMode,
        configuration: settings.configuration,
        cardPolicy: settings.cardPolicy,
    };
}

export const cardPolicyApi = {
    eligibilityPreview: (settings: RoomGameSettings, playerCount: number) =>
        json<EligibilityPreview>(
            `/api/v1/card-policy/session/eligibility-preview${scopeQuery(settings.groupId)}`,
            {
                method: "POST",
                body: JSON.stringify({
                    settings: projectRoomGameSettings(settings),
                    playerCount,
                }),
            },
        ),
    roomEligibilityPreview: (access: RoomEligibilityAccess) =>
        json<EligibilityPreview>("/api/v1/card-policy/session/eligibility-preview", {
            method: "POST",
            body: JSON.stringify(access),
        }),
    exportHref: (groupId: string | null) => `/api/v1/card-policy/export${scopeQuery(groupId)}`,
    importScope: (groupId: string | null, input: PortableCardPolicy) =>
        json<{ scope: unknown }>(`/api/v1/card-policy/import${scopeQuery(groupId)}`, {
            method: "POST",
            body: JSON.stringify(input),
        }),
    loadDefault: (groupId: string | null) =>
        json<{ scope: PolicyScope; scopeDefault: StoredDefault }>(
            `/api/v1/card-policy/default${scopeQuery(groupId)}`,
        ),
    saveDefault: (
        groupId: string | null,
        directives: CardPolicyDirectives,
        expectedRevision: number,
    ) =>
        json<{ scopeDefault: StoredDefault }>(`/api/v1/card-policy/default${scopeQuery(groupId)}`, {
            method: "PUT",
            body: JSON.stringify({ directives, expectedRevision }),
        }),
    loadRules: (groupId: string | null) =>
        json<{ rules: StoredRule[] }>(`/api/v1/card-policy/rules${scopeQuery(groupId)}`),
    createRule: (
        groupId: string | null,
        input: Pick<StoredRule, "name" | "enabled" | "predicate" | "directives">,
    ) =>
        json<{ rule: StoredRule }>(`/api/v1/card-policy/rules${scopeQuery(groupId)}`, {
            method: "POST",
            body: JSON.stringify(input),
        }),
    updateRule: (groupId: string | null, rule: StoredRule) =>
        json<{ rule: StoredRule }>(`/api/v1/card-policy/rules/${rule.id}${scopeQuery(groupId)}`, {
            method: "PUT",
            body: JSON.stringify({
                name: rule.name,
                enabled: rule.enabled,
                predicate: rule.predicate,
                directives: rule.directives,
                expectedRevision: rule.revision,
            }),
        }),
    deleteRule: (groupId: string | null, rule: StoredRule) =>
        json<void>(
            `/api/v1/card-policy/rules/${rule.id}${scopeQuery(groupId, {
                expectedRevision: String(rule.revision),
            })}`,
            { method: "DELETE" },
        ),
    reorderRules: (groupId: string | null, orderedIds: string[]) =>
        json<{ rules: StoredRule[] }>(`/api/v1/card-policy/rules/reorder${scopeQuery(groupId)}`, {
            method: "POST",
            body: JSON.stringify({ orderedIds }),
        }),
    preview: (groupId: string | null, predicate: CardPolicyPredicate, locale: string) =>
        json<{ matchCount: number; cards: { id: string; text: string }[] }>(
            `/api/v1/card-policy/rules/preview${scopeQuery(groupId)}`,
            { method: "POST", body: JSON.stringify({ predicate, locale }) },
        ),
    previewSession: (predicate: CardPolicyPredicate, locale: string) =>
        json<{ matchCount: number; cards: { id: string; text: string }[] }>(
            "/api/v1/card-policy/session/rules/preview",
            { method: "POST", body: JSON.stringify({ predicate, locale }) },
        ),
    search: (groupId: string | null, input: Record<string, string>) =>
        json<{ cards: ManagedCard[]; total: number; nextCursor: string | null }>(
            `/api/v1/card-policy/cards${scopeQuery(groupId, input)}`,
        ),
    bulkApply: (
        groupId: string | null,
        filters: Record<string, string>,
        directives: CardPolicyDirectives,
        confirmedCount: number,
    ) => {
        const { limit: _limit, cursor: _cursor, ...boundedFilters } = filters;
        return json<{ appliedCount: number }>(
            `/api/v1/card-policy/cards/bulk${scopeQuery(groupId)}`,
            {
                method: "POST",
                body: JSON.stringify({ filters: boundedFilters, directives, confirmedCount }),
            },
        );
    },
    searchSession: (
        groupId: string | null,
        sessionPolicy: import("./multiplayer").SessionCardPolicy,
        input: Record<string, string>,
    ) =>
        json<{ cards: ManagedCard[]; total: number; nextCursor: string | null }>(
            `/api/v1/card-policy/session/cards${scopeQuery(groupId)}`,
            {
                method: "POST",
                body: JSON.stringify({ sessionPolicy, search: input }),
            },
        ),
    saveCard: (
        groupId: string | null,
        cardId: string,
        directives: CardPolicyDirectives,
        expectedRevision: number,
    ) =>
        json<{ policy: { cardId: string; directives: CardPolicyDirectives; revision: number } }>(
            `/api/v1/card-policy/cards/${cardId}${scopeQuery(groupId)}`,
            { method: "PUT", body: JSON.stringify({ directives, expectedRevision }) },
        ),
    deleteCard: (groupId: string | null, cardId: string, expectedRevision: number) =>
        json<void>(
            `/api/v1/card-policy/cards/${cardId}${scopeQuery(groupId, {
                expectedRevision: String(expectedRevision),
            })}`,
            { method: "DELETE" },
        ),
};
