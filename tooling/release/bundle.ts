import fs from "node:fs";
import { z } from "zod";

export const SERVER_WEB_RELEASE_UNIT = "server-web" as const;
export const RELEASE_MANIFEST_FORMAT = "party-game-release/v2" as const;
export const MANAGED_NODE_VERSION = ">=24.7.0 <25.0.0";

export const releaseEditionSchema = z.enum(["portable", "public"]);
export type ReleaseEdition = z.infer<typeof releaseEditionSchema>;
export const serverWebPlatformSchema = z.enum(["linux", "win32", "darwin"]);
export const serverWebArchitectureSchema = z.enum(["x64", "arm64"]);
export const releaseVersionSchema = z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.[0-9A-Za-z.-]+)?)?$/);

export const sourceRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);

const commonManifestShape = {
    format: z.literal(RELEASE_MANIFEST_FORMAT),
    releaseUnit: z.literal(SERVER_WEB_RELEASE_UNIT),
    version: releaseVersionSchema,
    sourceRevision: sourceRevisionSchema,
    components: z.object({ server: z.string().min(1), web: z.string().min(1) }),
    protocolVersion: z.number().int().positive(),
};

export const serverWebReleaseManifestSchema = z
    .discriminatedUnion("edition", [
        z.object({
            ...commonManifestShape,
            edition: z.literal("portable"),
            platform: serverWebPlatformSchema,
            architecture: serverWebArchitectureSchema,
            entrypoint: z.enum(["party-game", "party-game.exe"]),
            runtime: z.object({
                name: z.literal("node"),
                version: z.string().regex(/^v24\./),
                bundled: z.literal(true),
            }),
            productionDependenciesBundled: z.literal(true),
            externalSoftwareDependencies: z.tuple([]),
        }),
        z.object({
            ...commonManifestShape,
            edition: z.literal("public"),
            platform: z.literal("any"),
            architecture: z.literal("any"),
            entrypoint: z.literal("main.cjs"),
            runtime: z.object({
                name: z.literal("node"),
                version: z.literal(MANAGED_NODE_VERSION),
                bundled: z.literal(false),
            }),
            productionDependenciesBundled: z.literal(false),
            externalSoftwareDependencies: z.tuple([
                z.literal("node"),
                z.literal("production-node-packages"),
            ]),
        }),
    ])
    .superRefine((manifest, context) => {
        if (
            manifest.edition === "portable" &&
            manifest.entrypoint !== portableExecutableName(manifest.platform)
        ) {
            context.addIssue({
                code: "custom",
                path: ["entrypoint"],
                message: "Executable must match the platform",
            });
        }
        if (manifest.components.server !== manifest.version) {
            context.addIssue({
                code: "custom",
                path: ["components", "server"],
                message: "Server version must equal the server-web release version",
            });
        }
        if (manifest.components.web !== manifest.version) {
            context.addIssue({
                code: "custom",
                path: ["components", "web"],
                message: "Web version must equal the server-web release version",
            });
        }
    });

export type ServerWebReleaseManifest = z.infer<typeof serverWebReleaseManifestSchema>;

export function portableExecutableName(platform: NodeJS.Platform): string {
    return platform === "win32" ? "party-game.exe" : "party-game";
}

type RemoveReleaseTarget = (target: fs.PathLike, options?: fs.RmOptions) => void;

function isRetryableReleaseTargetError(error: unknown): error is NodeJS.ErrnoException {
    if (!(error instanceof Error)) return false;
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM";
}

export function removeExistingReleaseTarget(
    target: string,
    removeTarget: RemoveReleaseTarget = fs.rmSync,
): void {
    try {
        removeTarget(target, {
            recursive: true,
            force: true,
            maxRetries: 8,
            retryDelay: 250,
        });
    } catch (error) {
        if (!isRetryableReleaseTargetError(error)) throw error;
        throw new Error(
            `Cannot replace release bundle '${target}'. Stop any server started from this bundle and close terminals or file browsers using it, then retry.`,
            { cause: error },
        );
    }
}

export function serverWebReleaseDirectoryName(input: {
    version: string;
    edition: ReleaseEdition;
    platform: string;
    architecture: string;
}): string {
    if (input.edition === "public")
        return `party-game-${SERVER_WEB_RELEASE_UNIT}-${input.version}-public`;
    return [
        "party-game",
        SERVER_WEB_RELEASE_UNIT,
        input.version,
        input.edition,
        input.platform,
        input.architecture,
    ].join("-");
}

export function createServerWebReleaseManifest(input: {
    version: string;
    sourceRevision: string;
    edition: ReleaseEdition;
    platform: NodeJS.Platform;
    architecture: NodeJS.Architecture;
    nodeVersion: string;
    protocolVersion: number;
}): ServerWebReleaseManifest {
    const common = {
        format: RELEASE_MANIFEST_FORMAT,
        releaseUnit: SERVER_WEB_RELEASE_UNIT,
        version: input.version,
        sourceRevision: input.sourceRevision,
        components: { server: input.version, web: input.version },
        protocolVersion: input.protocolVersion,
    };
    if (input.edition === "public") {
        return serverWebReleaseManifestSchema.parse({
            ...common,
            edition: "public",
            platform: "any",
            architecture: "any",
            entrypoint: "main.cjs",
            runtime: { name: "node", version: MANAGED_NODE_VERSION, bundled: false },
            productionDependenciesBundled: false,
            externalSoftwareDependencies: ["node", "production-node-packages"],
        });
    }
    return serverWebReleaseManifestSchema.parse({
        ...common,
        edition: input.edition,
        platform: input.platform,
        architecture: input.architecture,
        entrypoint: portableExecutableName(input.platform),
        runtime: {
            name: "node",
            version: input.nodeVersion,
            bundled: true,
        },
        productionDependenciesBundled: true,
        externalSoftwareDependencies: [],
    });
}
