import { ApiError, fetchJsonResponse, httpErrorDetails } from "./http";
import { messages } from "./i18n";
import {
    cardPolicySummaryResponseSchema,
    decodeCardPolicyBulkApplyResponse,
    decodeCardPolicyDefaultResponse,
    decodeCardPolicyExactResponse,
    decodeCardPolicyRulePreviewResponse,
    decodeCardPolicyRuleResponse,
    decodeCardPolicyRulesResponse,
    decodeCardPolicyScopedDefaultResponse,
    decodeEligibilityPreview,
    decodeManagedCardSearchResponse,
} from "../../../packages/protocol/browser";
import type {
    CardPolicyDirectives,
    CardPolicyRuleCreateRequest,
    CardPolicyRulePreviewResponse,
    CardPolicyRuleUpdateRequest,
    EligibilityPreview,
    PortableCardPolicy,
    RulePreviewRequest,
    RoomEligibilityAccess,
    RoomGameSettings,
    SessionCardPolicy,
    SessionPolicySearchInput,
    StoredRule,
} from "../../../packages/protocol";

async function json<T>(
    path: string,
    init: RequestInit = {},
    decode?: (body: unknown) => T,
): Promise<T> {
    const { response, body } = await fetchJsonResponse(path, init);
    if (!response.ok) {
        const error = httpErrorDetails(body);
        throw new ApiError(
            error.code ?? "UNKNOWN_ERROR",
            error.message ?? messages.common.requestFailed,
            response.status,
        );
    }
    return decode ? decode(body) : (body as T);
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
            decodeEligibilityPreview,
        ),
    roomEligibilityPreview: (access: RoomEligibilityAccess) =>
        json<EligibilityPreview>(
            "/api/v1/card-policy/session/eligibility-preview",
            {
                method: "POST",
                body: JSON.stringify(access),
            },
            decodeEligibilityPreview,
        ),
    exportHref: (groupId: string | null) => `/api/v1/card-policy/export${scopeQuery(groupId)}`,
    importScope: (
        groupId: string | null,
        input: PortableCardPolicy,
        expectedScopeRevision: number,
    ) =>
        json<void>(`/api/v1/card-policy/import${scopeQuery(groupId)}`, {
            method: "POST",
            body: JSON.stringify({ policy: input, expectedScopeRevision }),
        }),
    loadScope: (groupId: string | null) =>
        json(`/api/v1/card-policy/scope${scopeQuery(groupId)}`, {}, (body) =>
            cardPolicySummaryResponseSchema.parse(body),
        ),
    loadDefault: (groupId: string | null) =>
        json(
            `/api/v1/card-policy/default${scopeQuery(groupId)}`,
            {},
            decodeCardPolicyScopedDefaultResponse,
        ),
    saveDefault: (
        groupId: string | null,
        directives: CardPolicyDirectives,
        expectedRevision: number,
    ) =>
        json(
            `/api/v1/card-policy/default${scopeQuery(groupId)}`,
            {
                method: "PUT",
                body: JSON.stringify({ directives, expectedRevision }),
            },
            decodeCardPolicyDefaultResponse,
        ),
    loadRules: (groupId: string | null) =>
        json(`/api/v1/card-policy/rules${scopeQuery(groupId)}`, {}, decodeCardPolicyRulesResponse),
    createRule: (groupId: string | null, input: CardPolicyRuleCreateRequest) =>
        json(
            `/api/v1/card-policy/rules${scopeQuery(groupId)}`,
            {
                method: "POST",
                body: JSON.stringify(input),
            },
            decodeCardPolicyRuleResponse,
        ),
    updateRule: (groupId: string | null, rule: StoredRule) => {
        const input: CardPolicyRuleUpdateRequest = {
            name: rule.name,
            enabled: rule.enabled,
            predicate: rule.predicate,
            directives: rule.directives,
            expectedRevision: rule.revision,
        };
        return json(
            `/api/v1/card-policy/rules/${rule.id}${scopeQuery(groupId)}`,
            {
                method: "PUT",
                body: JSON.stringify(input),
            },
            decodeCardPolicyRuleResponse,
        );
    },
    deleteRule: (groupId: string | null, rule: StoredRule) =>
        json<void>(
            `/api/v1/card-policy/rules/${rule.id}${scopeQuery(groupId, {
                expectedRevision: String(rule.revision),
            })}`,
            { method: "DELETE" },
        ),
    reorderRules: (groupId: string | null, orderedIds: string[], expectedScopeRevision: number) =>
        json(
            `/api/v1/card-policy/rules/reorder${scopeQuery(groupId)}`,
            {
                method: "POST",
                body: JSON.stringify({ orderedIds, expectedScopeRevision }),
            },
            decodeCardPolicyRulesResponse,
        ),
    preview: (
        groupId: string | null,
        predicate: RulePreviewRequest["predicate"],
        locale: string,
    ) => {
        const input: RulePreviewRequest = { predicate, locale };
        return json<CardPolicyRulePreviewResponse>(
            `/api/v1/card-policy/rules/preview${scopeQuery(groupId)}`,
            { method: "POST", body: JSON.stringify(input) },
            decodeCardPolicyRulePreviewResponse,
        );
    },
    previewSession: (predicate: RulePreviewRequest["predicate"], locale: string) => {
        const input: RulePreviewRequest = { predicate, locale };
        return json<CardPolicyRulePreviewResponse>(
            "/api/v1/card-policy/session/rules/preview",
            { method: "POST", body: JSON.stringify(input) },
            decodeCardPolicyRulePreviewResponse,
        );
    },
    search: (groupId: string | null, input: Record<string, string>) =>
        json(
            `/api/v1/card-policy/cards${scopeQuery(groupId, input)}`,
            {},
            decodeManagedCardSearchResponse,
        ),
    bulkApply: (
        groupId: string | null,
        filters: Record<string, string>,
        directives: CardPolicyDirectives,
        confirmedCount: number,
        expectedScopeRevision: number,
    ) => {
        const { limit: _limit, cursor: _cursor, ...boundedFilters } = filters;
        return json(
            `/api/v1/card-policy/cards/bulk${scopeQuery(groupId)}`,
            {
                method: "POST",
                body: JSON.stringify({
                    filters: boundedFilters,
                    directives,
                    confirmedCount,
                    expectedScopeRevision,
                }),
            },
            decodeCardPolicyBulkApplyResponse,
        );
    },
    searchSession: (
        groupId: string | null,
        sessionPolicy: SessionCardPolicy,
        input: Record<string, string>,
    ) => {
        const request = { sessionPolicy, search: input } as SessionPolicySearchInput;
        return json(
            `/api/v1/card-policy/session/cards${scopeQuery(groupId)}`,
            {
                method: "POST",
                body: JSON.stringify(request),
            },
            decodeManagedCardSearchResponse,
        );
    },
    saveCard: (
        groupId: string | null,
        cardId: string,
        directives: CardPolicyDirectives,
        expectedRevision: number,
    ) =>
        json(
            `/api/v1/card-policy/cards/${cardId}${scopeQuery(groupId)}`,
            { method: "PUT", body: JSON.stringify({ directives, expectedRevision }) },
            decodeCardPolicyExactResponse,
        ),
    deleteCard: (groupId: string | null, cardId: string, expectedRevision: number) =>
        json<void>(
            `/api/v1/card-policy/cards/${cardId}${scopeQuery(groupId, {
                expectedRevision: String(expectedRevision),
            })}`,
            { method: "DELETE" },
        ),
};
