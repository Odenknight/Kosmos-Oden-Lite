/** Release artifact checks (§28): existence, self-containment, version agreement. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

function must(cond, msg) { if (!cond) problems.push(msg); }

// main.js exists and is a plausible plugin bundle
must(existsSync(resolve(root, "main.js")), "main.js is missing (run npm run build)");
if (existsSync(resolve(root, "main.js"))) {
  const mainJs = readFileSync(resolve(root, "main.js"), "utf8");
  must(statSync(resolve(root, "main.js")).size > 100_000, "main.js suspiciously small");
  must(mainJs.includes("vault-kosmos-view"), "main.js does not register the Kosmos view");
}

// vault-kosmos.html exists, single-file, no external runtime deps
const standalonePath = resolve(root, "vault-kosmos.html");
must(existsSync(standalonePath), "vault-kosmos.html is missing (run npm run build:standalone)");
if (existsSync(standalonePath)) {
  const html = readFileSync(standalonePath, "utf8");
  must(html.length > 400_000, "vault-kosmos.html suspiciously small");
  must(!/<script[^>]+src=/i.test(html), "vault-kosmos.html loads an external script");
  must(!/<link[^>]+href=/i.test(html), "vault-kosmos.html loads an external stylesheet");
  must(!/url\(\s*['"]?https?:/i.test(html), "vault-kosmos.html references a remote CSS url()");
  must(html.includes("showDirectoryPicker"), "standalone is missing the persistent folder picker");
  must(html.includes("webkitdirectory"), "standalone is missing the snapshot fallback");
}

// stdio compatibility adapter ships beside the Obsidian plugin artifacts
const stdioAdapter = resolve(root, "kosmos-mcp-stdio.mjs");
must(existsSync(stdioAdapter), "kosmos-mcp-stdio.mjs is missing");
if (existsSync(stdioAdapter)) {
  const source = readFileSync(stdioAdapter, "utf8");
  must(source.includes("MCP-Protocol-Version"), "stdio adapter does not preserve the negotiated MCP protocol header");
  must(source.includes("Mcp-Session-Id"), "stdio adapter does not preserve the MCP session header");
}

// version agreement between built artifacts and manifest/package
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
must(pkg.version === manifest.version, `package (${pkg.version}) and manifest (${manifest.version}) versions differ`);
if (existsSync(standalonePath)) {
  const html = readFileSync(standalonePath, "utf8");
  must(html.includes(`Vault Kosmos ${pkg.version}`), "standalone artifact was built from a different version");
}
const versions = JSON.parse(readFileSync(resolve(root, "versions.json"), "utf8"));
must(!!versions[pkg.version], `versions.json has no entry for ${pkg.version}`);

if (problems.length) {
  for (const p of problems) console.error("check-artifacts:", p);
  process.exit(1);
}
console.log("check-artifacts: OK — plugin, standalone, and stdio adapter artifacts are present and version-consistent");
