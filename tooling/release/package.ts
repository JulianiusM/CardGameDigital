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
    MANAGED_NODE_VERSION,
    portableExecutableName,
    removeExistingReleaseTarget,
    releaseEditionSchema,
    releaseVersionSchema,
    serverWebArchitectureSchema,
    serverWebReleaseDirectoryName,
    serverWebPlatformSchema,
} from "./bundle";
import { PUBLIC_NPM_CONFIG, releaseEntrypoint, releaseSettings } from "./entrypoint";
import { createPortableExecutable } from "./executable";

function releaseReadme(edition: "portable" | "public", platform: NodeJS.Platform): string {
    if (edition === "portable") {
        return `Extract the whole archive into a writable directory and start ${portableExecutableName(platform)}. Open http://localhost:3000/play/. No installation, internet, Node.js, npm, database service, or configuration is required. Keep the data directory when upgrading. Settings in SETTINGS_FILE and environment variables override config/settings.csv.\n`;
    }
    return `Managed public application: start with your installed Node ${MANAGED_NODE_VERSION} process using node /absolute/path/to/main.cjs. This archive contains no runtime or node_modules. Preserve the hidden .npmrc and run npm ci in the extracted directory before startup. It omits development and optional packages and disables install scripts. For external provisioning use npm ci --omit=dev --omit=optional --ignore-scripts and expose node_modules through an ancestor directory or NODE_PATH. No compiler or native npm binding is required; Node provides Argon2id and catalog SQLite internally. No npm command runs at application startup.\n\nPublic/account/MariaDB defaults and enforced security load automatically. Configure DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, PUBLIC_URL (HTTPS), SESSION_SECRET, ROOM_CREATE_SECRET, TRUST_PROXY and SMTP through SETTINGS_FILE or the service environment. The default bind is 127.0.0.1:3000; override HTTP_BIND for a remote reverse proxy. Use a persistent, writable service working directory outside this release for runtime key files and keep database/backups outside releases. OIDC is optional. See config/settings.csv and docs/contracts/infrastructure.md for configuration requirements.\n`;
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
    const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
    }).trim();
    if (process.env.RELEASE_SOURCE_SHA && process.env.RELEASE_SOURCE_SHA !== sourceRevision) {
        throw new Error("Release checkout does not match the selected source revision");
    }
    const releaseManifest = createServerWebReleaseManifest({
        version,
        edition,
        platform,
        architecture,
        sourceRevision,
        nodeVersion: process.version,
        protocolVersion: PROTOCOL_VERSION,
    });
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
    for (const directory of ["apps/server", "packages", "web", "catalog", "docs/user-guide"]) {
        fs.cpSync(path.join(root, "dist", directory), path.join(target, "app", "dist", directory), {
            recursive: true,
            filter: (source) => !source.endsWith(".map"),
        });
    }
    fs.copyFileSync(path.join(root, "LICENSE.md"), path.join(target, "LICENSE.md"));

    const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    delete sourcePackage.devDependencies;
    delete sourcePackage.scripts;
    sourcePackage.version = version;
    sourcePackage.main = "main.cjs";
    sourcePackage.engines = { node: MANAGED_NODE_VERSION };
    if (edition === "public") delete sourcePackage.dependencies["better-sqlite3"];
    const lockfile = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    lockfile.version = version;
    lockfile.packages[""].version = version;
    if (edition === "public") {
        lockfile.packages[""].dependencies = sourcePackage.dependencies;
        delete lockfile.packages[""].devDependencies;
        // Remove omitted tooling before npm resolves optional peers. Otherwise an
        // orphaned ts-node entry can cause npm to select a new TypeScript compiler.
        for (const [name, metadata] of Object.entries(lockfile.packages)) {
            const dependency = metadata as {
                dev?: boolean;
                optional?: boolean;
                devOptional?: boolean;
            };
            if (
                name === "node_modules/better-sqlite3" ||
                dependency.dev ||
                dependency.optional ||
                dependency.devOptional
            )
                delete lockfile.packages[name];
        }
    }
    fs.writeFileSync(
        path.join(target, "package-lock.json"),
        `${JSON.stringify(lockfile, null, 2)}\n`,
    );
    fs.writeFileSync(
        path.join(target, "package.json"),
        `${JSON.stringify(sourcePackage, null, 2)}\n`,
    );
    fs.writeFileSync(
        path.join(target, "app", "package.json"),
        `${JSON.stringify(sourcePackage, null, 2)}\n`,
    );

    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error("Release packaging must run through an npm script");
    if (edition === "public") {
        fs.writeFileSync(path.join(target, ".npmrc"), PUBLIC_NPM_CONFIG);
        // Derive the public graph from the source lock without installing packages.
        // npm prunes local SQLite and build dependencies, retaining locked versions.
        execFileSync(
            process.execPath,
            [
                npmCli,
                "install",
                "--package-lock-only",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
            ],
            { cwd: target, stdio: "pipe" },
        );
        const publicLock = JSON.parse(
            fs.readFileSync(path.join(target, "package-lock.json"), "utf8"),
        );
        for (const [name, metadata] of Object.entries(publicLock.packages)) {
            if (!name) continue;
            const locked = metadata as { version?: string; resolved?: string; integrity?: string };
            const original = lockfile.packages[name];
            if (
                !original ||
                locked.version !== original.version ||
                locked.resolved !== original.resolved ||
                locked.integrity !== original.integrity
            )
                throw new Error(`Public dependency changed from the source lock: ${name}`);
        }
    }
    const sbom = execFileSync(
        process.execPath,
        [
            npmCli,
            "sbom",
            "--omit=dev",
            ...(edition === "public" ? ["--omit=optional", "--package-lock-only"] : []),
            "--sbom-format",
            "cyclonedx",
        ],
        { cwd: edition === "public" ? target : root, encoding: "utf8" },
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

    fs.mkdirSync(path.join(target, "config"), { recursive: true });
    fs.writeFileSync(path.join(target, "config", "settings.csv"), releaseSettings(edition));
    if (edition === "portable") {
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
        createPortableExecutable(target);
        fs.mkdirSync(path.join(target, "data"), { recursive: true });
    } else {
        fs.writeFileSync(path.join(target, "main.cjs"), releaseEntrypoint("public"));
        fs.mkdirSync(path.join(target, "docs/contracts"), { recursive: true });
        for (const document of [
            "infrastructure.md",
            "operational-settings.md",
            "release-bundles.md",
        ]) {
            fs.copyFileSync(
                path.join(root, "docs/contracts", document),
                path.join(target, "docs/contracts", document),
            );
        }
    }
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
