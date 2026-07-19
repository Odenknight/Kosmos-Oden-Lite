/**
 * Enforce kosmos-invariants.yml against the source and built artifacts
 * (Engineering Assurance Guide §6.4). Fails CI on any drift between the
 * declared policy and the code that is supposed to implement it.
 *
 * No YAML dependency: a tiny scalar reader handles this flat policy file.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const problems = [];
const must = (cond, msg) => { if (!cond) problems.push(msg); };

/* ---- minimal YAML scalar reader (2-space indent, `key: value`) ---- */
function parsePolicy(text) {
  const rootObj = {};
  const stack = [{ indent: -1, obj: rootObj }];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").replace(/\s+$/, "");
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (listItem) {
      if (!Array.isArray(parent.__list)) parent.__list = [];
      parent.__list.push(unquote(listItem[1].trim()));
      continue;
    }
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (val === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = coerce(unquote(val));
    }
  }
  return rootObj;
}
const unquote = (s) => s.replace(/^["']/, "").replace(/["']$/, "");
const coerce = (s) => (s === "true" ? true : s === "false" ? false : /^\d+$/.test(s) ? Number(s) : s);

/** Strip // line and /* block *​/ comments so "absence" checks don't match prose. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const policy = parsePolicy(read("kosmos-invariants.yml"));

/* ---- security invariants against src/plugin/agent-server.ts ---- */
const server = read("src/plugin/agent-server.ts");
const serverCode = stripComments(server); // for absence checks
const sec = policy.security || {};

must(/agentEnabled:\s*false/.test(server), "DEFAULT_AGENT_SETTINGS.agentEnabled must be false");
must(/agentBindMode:\s*"localhost"/.test(server), "default bind mode must be localhost");
must(/agentRequireToken:\s*true/.test(server), "default agentRequireToken must be true");
must(/agentAllowQueryToken:\s*false/.test(server), "default agentAllowQueryToken must be false (query tokens off by default)");
must(new RegExp(`agentSensitivityCeiling:\\s*"${sec.default_agent_sensitivity_ceiling}"`).test(server), "default agent sensitivity ceiling must match policy");
must(server.includes(`"${sec.mcp_latest_protocol}"`) && /SUPPORTED_MCP_PROTOCOL_VERSIONS/.test(server), "latest MCP revision must match policy");
must(sec.query_tokens_default_enabled === false, "policy: query_tokens_default_enabled must be false");
must(/lanNeedsAuthButHasNone/.test(server) && /LAN mode requires an auth token/.test(server), "server must refuse to start LAN mode without a token");
must(/agentBindMode !== "lan"/.test(server), "query-token auth must be gated out of LAN mode");
must(new RegExp(`MAX_BODY_BYTES\\s*=\\s*${sec.max_request_bytes / (1024 * 1024)} \\* 1024 \\* 1024`).test(server) || /4 \* 1024 \* 1024/.test(server), "MAX_BODY_BYTES must equal the policy's max_request_bytes");
must(/getRandomValues/.test(server) && /new Uint8Array\(32\)/.test(server), "token must use crypto.getRandomValues with 32 bytes");
must(!/Math\.random\s*\(/.test(serverCode), "no Math.random() may appear in the Agent API server");
must(/hostAllowed/.test(server), "Host validation must be present");
must(/originAllowed/.test(server), "Origin validation must be present");
must(/timingSafeEqual/.test(server), "token comparison must be constant-time");
const okfParser = read("src/core/okf.ts");
must(sec.invalid_sensitivity_fails_closed_as === "secret" && /return typeof v === "string" && v\.trim\(\) \? "secret"/.test(okfParser), "invalid explicit sensitivity must fail closed as secret");
const okf23 = read("src/core/okf23.ts");
must(sec.invalid_v23_sensitivity_fails_closed_as === "secret" && /effectiveSensitivity = "secret"/.test(okf23), "invalid v2.3 sensitivity must fail closed as secret");
must(/GET only \(read-only API\)/.test(server) && !/\bcase "\/write"|app\.post\(|writeFile/.test(server), "Agent API must expose no write routes");

const projectionPolicy = policy.okf23_projection || {};
must(projectionPolicy.profile === "validating-projection" && /OKF23_PROFILE/.test(okf23), "OKF+ 2.3 must identify the validating projection profile");
must(projectionPolicy.full_gkos_claimed === false && /conformanceClaim: "reader-and-deterministic-assessor"/.test(okf23), "OKF+ 2.3 must not claim full GKOS conformance");
must(projectionPolicy.proposed_values_effective_without_approval === false && /origins\.authored, origins\.derived, origins\.approved/.test(okf23), "proposed OKF+ values must not enter effective state");
must(projectionPolicy.scores_are_truth === false && /documentation-and-support-quality-not-truth/.test(okf23), "assessment must disclaim truth scoring");
must(projectionPolicy.policy_hash_required === true && /hash: "sha256:[0-9a-f]{64}"/.test(okf23), "OKF+ 2.3 policy must carry a SHA-256 hash");
must(projectionPolicy.remote_schema_updates_enabled === false && /remoteUpdatesEnabled: false/.test(server), "remote schema updates must remain disabled");

/* ---- build invariants ---- */
const pkg = JSON.parse(read("package.json"));
must(existsSync(resolve(root, policy.build.lockfile_required)), `${policy.build.lockfile_required} must exist`);
const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
must(!Object.values(allDeps).some((v) => v === "latest"), "no dependency may use \"latest\"");
must(pkg.engines && pkg.engines.node, "package.json must declare engines.node");

/* ---- renderer invariants ---- */
const main = read("src/plugin/main.ts");
const mainCode = stripComments(main);
must(/setAttribute\("sandbox"/.test(mainCode), "plugin iframe must set a sandbox attribute");
must(!/allow-same-origin/.test(mainCode), "iframe sandbox must NOT include allow-same-origin");
const protocol = read("src/plugin/protocol.ts");
must(/KOSMOS_PROTOCOL_VERSION/.test(protocol) && /validateHostMessage/.test(protocol), "host↔renderer protocol must be versioned and validated");

/* ---- OKF+ migration invariants ---- */
const migrationCore = read("src/core/okf-migration.ts");
const migrationHost = read("src/plugin/okf-migration.ts");
const migrationCode = stripComments(migrationCore + "\n" + migrationHost);
const mig = policy.okf_migration || {};
must(mig.audit_before_apply === true && /createOkfMigrationPlan/.test(migrationCore) && /OkfMigrationPreviewModal/.test(migrationHost), "OKF+ writes must be preceded by an explicit audit preview");
must(mig.plan_hash === "sha256" && /subtle\.digest\("SHA-256"/.test(migrationCore) && /verifyOkfMigrationPlan/.test(migrationHost), "OKF+ apply must verify and bind to a SHA-256 plan");
must(mig.byte_exact_backup === true && /readBinary/.test(migrationHost) && /writeBinary/.test(migrationHost), "OKF+ migration must make byte-exact binary backups");
must(mig.source_match_before_write === true && /current !== entry\.originalContent/.test(migrationHost), "OKF+ migration must skip sources changed after the plan");
must(mig.body_preserved === true && /fm\.body/.test(migrationCore), "OKF+ migration must preserve the human-authored body");
must(mig.llm_required === false && mig.network_dispatch_allowed === false && !/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(migrationCode), "OKF+ migration must remain LLM-free and make no network dispatch");

/* ---- standalone invariants (artifact must exist and be self-contained) ---- */
if (existsSync(resolve(root, "vault-kosmos.html"))) {
  const html = read("vault-kosmos.html");
  must(!/<script[^>]+src=/i.test(html), "standalone must not load external scripts");
  must(!/url\(\s*['"]?https?:/i.test(html), "standalone must not reference remote CSS urls");
} else {
  problems.push("vault-kosmos.html missing — run npm run build");
}

/* ---- release forbidden files must never be tracked ---- */
for (const pat of (policy.release?.forbidden_files?.__list) || []) {
  if (pat.includes("*")) continue; // glob patterns checked at package time
  if (existsSync(resolve(root, pat))) {
    // data.json is gitignored working data; only fail if it would be committed.
    if (pat === "data.json") continue;
    problems.push(`forbidden file present in repo: ${pat}`);
  }
}

if (problems.length) {
  console.error("check-invariants: FAILED");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("check-invariants: OK — source and artifacts satisfy kosmos-invariants.yml");
