import { z } from "zod";
import { MESSAGE_KEYS } from "../../../../packages/localization/keys";
import { ExpectedError } from "./lib/errors";

const identityClaimsSchema = z.object({
    sub: z.string().min(1).max(255),
    email: z.email().max(100).optional(),
    email_verified: z.boolean().optional(),
    preferred_username: z.string().min(1).max(100).optional(),
    name: z.string().min(1).max(50).optional(),
});

/** Resolve only validated provider claims, keeping verification bound to its email. */
export function resolveOidcIdentityClaims(
    tokenClaims: unknown,
    userInfoClaims?: unknown,
): z.infer<typeof identityClaimsSchema> {
    const token = identityClaimsSchema.safeParse(tokenClaims);
    if (!token.success) throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_INVALID_OIDC_SESSION);
    if (userInfoClaims === undefined) return token.data;
    const userInfo = identityClaimsSchema.safeParse(userInfoClaims);
    if (!userInfo.success || userInfo.data.sub !== token.data.sub) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_INVALID_OIDC_SESSION);
    }

    const identity = {
        ...token.data,
        preferred_username: userInfo.data.preferred_username ?? token.data.preferred_username,
        name: userInfo.data.name ?? token.data.name,
    };
    if (userInfo.data.email !== undefined) {
        identity.email = userInfo.data.email;
        identity.email_verified = userInfo.data.email_verified;
        if (identity.email_verified === undefined && identity.email === token.data.email) {
            identity.email_verified = token.data.email_verified;
        }
    }
    return identity;
}
