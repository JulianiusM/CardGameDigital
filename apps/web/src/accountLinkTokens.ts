export type AccountLinkTokens = {
    activationToken: string | null;
    resetToken: string | null;
    sanitizedPath: string;
};

export function extractAccountLinkTokens(url: URL): AccountLinkTokens {
    const activationToken = url.searchParams.get("activate");
    const resetToken = url.searchParams.get("reset");
    url.searchParams.delete("activate");
    url.searchParams.delete("reset");
    return {
        activationToken,
        resetToken,
        sanitizedPath: `${url.pathname}${url.search}${url.hash}`,
    };
}
