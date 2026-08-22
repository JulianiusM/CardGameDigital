import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";

export default defineConfig({
    root: path.resolve("apps/web"),
    base: "/play/",
    plugins: [svelte()],
    build: { outDir: path.resolve("dist/web"), emptyOutDir: true },
    server: { proxy: { "/api": "http://127.0.0.1:3000" } },
});
