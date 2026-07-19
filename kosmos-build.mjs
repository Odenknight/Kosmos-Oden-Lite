#!/usr/bin/env node
/**
 * kosmos-build — build a Kosmos graph (and optionally Graphiti episodes) from
 * a Markdown vault on disk, using the SAME shared Kosmos Core semantics as the
 * Obsidian plugin, the standalone viewer and the Agent API (§14, §39).
 *
 *   node kosmos-build.mjs /path/to/vault graph.json
 *   node kosmos-build.mjs /path/to/vault graph.json --episodes graphiti-episodes.json
 *        --group-id my-governed-vault-namespace
 *   node kosmos-build.mjs /path/to/vault graph.json --watch
 *
 * graph.json can be placed next to vault-kosmos.html (served over http) to
 * auto-load, or handed to any consumer of the Kosmos graph shape.
 *
 * Requires `npm run build` once (dist/kosmos-core.mjs); the repository ships
 * with the bundle prebuilt.
 */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const coreUrl = new URL("./dist/kosmos-core.mjs", import.meta.url);
let core;
try {
  core = await import(coreUrl.href);
} catch (e) {
  console.error("kosmos-build: dist/kosmos-core.mjs not found — run `npm run build` first.");
  process.exit(1);
}

const {
  KOSMOS_VERSION,
  buildGraph,
  buildGraphitiEpisodesWithContent,
  isAttachmentPath,
  isNotePath,
  shouldIgnoreVaultPath,
  stripFrontmatter,
} = core;

/* ---------------- CLI parsing ---------------- */
const argv = process.argv.slice(2);
const flags = new Set();
const opts = { episodes: null, groupId: null };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--watch") flags.add("watch");
  else if (a === "--episodes") opts.episodes = argv[++i];
  else if (a === "--group-id") opts.groupId = argv[++i];
  else if (a === "--help" || a === "-h") flags.add("help");
  else positional.push(a);
}
if (flags.has("help") || positional.length < 1) {
  console.log(`kosmos-build v${KOSMOS_VERSION}
Usage:
  node kosmos-build.mjs <vault-dir> [graph.json] [--episodes <episodes.json>] [--group-id <stable-namespace>] [--watch]`);
  process.exit(flags.has("help") ? 0 : 1);
}
const vaultDir = resolve(positional[0]);
const graphOut = resolve(positional[1] || "graph.json");
const episodesOut = opts.episodes ? resolve(opts.episodes) : null;

/* ---------------- read-only vault scan (same ignore rules as every surface) ---------------- */
async function scanVault(dir) {
  const files = [];
  const attachments = [];
  const folders = [];
  async function walk(abs, rel) {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (shouldIgnoreVaultPath(childRel)) continue;
      const childAbs = join(abs, e.name);
      if (e.isDirectory()) {
        folders.push(childRel);
        await walk(childAbs, childRel);
      } else if (e.isFile()) {
        if (isNotePath(childRel)) {
          const [content, st] = await Promise.all([readFile(childAbs, "utf8"), stat(childAbs)]);
          files.push({
            relativePath: childRel,
            name: e.name,
            size: st.size,
            modifiedTime: st.mtimeMs,
            createdTime: st.birthtimeMs || st.mtimeMs,
            content,
            kind: "note",
          });
        } else if (isAttachmentPath(childRel)) {
          attachments.push(childRel);
        }
      }
    }
  }
  await walk(dir, "");
  return { files, attachments, folders };
}

async function buildOnce() {
  const t0 = Date.now();
  const { files, attachments, folders } = await scanVault(vaultDir);
  const graph = buildGraph(files, folders);
  graph.diagnostics.attachments = attachments.length;
  const out = {
    kosmos: KOSMOS_VERSION,
    vault: basename(vaultDir),
    nodes: graph.nodes,
    links: graph.links,
    stats: graph.stats,
    areas: graph.areas,
    tags: graph.tags,
    statuses: graph.statuses,
    types: graph.types,
    diagnostics: graph.diagnostics,
    attachments,
  };
  await writeFile(graphOut, JSON.stringify(out, null, 2));
  console.log(`kosmos-build: ${files.length} notes, ${folders.length} folders, ${attachments.length} attachments -> ${graphOut} (${Date.now() - t0} ms)`);
  for (const w of graph.diagnostics.lineageWarnings) console.warn("  lineage:", w);

  if (episodesOut) {
    const contents = new Map(files.map((f) => [f.relativePath, stripFrontmatter(f.content)]));
    const episodes = buildGraphitiEpisodesWithContent(graph, contents, {
      vault: basename(vaultDir),
      vaultIdentity: vaultDir,
      groupId: opts.groupId || undefined,
    });
    await writeFile(episodesOut, JSON.stringify(episodes, null, 2));
    console.log(`kosmos-build: ${episodes.length} Graphiti episodes -> ${episodesOut}`);
  }
}

await buildOnce();

if (flags.has("watch")) {
  console.log("kosmos-build: watching for changes (Ctrl+C to stop)…");
  let timer = null;
  const trigger = (event, name) => {
    if (name && shouldIgnoreVaultPath(String(name).replace(/\\/g, "/"))) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      buildOnce().catch((e) => console.error("kosmos-build:", e.message));
    }, 400);
  };
  try {
    watch(vaultDir, { recursive: true }, trigger);
  } catch {
    // recursive watch unavailable on this platform/filesystem: poll instead
    console.log("kosmos-build: recursive watch unavailable, polling every 5 s");
    setInterval(() => { buildOnce().catch((e) => console.error("kosmos-build:", e.message)); }, 5000);
  }
}
