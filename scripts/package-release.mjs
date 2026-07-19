/**
 * Assemble a clean, verifiable release directory (Doc1 §3.9, Doc2 §3).
 *
 * Copies only the intended artifacts into release/, writes BUILD-INFO.json
 * (provenance) and SHA256SUMS (integrity). Runs after `npm run build`.
 *
 *   node scripts/package-release.mjs
 *
 * In GitHub Actions, commit/tag/runner metadata is read from the environment;
 * locally it falls back to `git` and best-effort values. Volatile metadata
 * (build time) lives ONLY here, never in main.js, so executable artifacts stay
 * byte-reproducible (Doc2 §4.5).
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rel = resolve(root, "release");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const ARTIFACTS = ["manifest.json", "main.js", "styles.css", "versions.json", "vault-kosmos.html", "kosmos-mcp-stdio.mjs"];

function git(cmd, fallback = "") {
  try { return execSync(`git ${cmd}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return fallback; }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

rmSync(rel, { recursive: true, force: true });
mkdirSync(rel, { recursive: true });

for (const f of ARTIFACTS) {
  try { copyFileSync(resolve(root, f), resolve(rel, f)); }
  catch (e) { console.error(`package-release: missing artifact ${f} — run npm run build first`); process.exit(1); }
}

const lockHash = (() => {
  try { return sha256(resolve(root, "package-lock.json")); } catch { return null; }
})();

const buildInfo = {
  schemaVersion: 1,
  project: "vault-kosmos",
  version: pkg.version,
  repository: "https://github.com/Odenknight/Kosmos-Oden",
  gitCommit: process.env.GITHUB_SHA || git("rev-parse HEAD"),
  gitTag: process.env.GITHUB_REF_NAME || git("describe --tags --exact-match", ""),
  workflow: process.env.GITHUB_WORKFLOW || null,
  runId: process.env.GITHUB_RUN_ID || null,
  nodeVersion: process.version,
  lockfileSha256: lockHash,
  sourceTreeDirty: git("status --porcelain") !== "",
  buildTimeUtc: new Date().toISOString(),
};
writeFileSync(resolve(rel, "BUILD-INFO.json"), JSON.stringify(buildInfo, null, 2) + "\n");

// SHA256SUMS over every file EXCEPT the sums file itself, sorted for determinism.
const sumFiles = [...ARTIFACTS, "BUILD-INFO.json"].sort();
const sums = sumFiles.map((f) => `${sha256(resolve(rel, f))}  ${f}`).join("\n") + "\n";
writeFileSync(resolve(rel, "SHA256SUMS"), sums);

console.log(`package-release: staged ${sumFiles.length} files in release/`);
console.log(`  commit ${buildInfo.gitCommit || "(unknown)"}${buildInfo.sourceTreeDirty ? " (dirty tree)" : ""}`);
for (const line of sums.trim().split("\n")) console.log("  " + line);
