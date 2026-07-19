/** Version synchronization check (§29): one source of truth, everything else must match. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const versionTs = read("src/core/version.ts");
const m = /KOSMOS_VERSION\s*=\s*"([^"]+)"/.exec(versionTs);
if (!m) { console.error("check-versions: KOSMOS_VERSION not found in src/core/version.ts"); process.exit(1); }
const version = m[1];

const pkg = JSON.parse(read("package.json"));
const manifest = JSON.parse(read("manifest.json"));
const versions = JSON.parse(read("versions.json"));

const problems = [];
if (pkg.version !== version) problems.push(`package.json version ${pkg.version} != ${version}`);
if (manifest.version !== version) problems.push(`manifest.json version ${manifest.version} != ${version}`);
if (!versions[version]) problems.push(`versions.json is missing an entry for ${version}`);
if (versions[version] && versions[version] !== manifest.minAppVersion) {
  problems.push(`versions.json[${version}] (${versions[version]}) != manifest minAppVersion (${manifest.minAppVersion})`);
}

if (problems.length) {
  for (const p of problems) console.error("check-versions:", p);
  process.exit(1);
}
console.log(`check-versions: OK — everything agrees on v${version}`);
