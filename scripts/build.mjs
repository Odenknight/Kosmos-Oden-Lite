/**
 * Kosmos-Oden build (§21).
 *
 * Modular TypeScript source -> bundled, fully inlined artifacts:
 *
 *   dist/kosmos-core.mjs          ESM bundle of the shared Kosmos Core
 *                                 (consumed by kosmos-build.mjs and tests)
 *   dist/kosmos-agent-server.mjs  ESM bundle of the Agent API server core
 *                                 (consumed by tests)
 *   dist/kosmos-embed.html        single-file page for the plugin iframe
 *   vault-kosmos.html             single-file STANDALONE viewer (repo root)
 *   main.js                       Obsidian plugin bundle (embeds the iframe page)
 *
 * Every artifact bundles Three.js (exact-pinned ESM `three`, esbuild-bundled
 * into the app), all JS and all CSS. No CDN, no external runtime URL, works
 * from file:// (§2.1). Renderer provenance is recorded in renderer-provenance.json.
 *
 * Usage:
 *   node scripts/build.mjs                  full build
 *   node scripts/build.mjs --standalone-only
 *   node scripts/build.mjs --for-tests      core + agent-server bundles only
 *   node scripts/build.mjs --dev            full build, unminified with sourcemaps disabled
 */
import esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const production = !args.has("--dev");
const forTests = args.has("--for-tests");
const standaloneOnly = args.has("--standalone-only");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const VERSION = pkg.version;

mkdirSync(resolve(root, "dist"), { recursive: true });

/** Inline-script hardening: '</script' inside JS strings would close the tag. */
const escapeInline = (js) => js.replace(/<\/script/gi, "<\\/script");

async function bundle(entry, opts = {}) {
  const res = await esbuild.build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    write: false,
    format: opts.format ?? "iife",
    platform: opts.platform ?? "browser",
    target: "es2020",
    minify: production,
    sourcemap: false,
    logLevel: "silent",
    ...opts.extra,
  });
  return res.outputFiles[0].text;
}

async function buildNodeBundles() {
  const core = await bundle("src/core/index.ts", { format: "esm", platform: "neutral", extra: { minify: false } });
  writeFileSync(resolve(root, "dist/kosmos-core.mjs"), core);
  const agent = await bundle("src/plugin/agent-server.ts", { format: "esm", platform: "node", extra: { minify: false } });
  writeFileSync(resolve(root, "dist/kosmos-agent-server.mjs"), agent);
  // cosmology + layout are DOM-free, so the classification/packing pipeline is testable in Node
  const layout = await bundle("src/renderer/layout.ts", { format: "esm", platform: "neutral", extra: { minify: false } });
  writeFileSync(resolve(root, "dist/kosmos-layout.mjs"), layout);
  // host<->renderer protocol validation is DOM-free and unit-testable
  const protocol = await bundle("src/plugin/protocol.ts", { format: "esm", platform: "neutral", extra: { minify: false } });
  writeFileSync(resolve(root, "dist/kosmos-protocol.mjs"), protocol);
  const nextcloudSync = await bundle("src/plugin/nextcloud-sync-test-entry.ts", { format: "esm", platform: "neutral", extra: { minify: false } });
  writeFileSync(resolve(root, "dist/kosmos-nextcloud-sync.mjs"), nextcloudSync);
  console.log("built dist/kosmos-core.mjs, dist/kosmos-agent-server.mjs, dist/kosmos-layout.mjs, dist/kosmos-protocol.mjs, dist/kosmos-nextcloud-sync.mjs");
}

const RENDERER_PROVENANCE = JSON.parse(readFileSync(resolve(root, "renderer-provenance.json"), "utf8"));

function composePage(title, appJs) {
  const css = readFileSync(resolve(root, "src/renderer/kosmos.css"), "utf8");
  const body = readFileSync(resolve(root, "src/renderer/kosmos-body.html"), "utf8");
  // Three.js is now an ESM dependency bundled into appJs by esbuild — no separate
  // vendored <script> and no CDN. A diagnostic build marker records the renderer.
  const marker = `three r${RENDERER_PROVENANCE.threeRevision} ${RENDERER_PROVENANCE.stableBackend} webgl${RENDERER_PROVENANCE.webglVersion}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<meta name="kosmos-renderer" content="${marker}" />
<title>${title}</title>
<style>
${css}
</style>
</head>
<body>
<!-- Kosmos renderer: ${marker} (Three.js bundled from the exact-pinned npm module; no CDN, no runtime fetch) -->
${body}
<script>
${escapeInline(appJs)}
</script>
</body>
</html>
`;
}

async function buildStandalone() {
  const app = await bundle("src/standalone/standalone.ts");
  const html = composePage(`Vault Kosmos ${VERSION} — Standalone`, app);
  writeFileSync(resolve(root, "vault-kosmos.html"), html);
  console.log(`built vault-kosmos.html (${(html.length / 1024).toFixed(0)} KB, single file)`);
}

async function buildEmbed() {
  const app = await bundle("src/plugin/embed.ts");
  const html = composePage(`Vault Kosmos ${VERSION} (plugin)`, app);
  writeFileSync(resolve(root, "dist/kosmos-embed.html"), html);
  console.log(`built dist/kosmos-embed.html (${(html.length / 1024).toFixed(0)} KB)`);
}

async function buildPlugin() {
  await esbuild.build({
    entryPoints: [resolve(root, "src/plugin/main.ts")],
    bundle: true,
    format: "cjs",
    target: "es2018",
    platform: "browser",
    // Provided by Obsidian at runtime — never bundle these:
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", "node:*"],
    loader: { ".html": "base64" },
    sourcemap: production ? false : "inline",
    minify: production,
    treeShaking: true,
    outfile: resolve(root, "main.js"),
    logLevel: "info",
  });
  console.log("built main.js");
}

try {
  if (forTests) {
    await buildNodeBundles();
    await buildStandalone(); // artifact checks are part of the test suite (§25)
  } else if (standaloneOnly) {
    await buildStandalone();
  } else {
    await buildNodeBundles();
    await buildEmbed();     // must precede the plugin bundle (main.ts imports it)
    await buildStandalone();
    await buildPlugin();
  }
} catch (e) {
  console.error(e);
  process.exit(1);
}
