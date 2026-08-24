import "express";
import type { DataSpace } from "../modules/database/entities/user/DataSpace";
import type { User } from "../modules/database/entities/user/User";
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
        auth: { user?: User | null };
        dataSpace?: DataSpace | null;
        oidc?: { code_verifier: string; state: string; nonce?: string };
    }
}

export {};
