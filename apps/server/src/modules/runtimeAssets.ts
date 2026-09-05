import fs from "node:fs";
import path from "node:path";

type RuntimeAssetPathOptions = {
    moduleDirectory?: string;
    workingDirectory?: string;
};

/**
 * Resolves an asset copied beside the compiled server while retaining source-mode
 * execution from the repository root.
 */
export function resolveRuntimeAssetPath(
    relativePath: string,
    options: RuntimeAssetPathOptions = {},
): string {
    const moduleDirectory = options.moduleDirectory ?? __dirname;
    const workingDirectory = options.workingDirectory ?? process.cwd();
    const candidates = [
        path.resolve(moduleDirectory, "../../../..", relativePath),
        path.resolve(workingDirectory, "dist", relativePath),
        path.resolve(workingDirectory, relativePath),
    ];

    return candidates.find(fs.existsSync) ?? candidates[0];
}
