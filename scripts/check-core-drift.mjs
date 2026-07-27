#!/usr/bin/env node
/**
 * Vendored-core drift check.
 *
 * `src/core/` is a vendored copy of the GKOS Engine's `src/`. This repo is
 * patches-only (see VERSIONING.md), so the vendored copy must stay at a known
 * engine parity tag with a small, explicitly declared set of intentional
 * deltas (product identity, assessor id, doc comments). Anything else is
 * accidental drift and fails CI.
 *
 * How it works
 *   1. Reads the declared parity tag from package.json ("engineParity").
 *   2. Obtains that tag's `src/` from the public engine repo — either from
 *      $GKOS_ENGINE_DIR (a local checkout, used verbatim) or via a
 *      `git clone --depth 1 --branch <tag>` into a temp dir.
 *   3. For every file in src/core/, diffs it against the engine file with
 *      line endings normalised to LF.
 *   4. Any diff must be listed in scripts/core-drift-allowlist.json, matched
 *      by a fingerprint of the normalised diff. Semver literals are collapsed
 *      to <SEMVER> first so a routine version bump does not invalidate the
 *      allowlist.
 *   5. Files present in the engine but deliberately not vendored (and vice
 *      versa) must also be declared in the allowlist.
 *
 * This check is metadata/hygiene only — it never modifies the tree.
 *
 * Usage:  node scripts/check-core-drift.mjs
 * Env:    GKOS_ENGINE_DIR   path to an existing engine checkout (skips clone)
 *         GKOS_ENGINE_REPO  override clone URL
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = join(root, "src", "core");
const allowlistPath = join(root, "scripts", "core-drift-allowlist.json");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const parityTag = pkg.engineParity;
if (!parityTag) {
  console.error('check-core-drift: package.json is missing the "engineParity" field.');
  process.exit(1);
}
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
if (allowlist.engineParity !== parityTag) {
  console.error(
    `check-core-drift: allowlist declares engineParity ${allowlist.engineParity} but package.json declares ${parityTag}. ` +
      "Re-baseline the allowlist when you move the parity tag.",
  );
  process.exit(1);
}

const repo = process.env.GKOS_ENGINE_REPO || allowlist.engineRepo || "https://github.com/Odenknight/GKOS-Engine";

/** LF-normalise and drop a trailing-newline difference. */
const norm = (s) => s.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
const readNorm = (p) => norm(readFileSync(p, "utf8"));

let engineSrc;
let cleanup = null;
if (process.env.GKOS_ENGINE_DIR) {
  engineSrc = join(resolve(process.env.GKOS_ENGINE_DIR), "src");
  if (!existsSync(engineSrc)) {
    console.error(`check-core-drift: GKOS_ENGINE_DIR=${process.env.GKOS_ENGINE_DIR} has no src/ directory.`);
    process.exit(1);
  }
  console.log(`check-core-drift: using local engine checkout ${engineSrc} (assumed to be at ${parityTag})`);
} else {
  const tmp = mkdtempSync(join(tmpdir(), "gkos-engine-"));
  cleanup = () => rmSync(tmp, { recursive: true, force: true });
  console.log(`check-core-drift: cloning ${repo} at ${parityTag}`);
  const r = spawnSync(
    "git",
    ["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", parityTag, repo, tmp],
    { stdio: "inherit" },
  );
  if (r.status !== 0) {
    cleanup();
    console.error(`check-core-drift: could not clone ${repo} at ${parityTag}.`);
    process.exit(1);
  }
  engineSrc = join(tmp, "src");
}

const failures = [];
const stale = [];

try {
  const liteFiles = readdirSync(coreDir).filter((f) => f.endsWith(".ts")).sort();
  const engineFiles = readdirSync(engineSrc).filter((f) => f.endsWith(".ts")).sort();

  // --- file-set differences -------------------------------------------------
  const notVendored = engineFiles.filter((f) => !liteFiles.includes(f));
  const declaredNotVendored = allowlist.notVendored ?? {};
  for (const f of notVendored) {
    if (!(f in declaredNotVendored)) failures.push(`engine file src/${f} is not vendored and is not declared in the allowlist ("notVendored").`);
  }
  for (const f of Object.keys(declaredNotVendored)) {
    if (!notVendored.includes(f)) stale.push(`allowlist "notVendored" lists ${f}, but it is not missing from src/core/ at ${parityTag}.`);
  }
  const liteOnly = liteFiles.filter((f) => !engineFiles.includes(f));
  const declaredLiteOnly = allowlist.liteOnly ?? {};
  for (const f of liteOnly) {
    if (!(f in declaredLiteOnly)) failures.push(`src/core/${f} does not exist in the engine at ${parityTag} and is not declared in the allowlist ("liteOnly").`);
  }
  for (const f of Object.keys(declaredLiteOnly)) {
    if (!liteOnly.includes(f)) stale.push(`allowlist "liteOnly" lists ${f}, but it does exist in the engine at ${parityTag}.`);
  }

  // --- per-file content diffs ----------------------------------------------
  const work = mkdtempSync(join(tmpdir(), "core-drift-"));
  const declaredDeltas = allowlist.deltas ?? {};
  const seen = new Set();

  for (const f of liteFiles) {
    if (liteOnly.includes(f)) continue;
    const a = join(work, "engine");
    const b = join(work, "lite");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, f), readNorm(join(engineSrc, f)));
    writeFileSync(join(b, f), readNorm(join(coreDir, f)));

    const r = spawnSync("git", ["diff", "--no-index", "--no-color", "--unified=1", "--", join(a, f), join(b, f)], { encoding: "utf8" });
    if (r.status === 0) {
      if (f in declaredDeltas) stale.push(`allowlist "deltas" lists ${f}, but it is now identical to the engine at ${parityTag}. Remove the entry.`);
      continue;
    }
    const fp = fingerprint(r.stdout);
    const entry = declaredDeltas[f];
    if (!entry) {
      failures.push(`src/core/${f} differs from the engine at ${parityTag} and has no allowlist entry.\n${indent(r.stdout)}`);
      continue;
    }
    seen.add(f);
    if (entry.fingerprint !== fp) {
      failures.push(
        `src/core/${f} differs from the engine at ${parityTag} in a way the allowlist does not describe.\n` +
          `  expected fingerprint ${entry.fingerprint}\n  actual   fingerprint ${fp}\n` +
          `  allowed delta: ${entry.reason}\n${indent(r.stdout)}`,
      );
    }
  }
  rmSync(work, { recursive: true, force: true });

  for (const f of Object.keys(declaredDeltas)) {
    if (!liteFiles.includes(f)) stale.push(`allowlist "deltas" lists ${f}, which is not present in src/core/.`);
  }
} finally {
  if (cleanup) cleanup();
}

/**
 * Fingerprint a unified diff: drop the file headers and the @@ line numbers,
 * and collapse semver literals so a version bump does not churn the allowlist.
 */
function fingerprint(diffText) {
  const body = diffText
    .split("\n")
    .filter((l) => !/^(diff --git |index |--- |\+\+\+ |new file mode |deleted file mode )/.test(l))
    .map((l) => l.replace(/^@@[^@]*@@/, "@@"))
    .join("\n")
    .replace(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g, "<SEMVER>")
    .trim();
  return "sha256:" + createHash("sha256").update(body).digest("hex").slice(0, 32);
}

function indent(s) {
  return s.split("\n").map((l) => "    " + l).join("\n");
}

if (stale.length) {
  console.error("check-core-drift: the allowlist is stale —");
  for (const s of stale) console.error("  - " + s);
}
if (failures.length) {
  console.error(`\ncheck-core-drift: FAIL — undeclared drift in the vendored core vs GKOS-Engine ${parityTag}:\n`);
  for (const f of failures) console.error("  * " + f + "\n");
  console.error(
    "This repo is patches-only. Either backport the engine change verbatim, or — if the delta is\n" +
      "intentional — record it in scripts/core-drift-allowlist.json with a reason and the printed fingerprint.",
  );
  process.exit(1);
}
if (stale.length) process.exit(1);

console.log(`check-core-drift: OK — src/core/ matches GKOS-Engine ${parityTag} apart from the ${Object.keys(allowlist.deltas ?? {}).length} allowlisted deltas.`);
