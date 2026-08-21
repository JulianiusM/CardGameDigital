import fs from "node:fs";
import path from "node:path";

/**
 * What we generate:
 *   - One file: src/modules/database/index.ts
 *   - Exports: export const entities = [...]; export const migrations = [...]; export const subscribers = [...];
 *
 * Key feature:
 *   - For migrations, we parse the file to find the exported class name (TypeORM uses special names).
 *   - For entities/subscribers, we also parse for exported classes to be robust (decorators/interfaces).
 */

type SectionConfig = {
    key: "entities" | "migrations" | "subscribers" | (string & {});
    dir: string;                 // directory to scan
    filePattern?: RegExp;        // files to include
    exclude?: string[];          // filenames to skip
    // Heuristic for which classes to collect from a file:
    //   - "decorator:Entity" => class with @Entity decorator
    //   - "interface:MigrationInterface" => class implements MigrationInterface
    //   - "decorator:EventSubscriber" or "interface:EntitySubscriberInterface"
    matchStrategy: "decorator:Entity" | "interface:MigrationInterface" | "decorator:EventSubscriber" | "interface:EntitySubscriberInterface";
    // Optional: keep a stable order (e.g. for migrations by filename)
    sortBy?: "filenameAsc";
};

// ---- Central, extensible config (add more sections later if you want) ----
const CONFIG: SectionConfig[] = [
    {
        key: "entities",
        dir: "src/modules/database/entities",
        exclude: ["index.ts"],
        filePattern: /\.ts$/,
        matchStrategy: "decorator:Entity",
    },
    {
        key: "migrations",
        dir: "src/migrations",
        filePattern: /\.ts$/,
        matchStrategy: "interface:MigrationInterface",
        sortBy: "filenameAsc",
    },
    {
        key: "subscribers",
        dir: "src/modules/database/subscribers",
        exclude: ["index.ts"],
        filePattern: /\.ts$/,
        // support both styles for subscribers
        matchStrategy: "interface:EntitySubscriberInterface",
    },
];

const OUTPUT_FILE = path.resolve("src/modules/database/__index__.ts");

type ExportSymbol = {
    name: string;
    isDefault: boolean;
    importPath: string; // path WITHOUT extension, relative to OUTPUT_FILE dir
};

function readFileOrNull(p: string): string | null {
    try {
        return fs.readFileSync(p, "utf8");
    } catch {
        return null;
    }
}

function collectFiles(dir: string, filePattern: RegExp, exclude: string[] = []): string[] {
    const result: string[] = [];
    if (!fs.existsSync(dir)) return result;

    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...collectFiles(full, filePattern, exclude));
        } else if (entry.isFile() && filePattern.test(entry.name) && !exclude.includes(entry.name)) {
            result.push(full);
        }
    }
    return result;
}

/**
 * Extract exported class names robustly by reading the TS source.
 * Handles:
 *   export class Foo implements MigrationInterface { ... }
 *   export default class Bar implements MigrationInterface { ... }
 *   export class User { @Column() ... } // and has @Entity
 */
function extractExportsByStrategy(tsCode: string, strategy: SectionConfig["matchStrategy"]): {
    name: string;
    isDefault: boolean
}[] {
    const results: { name: string; isDefault: boolean }[] = [];

    // Normalize spacing a bit
    const code = tsCode.replace(/\r\n/g, "\n");

    const add = (name: string, isDefault = false) => {
        if (name) results.push({name, isDefault});
    };

    switch (strategy) {
        case "interface:MigrationInterface": {
            // Named export: export class Foo implements MigrationInterface
            const reNamed = /export\s+class\s+([A-Za-z0-9_]+)\s+implements\s+MigrationInterface\b/g;
            // Default export: export default class Foo implements MigrationInterface
            const reDefault = /export\s+default\s+class\s+([A-Za-z0-9_]+)\s+implements\s+MigrationInterface\b/g;

            let m: RegExpExecArray | null;
            while ((m = reNamed.exec(code))) add(m[1], false);
            while ((m = reDefault.exec(code))) add(m[1], true);
            break;
        }

        case "decorator:Entity": {
            // Heuristic: find classes with @Entity decorator
            // Matches e.g.:
            //   @Entity() export class User { ... }
            //   @Entity('table') export default class User { ... }
            // Two passes: default and named
            const reDefault = /@Entity\s*\([^)]*\)\s*export\s+default\s+class\s+([A-Za-z0-9_]+)/g;
            const reNamed = /@Entity\s*\([^)]*\)\s*export\s+class\s+([A-Za-z0-9_]+)/g;
            const reDefaultNoArg = /@Entity\s*\(\s*\)\s*export\s+default\s+class\s+([A-Za-z0-9_]+)/g;
            const reNamedNoArg = /@Entity\s*\(\s*\)\s*export\s+class\s+([A-Za-z0-9_]+)/g;

            let m: RegExpExecArray | null;
            while ((m = reDefault.exec(code))) add(m[1], true);
            while ((m = reNamed.exec(code))) add(m[1], false);
            while ((m = reDefaultNoArg.exec(code))) add(m[1], true);
            while ((m = reNamedNoArg.exec(code))) add(m[1], false);

            // Fallback: if file imports Entity and has export class X { ... }, accept it
            if (results.length === 0 && /\bfrom\s+["']typeorm["']/.test(code) && /\bEntity\b/.test(code)) {
                const reAnyExport = /export\s+(?:default\s+)?class\s+([A-Za-z0-9_]+)/g;
                let n: RegExpExecArray | null;
                while ((n = reAnyExport.exec(code))) add(n[1], /export\s+default\s+class/.test(n[0]));
            }

            break;
        }

        case "decorator:EventSubscriber": {
            const reDefault = /@EventSubscriber\s*\([^)]*\)\s*export\s+default\s+class\s+([A-Za-z0-9_]+)/g;
            const reNamed = /@EventSubscriber\s*\([^)]*\)\s*export\s+class\s+([A-Za-z0-9_]+)/g;
            const reDefaultNoArg = /@EventSubscriber\s*\(\s*\)\s*export\s+default\s+class\s+([A-Za-z0-9_]+)/g;
            const reNamedNoArg = /@EventSubscriber\s*\(\s*\)\s*export\s+class\s+([A-Za-z0-9_]+)/g;

            let m: RegExpExecArray | null;
            while ((m = reDefault.exec(code))) add(m[1], true);
            while ((m = reNamed.exec(code))) add(m[1], false);
            while ((m = reDefaultNoArg.exec(code))) add(m[1], true);
            while ((m = reNamedNoArg.exec(code))) add(m[1], false);
            break;
        }

        case "interface:EntitySubscriberInterface": {
            const reNamed = /export\s+class\s+([A-Za-z0-9_]+)\s+implements\s+EntitySubscriberInterface\b/g;
            const reDefault = /export\s+default\s+class\s+([A-Za-z0-9_]+)\s+implements\s+EntitySubscriberInterface\b/g;
            let m: RegExpExecArray | null;
            while ((m = reNamed.exec(code))) add(m[1], false);
            while ((m = reDefault.exec(code))) add(m[1], true);

            // Fallback to decorator form:
            if (results.length === 0) {
                const reEventSubNamed = /@EventSubscriber[\s\S]*?export\s+class\s+([A-Za-z0-9_]+)/g;
                const reEventSubDefault = /@EventSubscriber[\s\S]*?export\s+default\s+class\s+([A-Za-z0-9_]+)/g;
                while ((m = reEventSubNamed.exec(code))) add(m[1], false);
                while ((m = reEventSubDefault.exec(code))) add(m[1], true);
            }
            break;
        }
    }

    return results;
}

function toImportPath(fromFile: string, targetFile: string): string {
    const rel = path
        .relative(path.dirname(fromFile), targetFile)
        .replace(/\\/g, "/")
        .replace(/\.(ts|js)x?$/, ""); // drop extension
    return rel.startsWith(".") ? rel : "./" + rel;
}

function processSection(section: SectionConfig): ExportSymbol[] {
    const {dir, filePattern = /\.ts$/, exclude = [], sortBy} = section;
    const absDir = path.resolve(dir);
    let files = collectFiles(absDir, filePattern, exclude);

    if (sortBy === "filenameAsc") {
        files = files.sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: "base"}));
    }

    const symbols: ExportSymbol[] = [];
    for (const file of files) {
        const code = readFileOrNull(file);
        if (!code) continue;
        const matches = extractExportsByStrategy(code, section.matchStrategy);
        for (const m of matches) {
            symbols.push({
                name: m.name,
                isDefault: m.isDefault,
                importPath: toImportPath(OUTPUT_FILE, file),
            });
        }
    }
    return symbols;
}

function generate() {
    const allImports: string[] = [];
    const sectionExports: string[] = [];

    for (const section of CONFIG) {
        const symbols = processSection(section);

        // De-duplicate in case of re-exports, keep first occurrence
        const seen = new Set<string>();
        const filtered = symbols.filter((s) => {
            const key = `${s.importPath}::${s.name}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const importLines = filtered.map((s) =>
            s.isDefault
                ? `import ${s.name} from "${s.importPath}";`
                : `import { ${s.name} } from "${s.importPath}";`
        );

        allImports.push(...importLines);

        const namesList = filtered.map((s) => s.name).join(", ");
        sectionExports.push(`export const ${section.key} = [${namesList}];`);

        console.log(`✅ ${section.key}: ${filtered.length} items from ${section.dir}`);
    }

    const header = `// ⚠️ AUTO-GENERATED FILE — do not edit manually.\n`;
    const output = `${header}${allImports.join("\n")}\n\n${sectionExports.join("\n\n")}\n`;
    fs.mkdirSync(path.dirname(OUTPUT_FILE), {recursive: true});
    fs.writeFileSync(OUTPUT_FILE, output, "utf8");

    console.log(`\n✅ Wrote combined index to ${OUTPUT_FILE}`);
}

generate();
