import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const clientRoot = path.resolve(root, "clients", "kodi");
const artifactsRoot = path.resolve(root, "artifacts");
const addonId = "script.partycard.tv";
const fixedDosDate = 0x21;
const fixedDosTime = 0;

function crc32(value: Buffer): number {
    let result = 0xffffffff;
    for (const byte of value) {
        result ^= byte;
        for (let bit = 0; bit < 8; bit += 1)
            result = (result & 1) !== 0 ? 0xedb88320 ^ (result >>> 1) : result >>> 1;
    }
    return (result ^ 0xffffffff) >>> 0;
}

function filesBelow(directory: string): string[] {
    return fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const target = path.join(directory, entry.name);
            return entry.isDirectory() ? filesBelow(target) : [target];
        })
        .filter((entry) => {
            const relative = path.relative(clientRoot, entry).replaceAll(path.sep, "/");
            return (
                !relative.startsWith("tests/") &&
                !relative.startsWith("tools/") &&
                !relative.includes("/__pycache__/") &&
                !relative.endsWith(".pyc")
            );
        })
        .sort((left, right) => left.localeCompare(right));
}

function deterministicZip(
    entries: readonly { name: string; data: Buffer; mode: number }[],
): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name, "utf8");
        const checksum = crc32(entry.data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt16LE(fixedDosTime, 10);
        local.writeUInt16LE(fixedDosDate, 12);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(entry.data.length, 18);
        local.writeUInt32LE(entry.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        localParts.push(local, name, entry.data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(0x0314, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(fixedDosTime, 12);
        central.writeUInt16LE(fixedDosDate, 14);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(entry.data.length, 20);
        central.writeUInt32LE(entry.data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(((entry.mode & 0xffff) << 16) >>> 0, 38);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, name);
        offset += local.length + name.length + entry.data.length;
    }
    const localData = Buffer.concat(localParts);
    const centralData = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralData.length, 12);
    end.writeUInt32LE(localData.length, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([localData, centralData, end]);
}

function addonVersion(): string {
    const manifest = fs.readFileSync(path.join(clientRoot, "addon.xml"), "utf8");
    const match = manifest.match(/<addon\s+[^>]*version="([^"]+)"/);
    if (!match) throw new Error("addon.xml does not declare a version");
    const version = process.env.KODI_VERSION ?? match[1];
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
        throw new Error("KODI_VERSION must be a semantic version");
    if (version !== match[1])
        throw new Error(`KODI_VERSION ${version} does not match addon.xml ${match[1]}`);
    return version;
}

function sha256(value: Buffer): string {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function packageAddon(): string {
    const version = addonVersion();
    const sources = filesBelow(clientRoot);
    const entries = sources.map((source) => ({
        name: `${addonId}/${path.relative(clientRoot, source).replaceAll(path.sep, "/")}`,
        data: fs.readFileSync(source),
        mode: ["addon.py", "game.py"].includes(path.basename(source)) ? 0o100755 : 0o100644,
    }));
    const zip = deterministicZip(entries);
    fs.mkdirSync(artifactsRoot, { recursive: true });
    const baseName = `${addonId}-${version}`;
    const zipPath = path.join(artifactsRoot, `${baseName}.zip`);
    fs.writeFileSync(zipPath, zip);
    const digest = sha256(zip);
    fs.writeFileSync(`${zipPath}.sha256`, `${digest}  ${path.basename(zipPath)}\n`);
    const fileHashes = entries.map(({ name, data }) => ({ path: name, sha256: sha256(data) }));
    const sbom = {
        bomFormat: "CycloneDX",
        specVersion: "1.5",
        serialNumber: `urn:uuid:${crypto.randomUUID()}`,
        version: 1,
        metadata: {
            component: { type: "application", name: addonId, version },
            tools: { components: [{ type: "application", name: "kodiRelease.ts" }] },
        },
        components: [
            {
                type: "framework",
                name: "xbmc.python",
                version: ">=3.0.1",
                licenses: [{ license: { id: "GPL-2.0-or-later" } }],
                scope: "required",
            },
            {
                type: "library",
                name: "embedded QR encoder",
                version: "1",
                licenses: [{ license: { id: "MIT" } }],
                scope: "required",
            },
        ],
    };
    const sbomPath = path.join(artifactsRoot, `${baseName}.cdx.json`);
    fs.writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);
    const provenance = {
        schemaVersion: 1,
        subject: { name: path.basename(zipPath), sha256: digest },
        source: { repository: "CardGameDigital", path: "clients/kodi" },
        build: { deterministicTimestamp: "1980-01-01T00:00:00Z", protocolVersion: 2 },
        files: fileHashes,
    };
    fs.writeFileSync(
        path.join(artifactsRoot, `${baseName}.provenance.json`),
        `${JSON.stringify(provenance, null, 2)}\n`,
    );
    verifyZip(zipPath);
    console.log(zipPath);
    return zipPath;
}

interface ZipEntry {
    name: string;
    compressionMethod: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
}

function zipEntries(zip: Buffer): ZipEntry[] {
    const signature = 0x06054b50;
    let endOffset = -1;
    for (let index = Math.max(0, zip.length - 65_557); index <= zip.length - 22; index += 1) {
        if (zip.readUInt32LE(index) === signature) endOffset = index;
    }
    if (endOffset < 0) throw new Error("ZIP end-of-central-directory record is missing");
    const count = zip.readUInt16LE(endOffset + 10);
    let cursor = zip.readUInt32LE(endOffset + 16);
    const entries: ZipEntry[] = [];
    for (let index = 0; index < count; index += 1) {
        if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid ZIP directory entry");
        const nameLength = zip.readUInt16LE(cursor + 28);
        const extraLength = zip.readUInt16LE(cursor + 30);
        const commentLength = zip.readUInt16LE(cursor + 32);
        entries.push({
            name: zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
            compressionMethod: zip.readUInt16LE(cursor + 10),
            compressedSize: zip.readUInt32LE(cursor + 20),
            uncompressedSize: zip.readUInt32LE(cursor + 24),
            localHeaderOffset: zip.readUInt32LE(cursor + 42),
        });
        cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

function zipEntryData(zip: Buffer, entry: ZipEntry): Buffer {
    const offset = entry.localHeaderOffset;
    if (offset + 30 > zip.length || zip.readUInt32LE(offset) !== 0x04034b50)
        throw new Error(`Invalid ZIP local entry: ${entry.name}`);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const dataOffset = offset + 30 + nameLength + extraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (dataEnd > zip.length) throw new Error(`Truncated ZIP entry: ${entry.name}`);
    const compressed = zip.subarray(dataOffset, dataEnd);
    let data: Buffer;
    if (entry.compressionMethod === 0) data = Buffer.from(compressed);
    else if (entry.compressionMethod === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP compression for ${entry.name}`);
    if (data.length !== entry.uncompressedSize)
        throw new Error(`Invalid uncompressed size for ZIP entry: ${entry.name}`);
    return data;
}

function xmlAttribute(attributes: string, name: string): string | undefined {
    const expression = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
    const match = expression.exec(attributes);
    return match?.[1] ?? match?.[2];
}

function verifyProductionManifest(manifestBytes: Buffer): void {
    const manifest = manifestBytes.toString("utf8").replace(/^\uFEFF/, "");
    const addon = /<addon\b([^>]*)>/i.exec(manifest);
    if (!addon || xmlAttribute(addon[1], "id") !== addonId)
        throw new Error("Kodi ZIP manifest has the wrong add-on ID");

    const withoutComments = manifest.replace(/<!--[\s\S]*?-->/g, "");
    const extensionPattern =
        /<extension\b([^>]*)\/\s*>|<extension\b([^>]*)>([\s\S]*?)<\/extension\s*>/gi;
    const extensions: { attributes: string; body: string }[] = [];
    for (const match of withoutComments.matchAll(extensionPattern)) {
        extensions.push({ attributes: match[1] ?? match[2] ?? "", body: match[3] ?? "" });
    }
    const runtimeExtensions = extensions.filter(
        ({ attributes }) => xmlAttribute(attributes, "point") !== "xbmc.addon.metadata",
    );
    if (runtimeExtensions.length !== 2)
        throw new Error("Kodi ZIP manifest must expose exactly the Game plugin and script");
    const [plugin, script] = runtimeExtensions;
    if (extensions[0] !== plugin || extensions[1] !== script)
        throw new Error("Kodi ZIP Game plugin and script must be the first extensions");
    if (
        xmlAttribute(plugin.attributes, "point") !== "xbmc.python.pluginsource" ||
        xmlAttribute(plugin.attributes, "library") !== "game.py"
    )
        throw new Error("Kodi ZIP Game plugin must launch game.py");
    const pluginProvides = Array.from(
        plugin.body.matchAll(/<provides\b[^>]*>([\s\S]*?)<\/provides\s*>/gi),
    );
    if (
        pluginProvides.length !== 1 ||
        pluginProvides[0][1].trim().split(/\s+/).join(" ") !== "game"
    )
        throw new Error("Kodi ZIP Game plugin must provide only game content");
    if (
        xmlAttribute(script.attributes, "point") !== "xbmc.python.script" ||
        xmlAttribute(script.attributes, "library") !== "addon.py"
    )
        throw new Error("Kodi ZIP script extension must launch addon.py");
    const scriptProvides = Array.from(
        script.body.matchAll(/<provides\b[^>]*>([\s\S]*?)<\/provides\s*>/gi),
    );
    if (
        scriptProvides.length !== 1 ||
        scriptProvides[0][1].trim().split(/\s+/).join(" ") !== "executable"
    )
        throw new Error("Kodi ZIP script must provide only executable content");
}

function verifyZip(zipPath: string): void {
    const resolved = path.resolve(zipPath);
    if (path.dirname(resolved) !== artifactsRoot)
        throw new Error("Kodi release ZIP must be an immediate artifact child");
    const zip = fs.readFileSync(resolved);
    const entries = zipEntries(zip);
    const names = entries.map(({ name }) => name);
    if (
        !names.includes(`${addonId}/addon.xml`) ||
        !names.includes(`${addonId}/game.py`) ||
        !names.includes(`${addonId}/addon.py`)
    )
        throw new Error("Kodi ZIP is missing its manifest, Game plugin, or script entry point");
    const forbidden = names.find(
        (name) =>
            !name.startsWith(`${addonId}/`) ||
            name.includes("\\") ||
            name.includes("../") ||
            name.includes("/__pycache__/") ||
            name.includes("/tests/") ||
            name.includes("/tools/") ||
            name.endsWith(".pyc") ||
            /(?:credential|token|secret|settings\.json)$/i.test(name),
    );
    if (forbidden) throw new Error(`Forbidden release entry: ${forbidden}`);
    if (new Set(names).size !== names.length) throw new Error("Kodi ZIP contains duplicate paths");
    const manifest = entries.find(({ name }) => name === `${addonId}/addon.xml`);
    if (!manifest) throw new Error("Kodi ZIP is missing its add-on manifest");
    verifyProductionManifest(zipEntryData(zip, manifest));
}

const command = process.argv[2] ?? "package";
if (command === "package") packageAddon();
else if (command === "verify") {
    const zipPath = process.argv[3];
    if (!zipPath) throw new Error("Usage: kodiRelease.ts verify <artifact.zip>");
    verifyZip(zipPath);
    console.log(path.resolve(zipPath));
} else throw new Error("Usage: kodiRelease.ts <package|verify>");
