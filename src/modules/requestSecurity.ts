export function isTrustedOrigin(originOrReferer: string | undefined, publicUrl: string): boolean {
    if (!originOrReferer) return false;
    try {
        return new URL(originOrReferer).origin === new URL(publicUrl).origin;
    } catch {
        return false;
    }
}

export function requestPathForLog(url: string | undefined): string {
    if (!url) return "-";
    return url.split(/[?#]/, 1)[0] || "/";
}
