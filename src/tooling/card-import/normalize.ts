import crypto from "node:crypto";
import { z } from "zod";
import type {
    CardType,
    DareTypeId,
    OperationalFlag,
    QuestionCategoryId,
} from "../../packages/game-core";
import {
    CARD_TYPES,
    DARE_TYPE_LABELS,
    DARE_TYPES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    QUESTION_CATEGORY_LABELS,
} from "../../packages/game-core";

const rawCardSchema = z
    .object({
        ID: z.union([z.string(), z.number()]).transform(String),
        CardText: z.string().trim().min(1),
        Type: z.string().trim().min(1),
        Origin: z.string().trim().min(1),
        OriginCategory: z.string().trim().nullable().optional(),
        YesNoAnswerPossible: z.boolean().default(false),
        Category: z.string().trim().nullable().optional(),
        DareType: z.string().trim().nullable().optional(),
        Intensity: z.number().int().min(1).max(5).default(1),
        AlwaysEligible: z.boolean().default(false),
        RepeatableInSession: z.boolean().default(false),
        RepeatCooldown: z.number().int().nonnegative().default(0),
        Weight: z.number().positive().default(1),
        Active: z.boolean().default(true),
        OperationalFlags: z.array(z.string()).default([]),
        SourceRevision: z.number().int().positive().default(1),
    })
    .strict();

export type RawCard = z.input<typeof rawCardSchema>;
export type ImportIssue = {
    severity: "ERROR" | "WARNING";
    code: string;
    sourceIdentifier: string;
    field?: string;
    message: string;
};
export type RejectedRawCard = {
    sourceIdentifier: string;
    raw: unknown;
    issues: readonly ImportIssue[];
};
export type CardCatalog = {
    schemaVersion: 2;
    catalogVersion: string;
    generatedAt: string;
    sourceName: string;
    sourceLocale: string;
    sourceDigest: string;
    rawCards: readonly unknown[];
    cards: readonly NormalizedCard[];
    rejectedRawCards: readonly RejectedRawCard[];
    issues: readonly ImportIssue[];
};
export type NormalizedCard = {
    sourceId: string;
    origin: string;
    originCategory: string | null;
    sourceTranslation: {
        locale: string;
        text: string;
        revision: number;
        contentHash: string;
        status: "PUBLISHED";
    };
    cardType: CardType;
    yesNoAnswerPossible: boolean;
    questionCategoryId: QuestionCategoryId | null;
    dareTypeId: DareTypeId | null;
    dareAffinityCategoryId: QuestionCategoryId | null;
    intensity: 1 | 2 | 3 | 4 | 5;
    alwaysEligible: boolean;
    repeatableInSession: boolean;
    repeatCooldown: number;
    weight: number;
    active: boolean;
    operationalFlags: readonly OperationalFlag[];
};

const questionCategoryByInput = new Map<string, QuestionCategoryId>();
for (const id of Object.values(QUESTION_CATEGORIES)) questionCategoryByInput.set(id, id);
for (const [id, label] of Object.entries(QUESTION_CATEGORY_LABELS))
    questionCategoryByInput.set(label, id as QuestionCategoryId);
const dareTypeByInput = new Map<string, DareTypeId>();
for (const id of Object.values(DARE_TYPES)) dareTypeByInput.set(id, id);
for (const [id, label] of Object.entries(DARE_TYPE_LABELS))
    dareTypeByInput.set(label, id as DareTypeId);
const operationalFlags = new Set<string>(Object.values(OPERATIONAL_FLAGS));

const cardTypesByInput: Readonly<Record<string, CardType>> = {
    Fragen: CARD_TYPES.QUESTION,
    Pflicht: CARD_TYPES.DARE,
    Gespräch: CARD_TYPES.CONVERSATION,
};

function issue(
    sourceIdentifier: string,
    severity: ImportIssue["severity"],
    code: string,
    message: string,
    field?: string,
): ImportIssue {
    return { severity, code, sourceIdentifier, field, message };
}

export function normalizeCards(
    input: readonly unknown[],
    sourceName: string,
    catalogVersion: string,
    generatedAt = new Date(),
    sourceLocale = "de-DE",
): CardCatalog {
    const cards: NormalizedCard[] = [];
    const issues: ImportIssue[] = [];
    const rejectedRawCards: RejectedRawCard[] = [];

    input.forEach((unknownCard, index) => {
        const fallbackId = `row-${index + 1}`;
        const parsed = rawCardSchema.safeParse(unknownCard);
        if (!parsed.success) {
            const recordIssues = parsed.error.issues.map((zodIssue) =>
                issue(
                    typeof (unknownCard as { ID?: unknown })?.ID === "string" ||
                        typeof (unknownCard as { ID?: unknown })?.ID === "number"
                        ? String((unknownCard as { ID: unknown }).ID)
                        : fallbackId,
                    "ERROR",
                    "RAW_CARD_INVALID",
                    zodIssue.message,
                    zodIssue.path.join("."),
                ),
            );
            issues.push(...recordIssues);
            rejectedRawCards.push({
                sourceIdentifier: recordIssues[0].sourceIdentifier,
                raw: unknownCard,
                issues: recordIssues,
            });
            return;
        }

        const raw = parsed.data;
        const recordIssues: ImportIssue[] = [];
        const type = cardTypesByInput[raw.Type];
        if (!type)
            recordIssues.push(
                issue(
                    raw.ID,
                    "ERROR",
                    "UNKNOWN_CARD_TYPE",
                    `Unknown card type '${raw.Type}'`,
                    "Type",
                ),
            );
        const category = raw.Category ? questionCategoryByInput.get(raw.Category) : undefined;
        const dare = raw.DareType ? dareTypeByInput.get(raw.DareType) : undefined;
        if (raw.Category && !category)
            recordIssues.push(
                issue(
                    raw.ID,
                    "ERROR",
                    "UNKNOWN_QUESTION_CATEGORY",
                    `Unknown category '${raw.Category}'`,
                    "Category",
                ),
            );
        if (raw.DareType && !dare)
            recordIssues.push(
                issue(
                    raw.ID,
                    "ERROR",
                    "UNKNOWN_DARE_TYPE",
                    `Unknown DareType '${raw.DareType}'`,
                    "DareType",
                ),
            );
        const flags = raw.OperationalFlags.filter((flag) => {
            if (operationalFlags.has(flag)) return true;
            recordIssues.push(
                issue(
                    raw.ID,
                    "ERROR",
                    "UNKNOWN_OPERATIONAL_FLAG",
                    `Unknown operational flag '${flag}'`,
                    "OperationalFlags",
                ),
            );
            return false;
        }) as OperationalFlag[];

        if (type === CARD_TYPES.QUESTION && !category)
            recordIssues.push(
                issue(
                    raw.ID,
                    "ERROR",
                    "QUESTION_CATEGORY_REQUIRED",
                    "Questions require a QuestionCategory",
                    "Category",
                ),
            );
        if (type === CARD_TYPES.QUESTION && raw.DareType)
            recordIssues.push(
                issue(
                    raw.ID,
                    "ERROR",
                    "QUESTION_HAS_DARE_TYPE",
                    "Questions cannot have a DareType",
                    "DareType",
                ),
            );
        if (type === CARD_TYPES.DARE && !dare)
            recordIssues.push(
                issue(
                    raw.ID,
                    "ERROR",
                    "DARE_TYPE_REQUIRED",
                    "Dares require a DareType",
                    "DareType",
                ),
            );
        if (type === CARD_TYPES.DARE && !category)
            recordIssues.push(
                issue(
                    raw.ID,
                    "WARNING",
                    "DARE_AFFINITY_MISSING",
                    "DareAffinityCategory is recommended",
                    "Category",
                ),
            );
        if (type === CARD_TYPES.CONVERSATION && raw.DareType)
            recordIssues.push(
                issue(
                    raw.ID,
                    "ERROR",
                    "CONVERSATION_HAS_DARE_TYPE",
                    "Conversation meta cards cannot have a DareType",
                    "DareType",
                ),
            );
        if (!raw.RepeatableInSession && raw.RepeatCooldown > 0)
            recordIssues.push(
                issue(
                    raw.ID,
                    "WARNING",
                    "UNUSED_REPEAT_COOLDOWN",
                    "Cooldown has no effect when RepeatableInSession is false",
                    "RepeatCooldown",
                ),
            );

        issues.push(...recordIssues);
        if (recordIssues.some((entry) => entry.severity === "ERROR") || !type) {
            rejectedRawCards.push({
                sourceIdentifier: raw.ID,
                raw: unknownCard,
                issues: recordIssues,
            });
            return;
        }
        cards.push({
            sourceId: raw.ID,
            origin: raw.Origin,
            originCategory: raw.OriginCategory ?? null,
            sourceTranslation: {
                locale: sourceLocale,
                text: raw.CardText,
                revision: raw.SourceRevision,
                contentHash: crypto.createHash("sha256").update(raw.CardText).digest("hex"),
                status: "PUBLISHED",
            },
            cardType: type,
            yesNoAnswerPossible: raw.YesNoAnswerPossible,
            questionCategoryId:
                type === CARD_TYPES.QUESTION || type === CARD_TYPES.CONVERSATION
                    ? (category ?? null)
                    : null,
            dareTypeId: type === CARD_TYPES.DARE ? (dare ?? null) : null,
            dareAffinityCategoryId: type === CARD_TYPES.DARE ? (category ?? null) : null,
            intensity: raw.Intensity as NormalizedCard["intensity"],
            alwaysEligible: raw.AlwaysEligible,
            repeatableInSession: raw.RepeatableInSession,
            repeatCooldown: raw.RepeatCooldown,
            weight: raw.Weight,
            active: raw.Active,
            operationalFlags: [...new Set(flags)].sort(),
        });
    });

    cards.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    const sourceDigest = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return {
        schemaVersion: 2,
        catalogVersion,
        generatedAt: generatedAt.toISOString(),
        sourceName,
        sourceLocale,
        sourceDigest,
        rawCards: input,
        cards,
        rejectedRawCards,
        issues,
    };
}
