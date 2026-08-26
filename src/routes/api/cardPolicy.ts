import express, { type Request } from "express";
import { z } from "zod";
import { AppDataSource } from "../../modules/database/dataSource";
import { GroupEntity } from "../../modules/database/entities/game/GroupEntity";
import { CardEntity } from "../../modules/database/entities/card/CardEntity";
import { asyncHandler } from "../../modules/lib/asyncHandler";
import { ExpectedError } from "../../modules/lib/errors";
import settings from "../../modules/settings";
import { getRoomService } from "../../modules/realtime";
import type { CardPolicyOwner } from "../../packages/application/cardPolicyRepository";
import { CardPolicyService } from "../../packages/application/cardPolicyService";
import { roomSettingsGameProfile } from "../../packages/application/roomGameSettings";
import { OPERATIONAL_FLAGS, type DataSpaceId } from "../../packages/game-core";
import { MESSAGE_KEYS } from "../../packages/localization/keys";
import {
    TypeOrmCardPolicyRepository,
    TypeOrmCardRepository,
    TypeOrmCouchSessionRepository,
} from "../../packages/persistence";
import { roomGameSettingsSchema } from "../../packages/protocol";
import {
    cardPolicyDirectivesSchema,
    cardPolicyPredicateSchema,
    portableCardPolicyScopeSchema,
    sessionCardPolicySchema,
} from "../../packages/protocol/cardPolicy";
import { requireCurrentDataSpace } from "./dataSpaceAccess";

const router = express.Router();
const repository = new TypeOrmCardPolicyRepository(AppDataSource);
const service = new CardPolicyService(repository);
const cards = new TypeOrmCardRepository(AppDataSource.getRepository(CardEntity));
const sessions = new TypeOrmCouchSessionRepository(AppDataSource);
const groupQuerySchema = z.object({ groupId: z.string().uuid().optional() }).passthrough();
const revisionSchema = z.number().int().nonnegative();
const revisionQuerySchema = z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .transform(Number);
const uuidSchema = z.string().uuid();
const cardSearchSchema = z
    .object({
        locale: z.string().min(2).max(35),
        query: z.string().max(200).optional(),
        cursor: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(24),
        cardType: z.enum(["QUESTION", "DARE", "CONVERSATION_META"]).optional(),
        questionCategoryId: z.string().max(40).optional(),
        dareTypeId: z.string().max(40).optional(),
        socialSensitivity: z
            .enum([
                "GENERAL",
                "PERSONAL",
                "CLOSE_PERSONAL",
                "DEEP_PERSONAL",
                "INTIMATE",
                "EXPLICIT",
            ])
            .optional(),
        operationalFlag: z.enum(OPERATIONAL_FLAGS).optional(),
        yesNoAnswerPossible: z
            .enum(["true", "false"])
            .transform((value) => value === "true")
            .optional(),
        playerCount: z.coerce.number().int().min(2).max(10_000).optional(),
        lifecycle: z.enum(["ACTIVE", "RETIRED"]).optional(),
    })
    .strict();
const ruleInputSchema = z
    .object({
        name: z.string().trim().min(1).max(100),
        enabled: z.boolean(),
        predicate: cardPolicyPredicateSchema,
        directives: cardPolicyDirectivesSchema,
        expectedRevision: revisionSchema.optional(),
    })
    .strict();
const pendingEligibilityPreviewSchema = z
    .object({
        settings: roomGameSettingsSchema,
        playerCount: z.number().int().min(2).max(10_000),
    })
    .strict();
const roomEligibilityPreviewSchema = z
    .object({
        roomCode: z.string().trim().min(4).max(8),
        participantCredential: z.string().min(32).max(200),
    })
    .strict();

async function ownerFor(request: Request): Promise<CardPolicyOwner> {
    const space = await requireCurrentDataSpace(request);
    const { groupId } = groupQuerySchema.parse(request.query);
    if (!groupId) {
        return {
            dataSpaceId: space.id,
            groupId: null,
            ownerKey: `DATASPACE:${space.id}`,
            name: "DataSpace",
        };
    }
    if (
        !(await AppDataSource.getRepository(GroupEntity).existsBy({
            id: groupId,
            dataSpaceId: space.id,
        }))
    ) {
        throw new ExpectedError("GROUP_NOT_FOUND", "error", 404);
    }
    return {
        dataSpaceId: space.id,
        groupId,
        ownerKey: `GROUP:${groupId}`,
        name: "Group",
    };
}

async function optionalSessionOwner(request: Request): Promise<CardPolicyOwner | undefined> {
    const { groupId } = groupQuerySchema.parse(request.query);
    if (!request.session.account && settings.value.deploymentMode !== "local") {
        if (groupId)
            throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_AUTHENTICATION_REQUIRED, "error", 403);
        return undefined;
    }
    return ownerFor(request);
}

router.get(
    "/export",
    asyncHandler(async (request, response) => {
        const scope = await service.load(await ownerFor(request));
        response.attachment("card-policy.json");
        response.json({
            format: "party-game-card-policy/v2",
            scopeDefault: scope.scopeDefault.directives,
            rules: scope.rules.map(({ name, enabled, predicate, directives }) => ({
                name,
                enabled,
                predicate,
                directives,
            })),
            exactCards: scope.exactCards.map(({ cardId, directives }) => ({
                cardId,
                directives,
            })),
        });
    }),
);

router.post(
    "/import",
    asyncHandler(async (request, response) => {
        const { format: _format, ...input } = portableCardPolicyScopeSchema.parse(request.body);
        const owner = await ownerFor(request);
        await repository.replaceScope(owner, input);
        response.json({ scope: await service.load(owner) });
    }),
);

router.get(
    "/default",
    asyncHandler(async (request, response) => {
        const scope = await service.load(await ownerFor(request));
        response.json({
            scope: scope.owner,
            scopeDefault: scope.scopeDefault,
        });
    }),
);

router.put(
    "/default",
    asyncHandler(async (request, response) => {
        const input = z
            .object({ directives: cardPolicyDirectivesSchema, expectedRevision: revisionSchema })
            .strict()
            .parse(request.body);
        response.json({
            scopeDefault: await repository.putDefault(
                await ownerFor(request),
                input.directives,
                input.expectedRevision,
            ),
        });
    }),
);

router.get(
    "/rules",
    asyncHandler(async (request, response) => {
        const scope = await service.load(await ownerFor(request));
        response.json({ rules: scope.rules });
    }),
);

router.post(
    "/rules",
    asyncHandler(async (request, response) => {
        const input = ruleInputSchema.omit({ expectedRevision: true }).parse(request.body);
        response
            .status(201)
            .json({ rule: await repository.createRule(await ownerFor(request), input) });
    }),
);

router.put(
    "/rules/:id",
    asyncHandler(async (request, response) => {
        const id = uuidSchema.parse(request.params.id);
        const input = ruleInputSchema.required({ expectedRevision: true }).parse(request.body);
        const rule = await repository.updateRule(
            await ownerFor(request),
            id,
            input,
            input.expectedRevision,
        );
        if (!rule) throw new ExpectedError("CARD_POLICY_RULE_NOT_FOUND", "error", 404);
        response.json({ rule });
    }),
);

router.delete(
    "/rules/:id",
    asyncHandler(async (request, response) => {
        const id = uuidSchema.parse(request.params.id);
        const expectedRevision = revisionQuerySchema.parse(request.query.expectedRevision);
        if (!(await repository.deleteRule(await ownerFor(request), id, expectedRevision))) {
            throw new ExpectedError("CARD_POLICY_RULE_NOT_FOUND", "error", 404);
        }
        response.status(204).end();
    }),
);

router.post(
    "/rules/reorder",
    asyncHandler(async (request, response) => {
        const input = z
            .object({ orderedIds: z.array(uuidSchema).max(250) })
            .strict()
            .parse(request.body);
        response.json({
            rules: await repository.reorderRules(await ownerFor(request), input.orderedIds),
        });
    }),
);

router.post(
    "/rules/preview",
    asyncHandler(async (request, response) => {
        const input = z
            .object({
                predicate: cardPolicyPredicateSchema,
                locale: z.string().min(2).max(35),
            })
            .strict()
            .parse(request.body);
        response.json(
            await service.preview(await ownerFor(request), input.predicate, input.locale),
        );
    }),
);

router.post(
    "/session/rules/preview",
    asyncHandler(async (request, response) => {
        const input = z
            .object({
                predicate: cardPolicyPredicateSchema,
                locale: z.string().min(2).max(35),
            })
            .strict()
            .parse(request.body);
        response.json(await service.previewSession(input.predicate, input.locale));
    }),
);

router.post(
    "/session/eligibility-preview",
    asyncHandler(async (request, response) => {
        const input = z
            .union([pendingEligibilityPreviewSchema, roomEligibilityPreviewSchema])
            .parse(request.body);
        if ("roomCode" in input) {
            const preview = await getRoomService().eligibilityPreview(
                input.roomCode,
                input.participantCredential,
            );
            if (!preview) {
                throw new ExpectedError(MESSAGE_KEYS.ROOM_NOT_FOUND, "error", 404);
            }
            response.json(preview);
            return;
        }
        const owner = await optionalSessionOwner(request);
        if ((owner?.groupId ?? null) !== input.settings.groupId) {
            throw new ExpectedError(MESSAGE_KEYS.ROOM_INVALID_REQUEST, "error", 400);
        }
        const profile = roomSettingsGameProfile(input.settings);
        const [localizedCards, groupHistoryCardIds] = await Promise.all([
            cards.listActive({
                locale: input.settings.cardLocale,
                missingTranslation: input.settings.cardFallbackEnabled
                    ? "FALLBACK"
                    : settings.value.cardMissingTranslation,
                fallbackLocales: input.settings.cardFallbackEnabled
                    ? input.settings.cardFallbackLocales
                    : [settings.value.cardFallbackLocale],
            }),
            owner?.groupId
                ? sessions.groupHistory(owner.dataSpaceId as DataSpaceId, owner.groupId)
                : Promise.resolve(new Set<never>()),
        ]);
        response.json(
            await service.eligibilityPreview({
                cards: localizedCards,
                dataSpaceId: owner?.dataSpaceId,
                groupId: owner?.groupId,
                profile,
                sessionPolicy: input.settings.cardPolicy,
                mode: input.settings.mode,
                playerCount: input.playerCount,
                groupHistoryCardIds,
            }),
        );
    }),
);

router.post(
    "/session/cards",
    asyncHandler(async (request, response) => {
        const input = z
            .object({
                sessionPolicy: sessionCardPolicySchema,
                search: cardSearchSchema,
            })
            .strict()
            .parse(request.body);
        response.json(
            await service.searchSession({
                owner: await optionalSessionOwner(request),
                search: input.search,
                sessionPolicy: input.sessionPolicy,
            }),
        );
    }),
);

router.get(
    "/cards",
    asyncHandler(async (request, response) => {
        const { groupId: _groupId, ...input } = cardSearchSchema
            .extend({ groupId: z.string().uuid().optional() })
            .parse(request.query);
        response.json(await service.search(await ownerFor(request), input));
    }),
);

router.post(
    "/cards/bulk",
    asyncHandler(async (request, response) => {
        const input = z
            .object({
                filters: cardSearchSchema.omit({ cursor: true, limit: true }),
                directives: cardPolicyDirectivesSchema,
                confirmedCount: z.number().int().nonnegative().max(50_000),
            })
            .strict()
            .parse(request.body);
        response.json(
            await service.bulkApply(
                await ownerFor(request),
                input.filters,
                input.directives,
                input.confirmedCount,
            ),
        );
    }),
);

router.get(
    "/cards/:cardId",
    asyncHandler(async (request, response) => {
        const owner = await ownerFor(request);
        const cardId = uuidSchema.parse(request.params.cardId);
        const scope = await service.load(owner);
        const policy = scope.exactCards.find((entry) => entry.cardId === cardId) ?? {
            cardId,
            directives: {},
            revision: 0,
        };
        response.json({ policy });
    }),
);

router.put(
    "/cards/:cardId",
    asyncHandler(async (request, response) => {
        const cardId = uuidSchema.parse(request.params.cardId);
        const input = z
            .object({ directives: cardPolicyDirectivesSchema, expectedRevision: revisionSchema })
            .strict()
            .parse(request.body);
        const policy = await repository.putExactCard(
            await ownerFor(request),
            cardId,
            input.directives,
            input.expectedRevision,
        );
        if (!policy) throw new ExpectedError("CARD_NOT_FOUND", "error", 404);
        response.json({ policy });
    }),
);

router.delete(
    "/cards/:cardId",
    asyncHandler(async (request, response) => {
        const expectedRevision = revisionQuerySchema.parse(request.query.expectedRevision);
        if (
            !(await repository.deleteExactCard(
                await ownerFor(request),
                uuidSchema.parse(request.params.cardId),
                expectedRevision,
            ))
        ) {
            throw new ExpectedError("CARD_POLICY_NOT_FOUND", "error", 404);
        }
        response.status(204).end();
    }),
);

export default router;
