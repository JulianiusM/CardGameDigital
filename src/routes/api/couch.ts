import { MESSAGE_KEYS } from "../../packages/localization/keys";
import express, { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { CouchSessionService } from "../../packages/application/couchSessionService";
import { CryptoRandomSource } from "../../packages/application/cryptoRandomSource";
import { CARD_TYPES, GAME_MODES } from "../../packages/game-core";
import { TypeOrmCardRepository } from "../../packages/persistence";
import { AppDataSource } from "../../modules/database/dataSource";
import settings from "../../modules/settings";
import { CardEntity } from "../../modules/database/entities/card/CardEntity";
import { asyncHandler } from "../../modules/lib/asyncHandler";
import {
    cardLocaleFor,
    detectLocale,
    translate,
    translateError,
} from "../../packages/localization/messages";

const router = express.Router();
const service = new CouchSessionService(
    new TypeOrmCardRepository(AppDataSource.getRepository(CardEntity)),
    new CryptoRandomSource(),
    {
        missingTranslation: settings.value.cardMissingTranslation,
        fallbackLocale: settings.value.cardFallbackLocale,
    },
);
const idSchema = z.string().uuid();
const revisionSchema = z.number().int().nonnegative();
const createSchema = z
    .object({
        mode: z.enum([
            GAME_MODES.CLASSIC,
            GAME_MODES.RANDOM,
            GAME_MODES.NEVER_HAVE_I_EVER,
            GAME_MODES.LETS_TALK,
        ]),
        players: z
            .array(z.object({ name: z.string().trim().min(1).max(40) }).strict())
            .min(1)
            .max(20),
        maximumIntensity: z
            .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
            .default(3),
        randomQuestionRatio: z.number().min(0).max(1).default(0.6),
        letsTalkMetaInterval: z.number().int().min(1).max(50).default(5),
        profileId: z.string().min(1).optional(),
        adultContentConfirmed: z.boolean().optional(),
    })
    .strict();
const revisionBody = z.object({ revision: revisionSchema }).strict();

router.post(
    "/sessions",
    asyncHandler(async (req, res) => {
        const locale = detectLocale(req.get("accept-language"));
        res.status(201).json(
            service.create({ ...createSchema.parse(req.body), cardLocale: cardLocaleFor(locale) }),
        );
    }),
);
router.get(
    "/sessions/:id",
    asyncHandler(async (req, res) => {
        res.json(service.get(idSchema.parse(req.params.id)));
    }),
);
router.post(
    "/sessions/:id/start",
    asyncHandler(async (req, res) => {
        const { revision } = revisionBody.parse(req.body);
        res.json(await service.startTurn(idSchema.parse(req.params.id), revision));
    }),
);
router.post(
    "/sessions/:id/choose",
    asyncHandler(async (req, res) => {
        const { revision, cardType } = revisionBody
            .extend({ cardType: z.enum([CARD_TYPES.QUESTION, CARD_TYPES.DARE]) })
            .parse(req.body);
        res.json(await service.chooseCardType(idSchema.parse(req.params.id), revision, cardType));
    }),
);
router.post(
    "/sessions/:id/skip",
    asyncHandler(async (req, res) => {
        const { revision } = revisionBody.parse(req.body);
        res.json(await service.skip(idSchema.parse(req.params.id), revision));
    }),
);
router.post(
    "/sessions/:id/advance",
    asyncHandler(async (req, res) => {
        const { revision } = revisionBody.parse(req.body);
        res.json(service.advance(idSchema.parse(req.params.id), revision));
    }),
);
router.post(
    "/sessions/:id/vote",
    asyncHandler(async (req, res) => {
        const { revision, playerId, vote } = revisionBody
            .extend({ playerId: z.string().uuid(), vote: z.enum(["YES", "NO"]) })
            .parse(req.body);
        res.json(service.vote(idSchema.parse(req.params.id), revision, playerId, vote));
    }),
);
router.post(
    "/sessions/:id/end",
    asyncHandler(async (req, res) => {
        const { revision } = revisionBody.parse(req.body);
        res.json(service.end(idSchema.parse(req.params.id), revision));
    }),
);

router.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    const message = translateError(
        detectLocale(req.get("accept-language")),
        (error as Error).message,
    );
    if (error instanceof z.ZodError)
        return res.status(400).json({
            error: {
                code: "VALIDATION_ERROR",
                message: translate(
                    detectLocale(req.get("accept-language")),
                    MESSAGE_KEYS.COUCH_INVALID_REQUEST,
                ),
                details: error.issues,
            },
        });
    const code = (error as { code?: string }).code;
    if (code === "VALIDATION_ERROR") return res.status(400).json({ error: { code, message } });
    if (code === "SESSION_NOT_FOUND") return res.status(404).json({ error: { code, message } });
    if (
        code === "STALE_SESSION_REVISION" ||
        code === "INVALID_GAME_STATE" ||
        code === "CARD_POOL_EXHAUSTED"
    ) {
        return res.status(409).json({ error: { code, message } });
    }
    next(error);
});

export default router;
