import { z } from "zod";

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
