/**
 * Renderer provenance check (RENDERER-UPGRADE-BUILD-INSTRUCTIONS.md §5.1).
 *
 * Verifies the stable renderer dependency is exact-pinned, that the lockfile
 * records the same version + integrity as renderer-provenance.json, that the
 * expected Three.js revision is what the built artifacts declare, that the
 * generated HTML carries the diagnostic build marker with no runtime CDN, and
 * that license metadata exists. Fails CI on any drift.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const problems = [];
const must = (cond, msg) => { if (!cond) problems.push(msg); };

const prov = JSON.parse(read("renderer-provenance.json"));
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));

// 1. exact-pinned three in dependencies (no ^ ~ latest ranges)
const dep = (pkg.dependencies || {}).three;
must(dep === prov.npmVersion, `package.json three (${dep}) must be exact-pinned to ${prov.npmVersion}`);
must(dep && /^\d+\.\d+\.\d+$/.test(dep), `three version must be exact (got ${dep})`);

// 2. lockfile records same version + integrity
const locked = lock.packages && lock.packages["node_modules/three"];
must(!!locked, "package-lock.json has no node_modules/three entry");
if (locked) {
  must(locked.version === prov.npmVersion, `lockfile three ${locked.version} != provenance ${prov.npmVersion}`);
  must(locked.integrity === prov.lockfileIntegrity, "lockfile three integrity does not match renderer-provenance.json");
}

// 3. expected revision + backend
must(prov.threeRevision === "185", `expected Three revision 185, provenance says ${prov.threeRevision}`);
must(prov.stableBackend === "WebGLRenderer", `stable backend must be WebGLRenderer (got ${prov.stableBackend})`);
must(prov.webglVersion === 2, "stable renderer must target WebGL2");
must(/mit/i.test(prov.license), "renderer license must be recorded (MIT)");

// 4. generated HTML carries the build marker and no runtime CDN
for (const html of ["vault-kosmos.html", "dist/kosmos-embed.html"]) {
  if (!existsSync(resolve(root, html))) { problems.push(`${html} missing — run npm run build`); continue; }
  const h = read(html);
  const markerRe = new RegExp(`kosmos-renderer" content="three r${prov.threeRevision} WebGLRenderer webgl${prov.webglVersion}"`);
  must(markerRe.test(h), `${html} is missing the expected renderer build marker (three r${prov.threeRevision})`);
  must(!/<script[^>]+src=/i.test(h), `${html} loads an external script`);
  must(!/<link[^>]+href=/i.test(h), `${html} loads an external stylesheet`);
  // no CDN/module fetch: reject import/fetch to http(s), and script/link src to remote.
  must(!/\bimport\s+[^;]*\bfrom\s*["']https?:/i.test(h), `${html} has a remote ESM import`);
  must(!/\bfetch\(\s*["'`]https?:/i.test(h), `${html} fetches a remote URL`);
}

// 5. the old global vendored build must not be referenced by the build anymore
const buildmjs = read("scripts/build.mjs");
must(!/vendor\/three\.min\.js/.test(buildmjs), "scripts/build.mjs still references the retired vendor/three.min.js");

if (problems.length) {
  console.error("check-renderer-provenance: FAILED");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`check-renderer-provenance: OK — three@${prov.npmVersion} (r${prov.threeRevision}, WebGL2), lockfile-pinned, marker present, no CDN`);
