import esbuild from "esbuild";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const baseline = readFileSync(resolve(root, "main.js"));
const result = { baseline: sizes(baseline), adapters: {} };
const existing = await esbuild.build({ entryPoints: [resolve(root, "src/plugin/nextcloud-sync.ts")], bundle: true, write: false, minify: true, platform: "browser", target: "es2018", external: ["obsidian"], treeShaking: true, logLevel: "silent" });
result.existingNextcloudModule = sizes(existing.outputFiles[0].contents);
for (const name of ["onedrive", "dropbox", "s3"]) {
  const built = await esbuild.build({ entryPoints: [resolve(import.meta.dirname, `${name}.ts`)], bundle: true, write: false, minify: true, platform: "browser", target: "es2020", treeShaking: true, logLevel: "silent" });
  result.adapters[name] = sizes(built.outputFiles[0].contents);
}
result.leanRest = {};
for (const name of ["google-rest", "onedrive-rest", "dropbox-rest", "s3-rest", "all-rest"]) {
  const built = await esbuild.build({ entryPoints: [resolve(import.meta.dirname, `${name}.ts`)], bundle: true, write: false, minify: true, platform: "browser", target: "es2020", treeShaking: true, logLevel: "silent" });
  result.leanRest[name] = sizes(built.outputFiles[0].contents);
}
function sizes(bytes) { return { raw: bytes.byteLength, gzip: gzipSync(bytes, { level: 9 }).byteLength, brotli: brotliCompressSync(bytes).byteLength }; }
console.log(JSON.stringify(result, null, 2));
