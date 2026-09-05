import express, { type Request } from "express";
import { z } from "zod";
import { AppDataSource } from "../../modules/database/dataSource";
import { GroupEntity } from "../../../../../packages/persistence/entities/game/GroupEntity";
import { CardEntity } from "../../../../../packages/persistence/entities/card/CardEntity";
import { asyncHandler } from "../../modules/lib/asyncHandler";
import { ExpectedError } from "../../modules/lib/errors";
import settings from "../../modules/settings";
import { getRoomService } from "../../modules/realtime";
import type { CardPolicyOwner } from "../../../../../packages/application/cardPolicyRepository";
import { CardPolicyService } from "../../../../../packages/application/cardPolicyService";
import { roomSettingsGameProfile } from "../../../../../packages/application/roomGameSettings";
import type { DataSpaceId } from "../../../../../packages/game-core";
import { MESSAGE_KEYS } from "../../../../../packages/localization/keys";
import {
    TypeOrmCardPolicyRepository,
    TypeOrmCardRepository,
    TypeOrmCouchSessionRepository,
} from "../../../../../packages/persistence";
import {
    cardPolicyBulkApplyRequestSchema,
    cardPolicyBulkApplyResponseSchema,
    cardPolicyDefaultResponseSchema,
    cardPolicyDefaultUpdateRequestSchema,
    cardPolicyExactResponseSchema,
    cardPolicyExactUpdateRequestSchema,
    cardPolicyRuleCreateRequestSchema,
    cardPolicyRulePreviewRequestSchema,
    cardPolicyRulePreviewResponseSchema,
    cardPolicyRuleReorderRequestSchema,
    cardPolicyRuleResponseSchema,
    cardPolicyRulesResponseSchema,
    cardPolicyRuleUpdateRequestSchema,
    cardPolicyScopedDefaultResponseSchema,
    cardPolicySearchSchema,
    cardPolicySessionSearchRequestSchema,
    eligibilityPreviewRequestSchema,
    eligibilityPreviewSchema,
    managedCardSearchResponseSchema,
    portableCardPolicyScopeSchema,
} from "../../../../../packages/protocol";
import { requireCurrentDataSpace } from "./dataSpaceAccess";

const router = express.Router();
const repository = new TypeOrmCardPolicyRepository(AppDataSource);
const service = new CardPolicyService(repository);
const cards = new TypeOrmCardRepository(AppDataSource.getRepository(CardEntity));
const sessions = new TypeOrmCouchSessionRepository(AppDataSource);
const groupQuerySchema = z.object({ groupId: z.string().uuid().optional() }).passthrough();
const revisionQuerySchema = z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .transform(Number);
const uuidSchema = z.string().uuid();

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
        response.json(
            cardPolicyScopedDefaultResponseSchema.parse({
                scope: scope.owner,
                scopeDefault: scope.scopeDefault,
            }),
        );
    }),
);

router.put(
    "/default",
    asyncHandler(async (request, response) => {
        const input = cardPolicyDefaultUpdateRequestSchema.parse(request.body);
        response.json(
            cardPolicyDefaultResponseSchema.parse({
                scopeDefault: await repository.putDefault(
                    await ownerFor(request),
                    input.directives,
                    input.expectedRevision,
                ),
            }),
        );
    }),
);

router.get(
    "/rules",
    asyncHandler(async (request, response) => {
        const scope = await service.load(await ownerFor(request));
        response.json(cardPolicyRulesResponseSchema.parse({ rules: scope.rules }));
    }),
);

router.post(
    "/rules",
    asyncHandler(async (request, response) => {
        const input = cardPolicyRuleCreateRequestSchema.parse(request.body);
        response.status(201).json(
            cardPolicyRuleResponseSchema.parse({
                rule: await repository.createRule(await ownerFor(request), input),
            }),
        );
    }),
);

router.put(
    "/rules/:id",
    asyncHandler(async (request, response) => {
        const id = uuidSchema.parse(request.params.id);
        const input = cardPolicyRuleUpdateRequestSchema.parse(request.body);
        const rule = await repository.updateRule(
            await ownerFor(request),
            id,
            input,
            input.expectedRevision,
        );
        if (!rule) throw new ExpectedError("CARD_POLICY_RULE_NOT_FOUND", "error", 404);
        response.json(cardPolicyRuleResponseSchema.parse({ rule }));
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
        const input = cardPolicyRuleReorderRequestSchema.parse(request.body);
        response.json(
            cardPolicyRulesResponseSchema.parse({
                rules: await repository.reorderRules(await ownerFor(request), input.orderedIds),
            }),
        );
    }),
);

router.post(
    "/rules/preview",
    asyncHandler(async (request, response) => {
        const input = cardPolicyRulePreviewRequestSchema.parse(request.body);
        response.json(
            cardPolicyRulePreviewResponseSchema.parse(
                await service.preview(await ownerFor(request), input.predicate, input.locale),
            ),
        );
    }),
);

router.post(
    "/session/rules/preview",
    asyncHandler(async (request, response) => {
        const input = cardPolicyRulePreviewRequestSchema.parse(request.body);
        response.json(
            cardPolicyRulePreviewResponseSchema.parse(
                await service.previewSession(input.predicate, input.locale),
            ),
        );
    }),
);

router.post(
    "/session/eligibility-preview",
    asyncHandler(async (request, response) => {
        const input = eligibilityPreviewRequestSchema.parse(request.body);
        if ("roomCode" in input) {
            const preview = await getRoomService().eligibilityPreview(
                input.roomCode,
                input.participantCredential,
            );
            if (!preview) {
                throw new ExpectedError(MESSAGE_KEYS.ROOM_NOT_FOUND, "error", 404);
            }
            response.json(eligibilityPreviewSchema.parse(preview));
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
            eligibilityPreviewSchema.parse(
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
            ),
        );
    }),
);

router.post(
    "/session/cards",
    asyncHandler(async (request, response) => {
        const input = cardPolicySessionSearchRequestSchema.parse(request.body);
        response.json(
            managedCardSearchResponseSchema.parse(
                await service.searchSession({
                    owner: await optionalSessionOwner(request),
                    search: input.search,
                    sessionPolicy: input.sessionPolicy,
                }),
            ),
        );
    }),
);

router.get(
    "/cards",
    asyncHandler(async (request, response) => {
        const { groupId: _groupId, ...input } = cardPolicySearchSchema
            .extend({ groupId: z.string().uuid().optional() })
            .parse(request.query);
        response.json(
            managedCardSearchResponseSchema.parse(
                await service.search(await ownerFor(request), input),
            ),
        );
    }),
);

router.post(
    "/cards/bulk",
    asyncHandler(async (request, response) => {
        const input = cardPolicyBulkApplyRequestSchema.parse(request.body);
        response.json(
            cardPolicyBulkApplyResponseSchema.parse(
                await service.bulkApply(
                    await ownerFor(request),
                    input.filters,
                    input.directives,
                    input.confirmedCount,
                ),
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
        response.json(cardPolicyExactResponseSchema.parse({ policy }));
    }),
);

router.put(
    "/cards/:cardId",
    asyncHandler(async (request, response) => {
        const cardId = uuidSchema.parse(request.params.cardId);
        const input = cardPolicyExactUpdateRequestSchema.parse(request.body);
        const policy = await repository.putExactCard(
            await ownerFor(request),
            cardId,
            input.directives,
            input.expectedRevision,
        );
        if (!policy) throw new ExpectedError("CARD_NOT_FOUND", "error", 404);
        response.json(cardPolicyExactResponseSchema.parse({ policy }));
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
