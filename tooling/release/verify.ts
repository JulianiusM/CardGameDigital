import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
    releaseVersionSchema,
    serverWebReleaseDirectoryName,
    serverWebReleaseManifestSchema,
    sourceRevisionSchema,
} from "./bundle";
import { verifyReleaseSet } from "./verification";

const version = releaseVersionSchema.parse(process.env.RELEASE_VERSION);
const sourceRevision = sourceRevisionSchema.parse(process.env.RELEASE_SOURCE_SHA);
const archives = fs.readdirSync("artifacts").filter((name) => name.endsWith(".tar.gz"));
const manifests = archives.map((archive) => {
    const manifest = serverWebReleaseManifestSchema.parse(
        JSON.parse(
            execFileSync(
                "tar",
                ["-xOf", path.join("artifacts", archive), "./release-manifest.json"],
                { encoding: "utf8" },
            ),
        ),
    );
    if (archive !== `${serverWebReleaseDirectoryName(manifest)}.tar.gz`)
        throw new Error("Archive name does not match its manifest");
    return manifest;
});
verifyReleaseSet(manifests, version, sourceRevision);
console.log("All seven release archives match the selected source, version, and protocol.");
