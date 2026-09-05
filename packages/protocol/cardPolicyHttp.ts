import { z } from "zod";
import { CARD_TYPES, OPERATIONAL_FLAGS, SOCIAL_SENSITIVITIES } from "../game-core";
import {
    cardPolicyDirectivesSchema,
    cardLifecycleSchema,
    cardPolicyPredicateSchema,
    cardPolicyRuleSchema,
    sessionCardPolicySchema,
} from "./cardPolicy";
import { roomGameSettingsSchema } from "./common";

export const cardPolicyRevisionSchema = z.number().int().nonnegative();

export const cardPolicySearchSchema = z
    .object({
        locale: z.string().min(2).max(35),
        query: z.string().max(200).optional(),
        cursor: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(24),
        cardType: z.enum(CARD_TYPES).optional(),
        questionCategoryId: z.string().max(40).optional(),
        dareTypeId: z.string().max(40).optional(),
        socialSensitivity: z.enum(SOCIAL_SENSITIVITIES).optional(),
        operationalFlag: z.enum(OPERATIONAL_FLAGS).optional(),
        yesNoAnswerPossible: z
            .enum(["true", "false"])
            .transform((value) => value === "true")
            .optional(),
        playerCount: z.coerce.number().int().min(2).max(10_000).optional(),
        lifecycle: cardLifecycleSchema.optional(),
    })
    .strict();

export const cardPolicyRuleCreateRequestSchema = z
    .object({
        name: z.string().trim().min(1).max(100),
        enabled: z.boolean(),
        predicate: cardPolicyPredicateSchema,
        directives: cardPolicyDirectivesSchema,
    })
    .strict();

export const cardPolicyRuleUpdateRequestSchema = cardPolicyRuleCreateRequestSchema.extend({
    expectedRevision: cardPolicyRevisionSchema,
});

export const cardPolicyDefaultUpdateRequestSchema = z
    .object({
        directives: cardPolicyDirectivesSchema,
        expectedRevision: cardPolicyRevisionSchema,
    })
    .strict();

export const cardPolicyRuleReorderRequestSchema = z
    .object({ orderedIds: z.array(z.string().uuid()).max(250) })
    .strict();

export const cardPolicyRulePreviewRequestSchema = z
    .object({
        predicate: cardPolicyPredicateSchema,
        locale: z.string().min(2).max(35),
    })
    .strict();

export const cardPolicySessionSearchRequestSchema = z
    .object({
        sessionPolicy: sessionCardPolicySchema,
        search: cardPolicySearchSchema,
    })
    .strict();

export const cardPolicyBulkApplyRequestSchema = z
    .object({
        filters: cardPolicySearchSchema.omit({ cursor: true, limit: true }),
        directives: cardPolicyDirectivesSchema,
        confirmedCount: z.number().int().nonnegative().max(50_000),
    })
    .strict();

export const cardPolicyExactUpdateRequestSchema = cardPolicyDefaultUpdateRequestSchema;

export const pendingEligibilityPreviewRequestSchema = z
    .object({
        settings: roomGameSettingsSchema,
        playerCount: z.number().int().min(2).max(10_000),
    })
    .strict();

export const roomEligibilityPreviewRequestSchema = z
    .object({
        roomCode: z.string().trim().min(4).max(8),
        participantCredential: z.string().min(32).max(200),
    })
    .strict();

export const eligibilityPreviewRequestSchema = z.union([
    pendingEligibilityPreviewRequestSchema,
    roomEligibilityPreviewRequestSchema,
]);

export const policyScopeSchema = z
    .object({
        dataSpaceId: z.string().uuid(),
        groupId: z.string().uuid().nullable(),
        ownerKey: z.string().min(1),
        name: z.enum(["DataSpace", "Group"]),
    })
    .strict();

export const storedDefaultSchema = z
    .object({
        directives: cardPolicyDirectivesSchema,
        revision: cardPolicyRevisionSchema,
    })
    .strict();

export const storedRuleSchema = cardPolicyRuleSchema.extend({
    revision: cardPolicyRevisionSchema,
});

export const managedCardSchema = z
    .object({
        id: z.string().uuid(),
        text: z.string(),
        locale: z.string().min(2).max(35),
        lifecycle: cardLifecycleSchema,
        cardType: z.enum(CARD_TYPES),
        yesNoAnswerPossible: z.boolean(),
        questionCategoryId: z.string().nullable(),
        dareTypeId: z.string().nullable(),
        dareAffinityCategoryId: z.string().nullable(),
        taxonomyLabel: z.string().nullable(),
        operationalFlags: z.array(z.enum(OPERATIONAL_FLAGS)),
        producer: z.record(z.string(), z.unknown()),
        effective: z.record(z.string(), z.unknown()),
        provenance: z.record(z.string(), z.string()),
        localDirectives: cardPolicyDirectivesSchema,
        localRevision: cardPolicyRevisionSchema,
    })
    .strict();

export const rulePreviewCardSchema = z
    .object({
        id: z.string().uuid(),
        text: z.string(),
        cardType: z.enum(CARD_TYPES),
        taxonomyLabel: z.string().nullable(),
    })
    .strict();

export const eligibilityPreviewSchema = z
    .object({
        total: z.number().int().nonnegative(),
        availableAtStart: z.number().int().nonnegative(),
        byType: z.record(z.enum(CARD_TYPES), z.number().int().nonnegative()),
        atStartByType: z.record(z.enum(CARD_TYPES), z.number().int().nonnegative()),
        playerCount: z.number().int().min(2),
    })
    .strict();

export const cardPolicyDefaultResponseSchema = z
    .object({ scopeDefault: storedDefaultSchema })
    .strict();

export const cardPolicyScopedDefaultResponseSchema = z
    .object({ scope: policyScopeSchema, scopeDefault: storedDefaultSchema })
    .strict();

export const cardPolicyRulesResponseSchema = z
    .object({ rules: z.array(storedRuleSchema) })
    .strict();

export const cardPolicyRuleResponseSchema = z.object({ rule: storedRuleSchema }).strict();

export const cardPolicyRulePreviewResponseSchema = z
    .object({
        matchCount: z.number().int().nonnegative(),
        cards: z.array(rulePreviewCardSchema),
        scope: z.enum(["DATASPACE", "GROUP", "SESSION"]),
    })
    .strict();

export const managedCardSearchResponseSchema = z
    .object({
        cards: z.array(managedCardSchema),
        total: z.number().int().nonnegative(),
        nextCursor: z.string().uuid().nullable(),
    })
    .strict();

export const cardPolicyBulkApplyResponseSchema = z
    .object({ appliedCount: z.number().int().nonnegative() })
    .strict();

export const storedExactCardPolicySchema = z
    .object({
        cardId: z.string().uuid(),
        directives: cardPolicyDirectivesSchema,
        revision: cardPolicyRevisionSchema,
    })
    .strict();

export const cardPolicyExactResponseSchema = z
    .object({ policy: storedExactCardPolicySchema })
    .strict();

export type CardPolicySearch = z.infer<typeof cardPolicySearchSchema>;
export type CardPolicySearchInput = z.input<typeof cardPolicySearchSchema>;
export type CardPolicyRuleCreateRequest = z.infer<typeof cardPolicyRuleCreateRequestSchema>;
export type CardPolicyRuleUpdateRequest = z.infer<typeof cardPolicyRuleUpdateRequestSchema>;
export type CardPolicyDefaultUpdateRequest = z.infer<typeof cardPolicyDefaultUpdateRequestSchema>;
export type CardPolicyRuleReorderRequest = z.infer<typeof cardPolicyRuleReorderRequestSchema>;
export type RulePreviewRequest = z.infer<typeof cardPolicyRulePreviewRequestSchema>;
export type SessionPolicySearch = z.infer<typeof cardPolicySessionSearchRequestSchema>;
export type SessionPolicySearchInput = z.input<typeof cardPolicySessionSearchRequestSchema>;
export type CardPolicyBulkApplyRequest = z.infer<typeof cardPolicyBulkApplyRequestSchema>;
export type CardPolicyExactUpdateRequest = z.infer<typeof cardPolicyExactUpdateRequestSchema>;
export type EligibilityPreviewRequest = z.infer<typeof eligibilityPreviewRequestSchema>;
export type PendingEligibilityPreviewRequest = z.infer<
    typeof pendingEligibilityPreviewRequestSchema
>;
export type RoomEligibilityAccess = z.infer<typeof roomEligibilityPreviewRequestSchema>;
export type PolicyScope = z.infer<typeof policyScopeSchema>;
export type StoredDefault = z.infer<typeof storedDefaultSchema>;
export type StoredRule = z.infer<typeof storedRuleSchema>;
export type ManagedCard = z.infer<typeof managedCardSchema>;
export type EligibilityPreview = z.infer<typeof eligibilityPreviewSchema>;
export type CardPolicyDefaultResponse = z.infer<typeof cardPolicyDefaultResponseSchema>;
export type CardPolicyScopedDefaultResponse = z.infer<typeof cardPolicyScopedDefaultResponseSchema>;
export type CardPolicyRulesResponse = z.infer<typeof cardPolicyRulesResponseSchema>;
export type CardPolicyRuleResponse = z.infer<typeof cardPolicyRuleResponseSchema>;
export type CardPolicyRulePreviewResponse = z.infer<typeof cardPolicyRulePreviewResponseSchema>;
export type ManagedCardSearchResponse = z.infer<typeof managedCardSearchResponseSchema>;
export type CardPolicyBulkApplyResponse = z.infer<typeof cardPolicyBulkApplyResponseSchema>;
export type CardPolicyExactResponse = z.infer<typeof cardPolicyExactResponseSchema>;
