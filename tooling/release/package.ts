import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z, type ZodType } from "zod";
import {
    cardReplacedEventPayloadSchema,
    clientHelloEnvelopeSchema,
    clientPingEnvelopeSchema,
    participantLeftEventPayloadSchema,
    PROTOCOL_VERSION,
    protocolErrorCodeSchema,
    roomCommandEnvelopeSchema,
    roomGameSettingsSchema,
    snapshotRequestEnvelopeSchema,
} from "../../packages/protocol";
import { bundledCardCatalogArtifact } from "../../apps/server/src/modules/database/bundledCardCatalog";
import {
    createServerWebReleaseManifest,
    removeExistingReleaseTarget,
    releaseEditionSchema,
    releaseVersionSchema,
    serverWebArchitectureSchema,
    serverWebReleaseDirectoryName,
    serverWebPlatformSchema,
} from "./bundle";

function releaseReadme(edition: "portable" | "public", platform: NodeJS.Platform): string {
    const launcher = platform === "win32" ? "start.cmd" : "./start.sh";
    if (edition === "portable") {
        return `Start with ${launcher}. Open http://localhost:3000/play/. No internet or installed Node.js is required.\n`;
    }
    return `Start with ${launcher}. The Node runtime, server, and web client are bundled. Configure MariaDB, HTTPS/proxying, PUBLIC_URL, SESSION_SECRET, TRUST_PROXY, authentication, and SMTP before starting.\n`;
}

async function main(): Promise<void> {
    const editionResult = releaseEditionSchema.safeParse(process.argv[2]);
    if (!editionResult.success)
        throw new Error("Usage: tooling/release/package.ts <portable|public>");
    const edition = editionResult.data;
    if (edition === "public") await bundledCardCatalogArtifact("public");

    const root = process.cwd();
    const packageVersion = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ).version;
    const version = releaseVersionSchema.parse(process.env.RELEASE_VERSION || packageVersion);
    const platform = serverWebPlatformSchema.parse(process.platform);
    const architecture = serverWebArchitectureSchema.parse(process.arch);
    const artifactsRoot = path.resolve(root, "artifacts");
    const target = path.resolve(
        artifactsRoot,
        serverWebReleaseDirectoryName({
            version,
            edition,
            platform,
            architecture,
        }),
    );
    if (path.dirname(target) !== artifactsRoot) {
        throw new Error("Release target must be an immediate child of the artifacts directory");
    }
    removeExistingReleaseTarget(target);
    fs.mkdirSync(path.join(target, "app"), { recursive: true });
    fs.cpSync(path.join(root, "dist"), path.join(target, "app", "dist"), { recursive: true });
    fs.copyFileSync(path.join(root, "package-lock.json"), path.join(target, "package-lock.json"));
    fs.copyFileSync(path.join(root, "LICENSE.md"), path.join(target, "LICENSE.md"));

    const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    delete sourcePackage.devDependencies;
    delete sourcePackage.scripts;
    fs.writeFileSync(
        path.join(target, "package.json"),
        `${JSON.stringify(sourcePackage, null, 2)}\n`,
    );
    fs.writeFileSync(
        path.join(target, "app", "package.json"),
        `${JSON.stringify(sourcePackage, null, 2)}\n`,
    );

    // npm already resolved the locked production graph. Copy exactly those packages,
    // including the platform-specific Argon2 and better-sqlite3 native bindings.
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error("Release packaging must run through an npm script");
    const sbom = execFileSync(
        process.execPath,
        [npmCli, "sbom", "--omit=dev", "--sbom-format", "cyclonedx"],
        { cwd: root, encoding: "utf8" },
    );
    JSON.parse(sbom);
    fs.writeFileSync(path.join(target, "SBOM.cdx.json"), sbom);

    const protocolDirectory = path.join(target, "protocol-schemas");
    fs.mkdirSync(protocolDirectory, { recursive: true });
    const protocolSchemas: Record<string, ZodType> = {
        "client-hello": clientHelloEnvelopeSchema,
        "client-ping": clientPingEnvelopeSchema,
        "room-command": roomCommandEnvelopeSchema,
        "room-snapshot-request": snapshotRequestEnvelopeSchema,
        "room-settings": roomGameSettingsSchema,
        "protocol-error-code": protocolErrorCodeSchema,
        "participant-left-event": participantLeftEventPayloadSchema,
        "card-replaced-event": cardReplacedEventPayloadSchema,
    };
    for (const [name, schema] of Object.entries(protocolSchemas)) {
        const jsonSchema = z.toJSONSchema(schema);
        fs.writeFileSync(
            path.join(protocolDirectory, `${name}.schema.json`),
            `${JSON.stringify(jsonSchema, null, 2)}\n`,
        );
    }
    fs.writeFileSync(
        path.join(protocolDirectory, "manifest.json"),
        `${JSON.stringify(
            {
                protocolVersion: PROTOCOL_VERSION,
                schemas: Object.keys(protocolSchemas).map((name) => `${name}.schema.json`),
            },
            null,
            2,
        )}\n`,
    );

    const productionPaths = execFileSync(
        process.execPath,
        [npmCli, "ls", "--omit=dev", "--parseable", "--all"],
        {
            cwd: root,
            encoding: "utf8",
        },
    )
        .trim()
        .split(/\r?\n/)
        .filter((entry) => entry && entry !== root);
    for (const source of productionPaths) {
        const relative = path.relative(root, source);
        if (relative.startsWith("..")) continue;
        fs.mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
        fs.cpSync(source, path.join(target, relative), { recursive: true, dereference: false });
    }

    fs.mkdirSync(path.join(target, "runtime"), { recursive: true });
    fs.mkdirSync(path.join(target, "config"), { recursive: true });
    const runtimeName = process.platform === "win32" ? "node.exe" : "node";
    fs.copyFileSync(process.execPath, path.join(target, "runtime", runtimeName));
    fs.chmodSync(path.join(target, "runtime", runtimeName), 0o755);

    if (edition === "portable") {
        fs.mkdirSync(path.join(target, "data"), { recursive: true });
        fs.writeFileSync(
            path.join(target, "config", "settings.csv"),
            "DEPLOYMENT_MODE,local\nAUTH_MODE,none\nDB_TYPE,sqlite\nDB_FILE,data/game.sqlite\nHTTP_BIND,::\nHTTP_PORT,3000\n",
        );
    } else {
        fs.writeFileSync(
            path.join(target, "config", "settings.csv"),
            "DEPLOYMENT_MODE,public\nPUBLIC_RUNTIME_SECURITY,enforced\nAUTH_MODE,account\nDB_TYPE,mariadb\nHTTP_BIND,::\nHTTP_PORT,3000\n",
        );
    }

    if (process.platform === "win32") {
        fs.writeFileSync(
            path.join(target, "start.cmd"),
            "@echo off\r\ncd /d %~dp0\r\nset SETTINGS_FILE=config/settings.csv\r\nruntime\\node.exe app\\dist\\apps\\server\\src\\server.js\r\n",
        );
    } else {
        fs.writeFileSync(
            path.join(target, "start.sh"),
            '#!/bin/sh\ncd "$(dirname "$0")"\nexport SETTINGS_FILE=config/settings.csv\nexec runtime/node app/dist/apps/server/src/server.js\n',
            { mode: 0o755 },
        );
    }

    const releaseManifest = createServerWebReleaseManifest({
        version,
        edition,
        platform,
        architecture,
        nodeVersion: process.version,
        protocolVersion: PROTOCOL_VERSION,
    });
    fs.writeFileSync(
        path.join(target, "release-manifest.json"),
        `${JSON.stringify(releaseManifest, null, 2)}\n`,
    );

    fs.writeFileSync(path.join(target, "README.txt"), releaseReadme(edition, process.platform));

    console.log(target);
}
void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
