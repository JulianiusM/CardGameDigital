import "express";
import type { Settings } from "../modules/settings";

declare module "express-serve-static-core" {
    interface Locals {
        data?: unknown;
        auth?: { user?: User | null };
        dataSpace?: DataSpace | null;
        requestId?: string;
        version: string;
        settings?: Partial<Settings>;
    }
}

declare module "express-session" {
    interface SessionData {
        account?: { userId: number; dataSpaceId: string | null };
        oidc?: { code_verifier: string; state: string; nonce?: string; returnTo?: string };
    }
}

export {};
