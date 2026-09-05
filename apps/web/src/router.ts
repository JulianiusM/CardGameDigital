export type AppRoute = "home" | "room" | "couch" | "account" | "cards" | "help" | "legacy-room";

type NavigateOptions = { replace?: boolean; force?: boolean };
type RouteListener = (route: AppRoute) => void;

let listener: RouteListener | null = null;
let shouldProtect = () => false;
let confirmNavigation = () => true;
let currentHref = location.href;
let suppressNextUnloadPrompt = false;

function isApplicationPath(pathname: string): boolean {
    return pathname === "/play" || pathname.startsWith("/play/");
}

export function routeFromLocation(): AppRoute {
    const path = location.pathname.replace(/^\/play\/?/, "").replace(/\/$/, "");
    if (!path) return "home";
    if (path === "room") return "room";
    if (path === "couch") return "couch";
    if (path === "account") return "account";
    if (path === "cards") return "cards";
    if (path === "help") return "help";
    if (["host", "mobile", "display"].includes(path)) return "legacy-room";
    return "home";
}

export function routePath(route: Exclude<AppRoute, "legacy-room">): string {
    if (route === "home") return "/play/";
    return `/play/${route}`;
}

export function configureNavigationProtection(
    protection: () => boolean,
    confirmation: () => boolean,
): void {
    shouldProtect = protection;
    confirmNavigation = confirmation;
}

export function navigate(path: string, options: NavigateOptions = {}): boolean {
    const url = new URL(path, location.href);
    if (url.origin !== location.origin || !isApplicationPath(url.pathname)) {
        location.assign(url.href);
        return true;
    }
    if (!options.force && shouldProtect() && !confirmNavigation()) return false;
    if (options.replace) history.replaceState({}, "", url);
    else history.pushState({}, "", url);
    currentHref = url.href;
    listener?.(routeFromLocation());
    return true;
}

export function reloadWithoutNavigationPrompt(): void {
    suppressNextUnloadPrompt = true;
    location.reload();
}

export function startRouter(onRoute: RouteListener): () => void {
    listener = onRoute;
    const popstate = () => {
        if (shouldProtect() && !confirmNavigation()) {
            history.replaceState({}, "", currentHref);
            return;
        }
        currentHref = location.href;
        onRoute(routeFromLocation());
    };
    const click = (event: MouseEvent) => {
        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        )
            return;
        const target = event.target instanceof Element ? event.target.closest("a") : null;
        if (!(target instanceof HTMLAnchorElement)) return;
        if (target.target || target.download || target.rel.includes("external")) return;
        const url = new URL(target.href, location.href);
        if (url.origin !== location.origin || !isApplicationPath(url.pathname)) return;
        event.preventDefault();
        navigate(url.href);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
        if (suppressNextUnloadPrompt || !shouldProtect()) return;
        event.preventDefault();
    };
    window.addEventListener("popstate", popstate);
    document.addEventListener("click", click);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
        listener = null;
        window.removeEventListener("popstate", popstate);
        document.removeEventListener("click", click);
        window.removeEventListener("beforeunload", beforeUnload);
    };
}
