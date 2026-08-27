import fs from "node:fs";
import { z } from "zod";

export const SERVER_WEB_RELEASE_UNIT = "server-web" as const;
export const RELEASE_MANIFEST_FORMAT = "party-game-release/v1" as const;

export const releaseEditionSchema = z.enum(["portable", "public"]);
export type ReleaseEdition = z.infer<typeof releaseEditionSchema>;
export const serverWebPlatformSchema = z.enum(["linux", "win32", "darwin"]);
export const serverWebArchitectureSchema = z.enum(["x64", "arm64"]);
export const releaseVersionSchema = z
    .string()
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-(?:alpha|beta|rc)(?:\.[0-9A-Za-z.-]+)?)?$/);

const bundledComponentSchema = z.object({
    server: z.string().min(1),
    web: z.string().min(1),
});

export const serverWebReleaseManifestSchema = z
    .object({
        format: z.literal(RELEASE_MANIFEST_FORMAT),
        releaseUnit: z.literal(SERVER_WEB_RELEASE_UNIT),
        version: releaseVersionSchema,
        edition: releaseEditionSchema,
        platform: serverWebPlatformSchema,
        architecture: serverWebArchitectureSchema,
        components: bundledComponentSchema,
        protocolVersion: z.number().int().positive(),
        runtime: z.object({
            name: z.literal("node"),
            version: z.string().min(1),
            bundled: z.literal(true),
        }),
        productionDependenciesBundled: z.literal(true),
        externalSoftwareDependencies: z.array(z.never()).length(0),
    })
    .superRefine((manifest, context) => {
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
    platform: z.infer<typeof serverWebPlatformSchema>;
    architecture: z.infer<typeof serverWebArchitectureSchema>;
}): string {
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
    edition: ReleaseEdition;
    platform: NodeJS.Platform;
    architecture: NodeJS.Architecture;
    nodeVersion: string;
    protocolVersion: number;
}): ServerWebReleaseManifest {
    return serverWebReleaseManifestSchema.parse({
        format: RELEASE_MANIFEST_FORMAT,
        releaseUnit: SERVER_WEB_RELEASE_UNIT,
        version: input.version,
        edition: input.edition,
        platform: input.platform,
        architecture: input.architecture,
        components: {
            server: input.version,
            web: input.version,
        },
        protocolVersion: input.protocolVersion,
        runtime: {
            name: "node",
            version: input.nodeVersion,
            bundled: true,
        },
        productionDependenciesBundled: true,
        externalSoftwareDependencies: [],
    });
}
