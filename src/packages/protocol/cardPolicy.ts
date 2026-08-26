import { z } from "zod";
import {
    AVAILABILITY_DIRECTIVES,
    BOOLEAN_DIRECTIVES,
    CARD_TYPES,
    DARE_TYPES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    SOCIAL_SENSITIVITIES,
} from "../game-core";

const scalarDirective = <T extends z.ZodType>(value: T) =>
    z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("INHERIT") }).strict(),
        z.object({ mode: z.literal("CATALOG") }).strict(),
        z.object({ mode: z.literal("SET"), value }).strict(),
    ]);

export const playerCountRangeSchema = z
    .object({
        minimum: z.number().int().min(2),
        maximum: z.number().int().min(2).nullable(),
    })
    .strict()
    .refine(({ minimum, maximum }) => maximum === null || maximum >= minimum, {
        message: "maximum must be null or at least minimum",
        path: ["maximum"],
    });

export const cardPolicyDirectivesSchema = z
    .object({
        availability: z.enum(AVAILABILITY_DIRECTIVES).optional(),
        alwaysEligible: z.enum(BOOLEAN_DIRECTIVES).optional(),
        repeatableInSession: z.enum(BOOLEAN_DIRECTIVES).optional(),
        repeatCooldown: scalarDirective(z.number().int().nonnegative()).optional(),
        intensity: scalarDirective(
            z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
        ).optional(),
        weight: scalarDirective(z.number().positive()).optional(),
        socialSensitivity: scalarDirective(z.enum(SOCIAL_SENSITIVITIES)).optional(),
        playerCount: scalarDirective(playerCountRangeSchema).optional(),
    })
    .strict();

const uniqueArray = <T extends z.ZodType>(schema: T) =>
    z
        .array(schema)
        .max(100)
        .refine((values) => new Set(values).size === values.length, "Values must be unique");

export const cardPolicyPredicateSchema = z
    .object({
        cardTypes: uniqueArray(z.enum(CARD_TYPES)).optional(),
        questionCategoryIds: uniqueArray(z.enum(QUESTION_CATEGORIES)).optional(),
        dareTypeIds: uniqueArray(z.enum(DARE_TYPES)).optional(),
        dareAffinityCategoryIds: uniqueArray(z.enum(QUESTION_CATEGORIES)).optional(),
        yesNoAnswerPossible: z.boolean().optional(),
        socialSensitivities: uniqueArray(z.enum(SOCIAL_SENSITIVITIES)).optional(),
        operationalFlagsAll: uniqueArray(z.enum(OPERATIONAL_FLAGS)).optional(),
        operationalFlagsAny: uniqueArray(z.enum(OPERATIONAL_FLAGS)).optional(),
        operationalFlagsNone: uniqueArray(z.enum(OPERATIONAL_FLAGS)).optional(),
        minimumIntensity: z.number().int().min(1).max(5).optional(),
        maximumIntensity: z.number().int().min(1).max(5).optional(),
        alwaysEligible: z.boolean().optional(),
        repeatableInSession: z.boolean().optional(),
        minimumRepeatCooldown: z.number().int().nonnegative().optional(),
        maximumRepeatCooldown: z.number().int().nonnegative().optional(),
        minimumWeight: z.number().positive().optional(),
        maximumWeight: z.number().positive().optional(),
        minimumPlayerCountAtLeast: z.number().int().min(2).optional(),
        maximumPlayerCountAtMost: z.number().int().min(2).optional(),
        lifecycle: z.enum(["ACTIVE", "RETIRED"]).optional(),
    })
    .strict()
    .superRefine((predicate, context) => {
        for (const [minimumProperty, maximumProperty] of [
            ["minimumIntensity", "maximumIntensity"],
            ["minimumRepeatCooldown", "maximumRepeatCooldown"],
            ["minimumWeight", "maximumWeight"],
        ] as const) {
            const minimum = predicate[minimumProperty];
            const maximum = predicate[maximumProperty];
            if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
                context.addIssue({
                    code: "custom",
                    message: `${minimumProperty} cannot exceed ${maximumProperty}`,
                    path: [maximumProperty],
                });
            }
        }
    });

export const cardPolicyRuleSchema = z
    .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
        order: z.number().int().nonnegative(),
        enabled: z.boolean(),
        predicate: cardPolicyPredicateSchema,
        directives: cardPolicyDirectivesSchema,
    })
    .strict();

export const portableCardPolicyScopeSchema = z
    .object({
        format: z.literal("party-game-card-policy/v2"),
        scopeDefault: cardPolicyDirectivesSchema,
        rules: z
            .array(
                z
                    .object({
                        name: z.string().trim().min(1).max(100),
                        enabled: z.boolean(),
                        predicate: cardPolicyPredicateSchema,
                        directives: cardPolicyDirectivesSchema,
                    })
                    .strict(),
            )
            .max(250),
        exactCards: z
            .array(
                z
                    .object({ cardId: z.string().uuid(), directives: cardPolicyDirectivesSchema })
                    .strict(),
            )
            .max(50_000)
            .refine(
                (entries) => new Set(entries.map(({ cardId }) => cardId)).size === entries.length,
                "Exact Card IDs must be unique",
            ),
    })
    .strict();

export const sessionCardPolicySchema = z
    .object({
        scopeDefault: cardPolicyDirectivesSchema.default({}),
        conditionalRules: z.array(cardPolicyRuleSchema).max(250).default([]),
        exactCards: z
            .array(
                z
                    .object({ cardId: z.string().uuid(), directives: cardPolicyDirectivesSchema })
                    .strict(),
            )
            .max(1000)
            .refine(
                (entries) => new Set(entries.map(({ cardId }) => cardId)).size === entries.length,
                "Exact Card IDs must be unique",
            )
            .default([]),
    })
    .strict()
    .default({ scopeDefault: {}, conditionalRules: [], exactCards: [] });

export type CardPolicyDirectivesPayload = z.infer<typeof cardPolicyDirectivesSchema>;
export type CardPolicyPredicatePayload = z.infer<typeof cardPolicyPredicateSchema>;
export type SessionCardPolicyPayload = z.infer<typeof sessionCardPolicySchema>;
