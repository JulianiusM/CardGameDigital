// esbuild.client.js
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isProd = process.env.NODE_ENV === 'production';
const enableWatch = process.argv.includes('--watch');

const srcDir = path.resolve(__dirname, 'src/public/js');
const outDir = isProd
    ? path.resolve(__dirname, 'dist/public/js')
    : path.resolve(__dirname, 'src/public/js');

function getTsFiles(dir) {
    return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return getTsFiles(fullPath); // recurse
        }
        return entry.isFile() && fullPath.endsWith(".ts") ? [fullPath] : [];
    });
}

const entryPoints = getTsFiles(srcDir);

const importPathRewritePlugin = {
    name: 'rewrite-imports-to-gen',
    setup(build) {
        build.onResolve({filter: /^[./]/}, args => {
            // Skip node_modules and absolute paths
            if (args.path.startsWith('.') || args.path.startsWith('/')) {
                const parsed = path.parse(args.path);

                // Ignore imports that already end in .ts, .js, or .gen.js
                if (parsed.ext) return;

                // Rewrite to *.gen.js
                return {
                    path: `${args.path}.gen.js`,
                    external: true // Treat as external to avoid bundling
                };
            }
        });
    }
};


async function build() {
    const ctx = await esbuild.context({
        entryPoints,
        bundle: true,
        outdir: outDir,
        sourcemap: true,
        outbase: srcDir,                 // <-- preserve folder structure
        entryNames: '[dir]/[name].gen',  // <-- keep subdirs in output
        target: ['es2020'],
        format: 'esm',
        platform: 'browser',
        globalName: 'Surveyor', // exposes your functions for pug
        logLevel: 'info',
        plugins: [importPathRewritePlugin],
        metafile: true,        // (optional) inspect what’s emitted
    });

    if (enableWatch) {
        await ctx.watch();
        console.log('Watching for changes...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

build().catch(() => process.exit(1));
