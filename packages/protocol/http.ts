import { z } from "zod";
import { roomGameSettingsSchema } from "./common";
import { sessionViewSchema } from "./snapshots";
import type { CouchSessionSnapshot } from "./httpDtos";

/** Couch uses the same public game view, without a Room participant's capabilities. */
export const couchSessionSnapshotSchema = sessionViewSchema
    .omit({ hasVoted: true, controllablePlayers: true, viewer: true, availableActions: true })
    .extend({
        votedPlayerIds: z.array(z.uuid()),
        persistence: z.enum(["EPHEMERAL", "DATASPACE"]),
        settings: roomGameSettingsSchema.pick({
            mode: true,
            profileId: true,
            cardLocale: true,
            cardFallbackEnabled: true,
            cardFallbackLocales: true,
            neverHaveIEverRevealMode: true,
            cardPolicy: true,
            configuration: true,
        }),
    })
    .loose();

export function decodeCouchSessionSnapshot(input: unknown): CouchSessionSnapshot | null {
    const result = couchSessionSnapshotSchema.safeParse(input);
    return result.success ? result.data : null;
}

/** Tolerant consumer shape for the documented HTTP error envelope. */
export const httpErrorResponseSchema = z
    .object({
        error: z
            .object({
                code: z.string().min(1).optional(),
                message: z.string().min(1).optional(),
                data: z.unknown().optional(),
            })
            .loose(),
    })
    .loose();

export type HttpErrorResponse = z.infer<typeof httpErrorResponseSchema>;

/** Error handling must retain each client adapter's existing fallback message. */
export function decodeHttpErrorResponse(input: unknown): HttpErrorResponse | null {
    const result = httpErrorResponseSchema.safeParse(input);
    return result.success ? result.data : null;
}
