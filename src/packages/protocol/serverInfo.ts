import { z } from "zod";
import { PROTOCOL_VERSION } from "./version";

const sameOriginRelativePathSchema = z
    .string()
    .startsWith("/")
    .refine((value) => !value.startsWith("//"), "Endpoint must be same-origin relative");

const httpOriginSchema = z
    .string()
    .url()
    .refine((value) => {
        const parsed = new URL(value);
        return (
            (parsed.protocol === "http:" || parsed.protocol === "https:") &&
            !parsed.username &&
            !parsed.password &&
            parsed.pathname === "/" &&
            !parsed.search &&
            !parsed.hash
        );
    }, "Value must be an HTTP(S) origin without credentials, path, query, or fragment");

export const serverInfoSchema = z
    .object({
        version: z.literal(1),
        serverId: z.string().uuid(),
        displayName: z.string().trim().min(1).max(80),
        deploymentMode: z.enum(["local", "public"]),
        publicRuntimeSecurity: z.enum(["enforced", "development"]),
        authenticationAvailable: z.boolean(),
        protocolVersions: z.array(z.number().int().positive()).min(1),
        roomCapacity: z
            .object({
                maximumParticipants: z.number().int().min(2),
                maximumPlayers: z.number().int().min(2),
            })
            .strict(),
        roomAccess: z
            .object({
                configuredBaseUrl: httpOriginSchema.nullable(),
                availableBaseUrls: z.array(httpOriginSchema).max(100),
            })
            .strict(),
        capabilities: z
            .object({
                localNetworkDiscovery: z.boolean(),
                displayBootstrapRoomCreation: z.boolean(),
                nativeDeviceAuthorization: z.boolean().default(false),
            })
            .strict(),
        nativeDeviceAuthorization: z
            .object({
                clientId: z.string().min(1).max(100),
                scopes: z.array(z.string().min(1).max(100)).min(1).max(20),
            })
            .strict()
            .nullable()
            .default(null),
        localNetworkDiscovery: z
            .object({
                advertising: z.boolean(),
                serviceType: z.string().min(1).max(255),
                txtVersion: z.number().int().positive(),
            })
            .strict(),
        endpoints: z
            .object({
                apiBasePath: sameOriginRelativePathSchema,
                webSocketPath: sameOriginRelativePathSchema,
                roomJoinPathTemplate: sameOriginRelativePathSchema.refine(
                    (value) => value.includes("{roomCode}"),
                    "Room join template must contain {roomCode}",
                ),
                deviceAuthorizationPath: sameOriginRelativePathSchema.optional(),
                deviceTokenPath: sameOriginRelativePathSchema.optional(),
                deviceRevocationPath: sameOriginRelativePathSchema.optional(),
            })
            .strict(),
    })
    .strict()
    .refine(({ protocolVersions }) => protocolVersions.includes(PROTOCOL_VERSION), {
        message: `WebSocket protocol ${PROTOCOL_VERSION} must be advertised`,
        path: ["protocolVersions"],
    })
    .superRefine(({ capabilities, nativeDeviceAuthorization, endpoints }, context) => {
        if (!capabilities.nativeDeviceAuthorization) {
            if (nativeDeviceAuthorization !== null) {
                context.addIssue({
                    code: "custom",
                    message: "Disabled native authorization must not advertise client settings",
                    path: ["nativeDeviceAuthorization"],
                });
            }
            return;
        }
        if (!nativeDeviceAuthorization) {
            context.addIssue({
                code: "custom",
                message: "Native authorization client settings are required",
                path: ["nativeDeviceAuthorization"],
            });
        }
        for (const name of ["deviceAuthorizationPath", "deviceTokenPath"] as const) {
            if (!endpoints[name]) {
                context.addIssue({
                    code: "custom",
                    message: `${name} is required when native authorization is enabled`,
                    path: ["endpoints", name],
                });
            }
        }
    });

export type ServerInfoPayload = z.infer<typeof serverInfoSchema>;
