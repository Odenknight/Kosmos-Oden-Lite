/** Agent API tests (§15–§18, §24): auth, Host/Origin, byte limits, REST, MCP negotiation. */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildGraph, stripFrontmatter } from "../dist/kosmos-core.mjs";
import {
  KosmosAgentServer,
  LATEST_MCP_PROTOCOL_VERSION,
  MAX_BODY_BYTES,
  MAX_CONCURRENT_PER_AGENT,
  MAX_NOTE_CONTENT_CHARS,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  AGENT_SETTINGS_SCHEMA,
  DEFAULT_AGENT_SETTINGS,
  migrateAgentSettings,
  makeToken,
} from "../dist/kosmos-agent-server.mjs";

const FILES = [
  { relativePath: "Home.md", content: "# Home\n[[Engine v2]]" },
  { relativePath: "Ideas/Engine v1.md", content: "---\ntype: idea\ntimestamp: 2026-01-01T00:00:00Z\n---\nOld engine." },
  { relativePath: "Ideas/Engine v2.md", content: "---\ntype: idea\ntimestamp: 2026-03-01T00:00:00Z\nsupersedes:\n  - Engine v1\n---\nNew engine.\n\n**Related:** [[Home]]" },
];

function fixtureProvider() {
  const graph = buildGraph(FILES, ["Ideas"]);
  const contents = new Map(FILES.map((f) => [f.relativePath, stripFrontmatter(f.content)]));
  return {
    getGraph: async () => graph,
    getNoteContent: async (p) => contents.get(p) ?? null,
    vaultName: () => "TestVault",
    lanAddresses: () => [],
  };
}

const TOKEN = "test-token-1234567890";

function settings(overrides = {}) {
  return {
    schemaVersion: 3,
    agentEnabled: true,
    agentPort: 0, // ephemeral
    agentToken: TOKEN,
    agentRequireToken: true,
    agentBindMode: "localhost",
    agentSensitivityCeiling: "internal",
    agentGraphNamespace: "testnamespace",
    agentAllowQueryToken: false,
    ...overrides,
  };
}
function startServer(overrides = {}) {
  const server = new KosmosAgentServer(http, settings(overrides), fixtureProvider());
  return new Promise((resolve) => {
    server.start();
    server.server.on("listening", () => resolve({ server, port: server.server.address().port }));
  });
}

/** Raw request helper (fetch forbids overriding Host, so use http.request). */
function request(port, { method = "GET", path = "/", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, setHost: !headers.Host }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data, json: () => JSON.parse(data || "null") }));
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

const auth = { Authorization: `Bearer ${TOKEN}` };

test("agent api", async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.stop());

  await t.test("no token -> 401", async () => {
    const r = await request(port, { path: "/overview" });
    assert.equal(r.status, 401);
  });

  await t.test("wrong token -> 401", async () => {
    const r = await request(port, { path: "/overview", headers: { Authorization: "Bearer nope" } });
    assert.equal(r.status, 401);
  });

  await t.test("Bearer token -> 200", async () => {
    const r = await request(port, { path: "/overview", headers: auth });
    assert.equal(r.status, 200);
    assert.equal(r.json().vault, "TestVault");
  });

  await t.test("x-api-key -> 200", async () => {
    const r = await request(port, { path: "/health", headers: { "x-api-key": TOKEN } });
    assert.equal(r.status, 200);
  });

  await t.test("?token= query rejected by default (deprecated, off) -> 401", async () => {
    const r = await request(port, { path: `/health?token=${TOKEN}` });
    assert.equal(r.status, 401);
  });

  await t.test("responses set Cache-Control: no-store", async () => {
    const r = await request(port, { path: "/health", headers: auth });
    assert.match(r.headers["cache-control"] || "", /no-store/);
  });

  await t.test("Host rejection (DNS rebinding defence) -> 403", async () => {
    const r = await request(port, { path: "/health", headers: { ...auth, Host: "evil.example.com" } });
    assert.equal(r.status, 403);
  });

  await t.test("cross-site Origin rejection -> 403; local Origin allowed", async () => {
    const bad = await request(port, { path: "/health", headers: { ...auth, Origin: "https://evil.example.com" } });
    assert.equal(bad.status, 403);
    const nul = await request(port, { path: "/health", headers: { ...auth, Origin: "null" } });
    assert.equal(nul.status, 403);
    const good = await request(port, { path: "/health", headers: { ...auth, Origin: `http://127.0.0.1:${port}` } });
    assert.equal(good.status, 200);
  });

  await t.test("request-size rejection: > 4 MiB body -> 413 (byte-accurate)", async () => {
    const big = "x".repeat(MAX_BODY_BYTES + 1024);
    const r = await request(port, { method: "POST", path: "/mcp", headers: { ...auth, "Content-Type": "application/json" }, body: big });
    assert.equal(r.status, 413);
  });

  await t.test("REST GET routes respond", async () => {
    for (const p of ["/", "/health", "/overview", "/diagnostics", "/graph", "/notes?q=engine", "/note?title=Engine%20v2", "/lineage?title=Engine%20v2", "/related?title=Engine%20v2", "/at?time=2026-02-01", "/episodes"]) {
      const r = await request(port, { path: p, headers: auth });
      assert.equal(r.status, 200, `route ${p}`);
    }
  });

  await t.test("REST write rejection: POST/PUT/DELETE -> 405 (read-only, §18)", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const r = await request(port, { method, path: "/notes", headers: auth });
      assert.equal(r.status, 405, method);
    }
  });

  await t.test("lineage matches viewer semantics: v1 superseded, v2 HEAD (§33)", async () => {
    const r = await request(port, { path: "/lineage?title=Engine%20v1", headers: auth });
    const j = r.json();
    assert.equal(j.chainLength, 2);
    const [v1, v2] = j.chain;
    assert.equal(v1.title, "Engine v1");
    assert.equal(v1.superseded, true);
    assert.equal(v1.invalidAt, "2026-03-01T00:00:00.000Z");
    assert.equal(v2.title, "Engine v2");
    assert.equal(v2.head, true);
  });

  await t.test("graph_at_time uses the shared projector (§4.1)", async () => {
    const mid = (await request(port, { path: "/at?time=2026-02-01", headers: auth })).json();
    assert.deepEqual(mid.valid.map((n) => n.title), ["Engine v1"]);
    assert.equal(mid.counts.notYetCreated >= 1, true); // Engine v2 not written yet
    const late = (await request(port, { path: "/at?time=2026-06-01", headers: auth })).json();
    assert.ok(late.valid.some((n) => n.title === "Engine v2"));
    assert.deepEqual(late.superseded.map((n) => n.title), ["Engine v1"]);
  });

  let mcpSession = "";
  let mcpProtocol = "";
  const initParams = (protocolVersion, name = "test-client") => ({
    protocolVersion,
    capabilities: {},
    clientInfo: { name, version: "1.0.0" },
  });
  const mcp = async (msg, extraHeaders = {}) => {
    const sessionHeaders = msg?.method === "initialize" || !mcpSession ? {} : {
      "Mcp-Session-Id": mcpSession,
      "MCP-Protocol-Version": mcpProtocol,
    };
    const r = await request(port, {
      method: "POST", path: "/mcp",
      headers: { ...auth, "Content-Type": "application/json", ...sessionHeaders, ...extraHeaders },
      body: JSON.stringify(msg),
    });
    if (r.headers["mcp-session-id"]) mcpSession = r.headers["mcp-session-id"];
    try { if (r.json()?.result?.protocolVersion) mcpProtocol = r.json().result.protocolVersion; } catch {}
    return r;
  };

  await t.test("MCP initialize: supported version is echoed", async () => {
    for (const v of SUPPORTED_MCP_PROTOCOL_VERSIONS) {
      const r = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams(v) });
      assert.equal(r.json().result.protocolVersion, v);
    }
  });

  await t.test("MCP initialize: unsupported version -> server's latest, never echoed (§15)", async () => {
    const r = await mcp({ jsonrpc: "2.0", id: 2, method: "initialize", params: initParams("9999-12-31") });
    assert.equal(r.json().result.protocolVersion, LATEST_MCP_PROTOCOL_VERSION);
  });

  await t.test("MCP initialize validates required lifecycle fields", async () => {
    const r = await mcp({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} });
    assert.equal(r.json().error.code, -32602);
  });

  await t.test("MCP initialized notification (no id) -> 202 accepted silently", async () => {
    const r = await mcp({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(r.status, 202);
  });

  await t.test("MCP tools/list exposes legacy and OKF+ 2.3 read-only tools", async () => {
    const r = await mcp({ jsonrpc: "2.0", id: 4, method: "tools/list" });
    const names = r.json().result.tools.map((x) => x.name);
    assert.deepEqual(names.sort(), [
      "assess_note", "assess_vault", "export_graphiti_episodes", "get_assessment",
      "get_diagnostics", "get_effective_labels", "get_evidence", "get_lineage",
      "get_note", "get_okf_note", "get_policy", "get_related", "get_relationships",
      "graph_at_time", "graphiti_ingestion_status", "search_notes", "validate_note", "vault_overview",
    ]);
    assert.ok(r.json().result.tools.every((x) => x.annotations.readOnlyHint === true));
  });

  await t.test("OKF+ 2.3 assessment has REST/MCP parity and preserves read-only semantics", async () => {
    const m = await mcp({ jsonrpc: "2.0", id: 41, method: "tools/call", params: { name: "get_assessment", arguments: { title: "Engine v2" } } });
    const viaMcp = m.json().result.structuredContent;
    const r = await request(port, { path: "/okf/assessment?title=Engine%20v2", headers: auth });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), viaMcp);
    assert.equal(viaMcp.profile, "okf-plus-2.3-validating-projection");
    assert.equal(viaMcp.interpretation, "documentation-and-support-quality-not-truth");
    assert.equal(viaMcp.policy.id, "policy:okf23-default-v1");
  });

  await t.test("OKF+ policy endpoint is bundled, deterministic, and remote updates are off", async () => {
    const r = await request(port, { path: "/okf/policy", headers: auth });
    assert.equal(r.status, 200);
    assert.equal(r.json().remoteUpdatesEnabled, false);
    assert.match(r.json().policy.hash, /^sha256:[0-9a-f]{64}$/);
  });

  await t.test("MCP tools/call get_lineage returns the canonical chain", async () => {
    const r = await mcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_lineage", arguments: { title: "Engine v2" } } });
    const payload = JSON.parse(r.json().result.content[0].text);
    assert.equal(payload.chainLength, 2);
    assert.equal(payload.chain[1].head, true);
    assert.equal(r.json().result.structuredContent.chainLength, 2);
  });

  await t.test("Graphiti readiness never equates queue acceptance with searchability", async () => {
    const r = await mcp({ jsonrpc: "2.0", id: 51, method: "tools/call", params: { name: "graphiti_ingestion_status", arguments: {} } });
    const payload = JSON.parse(r.json().result.content[0].text);
    assert.equal(payload.state, "export-ready");
    assert.equal(payload.searchable, false);
    assert.equal(payload.upstreamCheckRequired, true);
  });

  await t.test("MCP unknown method -> -32601", async () => {
    const r = await mcp({ jsonrpc: "2.0", id: 6, method: "does/not/exist" });
    assert.equal(r.json().error.code, -32601);
  });

  await t.test("MCP initialize negotiates current 2025-11-25 and issues Mcp-Session-Id", async () => {
    assert.equal(LATEST_MCP_PROTOCOL_VERSION, "2025-11-25");
    const r = await mcp({ jsonrpc: "2.0", id: 7, method: "initialize", params: initParams("2025-11-25", "CARSON") });
    assert.equal(r.json().result.protocolVersion, "2025-11-25");
    assert.match(String(r.headers["mcp-session-id"] || ""), /^[A-Za-z0-9_-]{10,}$/);
  });

  await t.test("agent identity (clientInfo.name via Mcp-Session-Id) flows to the traversal callback", async () => {
    const init = await mcp({ jsonrpc: "2.0", id: 8, method: "initialize", params: initParams(LATEST_MCP_PROTOCOL_VERSION, "Hermes") });
    const sid = init.headers["mcp-session-id"];
    assert.ok(sid, "initialize should return a session id");
    await mcp({ jsonrpc: "2.0", method: "notifications/initialized" });
    let seen = null;
    server.onTraversal = (paths, tool, agent) => { seen = { paths, tool, agent }; };
    await request(port, {
      method: "POST", path: "/mcp",
      headers: { ...auth, "Content-Type": "application/json", "Mcp-Session-Id": sid, "MCP-Protocol-Version": LATEST_MCP_PROTOCOL_VERSION },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "get_lineage", arguments: { title: "Engine v2" } } }),
    });
    server.onTraversal = undefined;
    assert.ok(seen, "traversal should have fired");
    assert.equal(seen.agent, "Hermes");
    assert.equal(seen.tool, "get_lineage");
  });

  await t.test("MCP rejects JSON-RPC 1.0, batches, and unknown tools", async () => {
    const old = await mcp({ jsonrpc: "1.0", id: 10, method: "tools/list" });
    assert.equal(old.json().error.code, -32600);
    const unknown = await mcp({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "not_a_tool", arguments: {} } });
    assert.equal(unknown.json().error.code, -32602);
    const batch = await request(port, {
      method: "POST", path: "/mcp",
      headers: { ...auth, "Content-Type": "application/json", "Mcp-Session-Id": mcpSession, "MCP-Protocol-Version": mcpProtocol },
      body: JSON.stringify([{ jsonrpc: "2.0", id: 12, method: "ping" }]),
    });
    assert.equal(batch.status, 400);
    assert.equal(batch.json().error.code, -32600);
  });

  await t.test("MCP enforces session and protocol headers, and DELETE terminates", async () => {
    const missing = await request(port, {
      method: "POST", path: "/mcp", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 13, method: "ping" }),
    });
    assert.equal(missing.status, 400);
    const wrongVersion = await request(port, {
      method: "POST", path: "/mcp", headers: { ...auth, "Content-Type": "application/json", "Mcp-Session-Id": mcpSession, "MCP-Protocol-Version": "2024-11-05" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 14, method: "ping" }),
    });
    assert.equal(wrongVersion.status, 400);
    const ended = await request(port, { method: "DELETE", path: "/mcp", headers: { ...auth, "Mcp-Session-Id": mcpSession, "MCP-Protocol-Version": mcpProtocol } });
    assert.equal(ended.status, 204);
    const expired = await request(port, {
      method: "POST", path: "/mcp", headers: { ...auth, "Content-Type": "application/json", "Mcp-Session-Id": mcpSession, "MCP-Protocol-Version": mcpProtocol },
      body: JSON.stringify({ jsonrpc: "2.0", id: 15, method: "ping" }),
    });
    assert.equal(expired.status, 404);
  });
});

test("Mitigation 4: a single agent's concurrent requests are capped for fairness", async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const provider = {
    getGraph: async () => { await gate; return buildGraph(FILES, ["Ideas"]); },
    getNoteContent: async () => "", vaultName: () => "V", lanAddresses: () => [],
  };
  const server = new KosmosAgentServer(http, settings(), provider);
  await new Promise((resolve) => { server.start(); server.server.on("listening", resolve); });
  const port = server.server.address().port;
  const N = MAX_CONCURRENT_PER_AGENT;
  const ua = { ...auth, "User-Agent": "BulkAgent/1" };
  const reqs = [];
  for (let i = 0; i < N + 2; i++) reqs.push(request(port, { path: "/overview", headers: ua }));
  // let the first N pile up in-flight (blocked on the gate), then release them
  setTimeout(() => release(), 60);
  const results = await Promise.all(reqs);
  const throttled = results.filter((r) => r.status === 429);
  assert.equal(throttled.length, 2, "the 2 requests past the per-agent cap are throttled");
  assert.match(throttled[0].json().hint, /concurrent/);
  assert.equal(results.filter((r) => r.status === 200).length, N);
  server.stop();
});

test("auth disabled + empty token: requireToken(on)+empty token fails closed (§16)", async () => {
  const server = new KosmosAgentServer(http, {
    agentEnabled: true, agentPort: 0, agentToken: "", agentRequireToken: true, agentBindMode: "localhost",
  }, fixtureProvider());
  await new Promise((resolve) => { server.start(); server.server.on("listening", resolve); });
  const port = server.server.address().port;
  const r = await request(port, { path: "/health" });
  assert.equal(r.status, 401);
  server.stop();
});

test("makeToken: 32 bytes of secure randomness, base64url, no fallback (§16)", () => {
  const t1 = makeToken();
  const t2 = makeToken();
  assert.notEqual(t1, t2);
  assert.match(t1, /^[A-Za-z0-9_-]{43}$/); // 32 bytes -> 43 base64url chars, no padding
});

test("query-token auth works ONLY when explicitly enabled (Doc1 §3.6)", async () => {
  const { server, port } = await startServer({ agentAllowQueryToken: true });
  const r = await request(port, { path: `/health?token=${TOKEN}` });
  assert.equal(r.status, 200);
  server.stop();
});

test("LAN mode refuses to start without a token, fails closed (Doc1 §3.8)", () => {
  const noAuth = new KosmosAgentServer(http, settings({ agentBindMode: "lan", agentRequireToken: false }), fixtureProvider());
  noAuth.start();
  assert.match(noAuth.status, /LAN mode requires an auth token/);
  assert.equal(noAuth.server, null);
  noAuth.stop();

  const emptyToken = new KosmosAgentServer(http, settings({ agentBindMode: "lan", agentToken: "" }), fixtureProvider());
  emptyToken.start();
  assert.match(emptyToken.status, /LAN mode requires an auth token/);
  emptyToken.stop();
});

test("query-token is rejected in LAN mode even when allowed (Doc1 §3.6)", async () => {
  // Bind to loopback so the test can connect, but exercise the LAN gate directly.
  const server = new KosmosAgentServer(http, settings({ agentAllowQueryToken: true, agentBindMode: "lan" }), {
    getGraph: async () => buildGraph(FILES, ["Ideas"]), getNoteContent: async () => "", vaultName: () => "V", lanAddresses: () => [],
  });
  // authorized() must not accept a query token in LAN mode regardless of the flag.
  const u = new URL(`http://127.0.0.1/health?token=${TOKEN}`);
  assert.equal(server.authorized({ headers: {} }, u), false);
  const u2 = new URL("http://127.0.0.1/health");
  assert.equal(server.authorized({ headers: { authorization: `Bearer ${TOKEN}` } }, u2), true);
});

test("output cap: a huge note body is truncated (Doc2 §5.6)", async () => {
  const big = "x".repeat(MAX_NOTE_CONTENT_CHARS + 5000);
  const provider = {
    getGraph: async () => buildGraph([{ relativePath: "Big.md", content: "# Big\n" + big }], []),
    getNoteContent: async () => big,
    vaultName: () => "V", lanAddresses: () => [],
  };
  const server = new KosmosAgentServer(http, settings(), provider);
  const note = await server.qNote({ title: "Big" });
  assert.ok(note.content.length <= MAX_NOTE_CONTENT_CHARS + 100);
  assert.match(note.content, /truncated/);
});

test("OKF+ sensitivity ceiling filters search, note content, graph, and Graphiti pages", async () => {
  const files = [
    { relativePath: "Public.md", content: "---\ntype: semantic\nsensitivity: public\ntimestamp: 2026-01-01T00:00:00Z\n---\npublic" },
    { relativePath: "Internal.md", content: "---\ntype: semantic\nsensitivity: internal\ntimestamp: 2026-01-02T00:00:00Z\n---\ninternal" },
    { relativePath: "Secret.md", content: "---\ntype: semantic\nsensitivity: confidential\ntimestamp: 2026-01-03T00:00:00Z\nsupersedes:\n  - Public\n---\nsecret" },
    { relativePath: "Patient.md", content: "---\ntype: semantic\nsensitivity: phi\ntimestamp: 2026-01-04T00:00:00Z\n---\npatient" },
  ];
  const graph = buildGraph(files, []);
  const provider = {
    getGraph: async () => graph,
    getNoteContent: async (p) => files.find((f) => f.relativePath === p)?.content || null,
    vaultName: () => "Sensitive",
    vaultIdentity: () => "sensitive-vault",
    lanAddresses: () => [],
  };
  const server = new KosmosAgentServer(http, settings({ agentSensitivityCeiling: "internal" }), provider);
  assert.deepEqual((await server.qSearch("")).results.map((n) => n.title), ["Internal", "Public"]);
  assert.equal((await server.qNote({ title: "Secret" })).error, "note not found");
  assert.equal((await server.qNote({ title: "Public" })).superseded, false, "hidden successor must not leak through temporal state");
  assert.equal((await server.qGraph()).nodes.length, 2);
  assert.equal((await server.qEpisodePage()).total, 2);
  const publicEpisode = (await server.qEpisodePage()).episodes.find((e) => e.name === "Public");
  assert.deepEqual(JSON.parse(publicEpisode.episode_body).lineage.resolved_supersedes, []);
  server.settings.agentSensitivityCeiling = "confidential";
  assert.equal((await server.qNote({ title: "Secret" })).title, "Secret");
  assert.equal((await server.qNote({ title: "Patient" })).error, "note not found");
});

test("Host validation: loopback forms accepted, foreign/trailing-dot rejected", async () => {
  const s = new KosmosAgentServer(http, settings(), fixtureProvider());
  assert.equal(s.hostAllowed("127.0.0.1:4816"), true);
  assert.equal(s.hostAllowed("localhost"), true);
  assert.equal(s.hostAllowed("[::1]:4816"), true);
  assert.equal(s.hostAllowed("LOCALHOST:4816"), true);
  assert.equal(s.hostAllowed("evil.example.com"), false);
  assert.equal(s.hostAllowed("localhost."), false); // trailing dot is not in the allow-set
  assert.equal(s.hostAllowed(undefined), false);
});

test("Origin validation: absent allowed, null and cross-site rejected", () => {
  const s = new KosmosAgentServer(http, settings(), fixtureProvider());
  assert.equal(s.originAllowed(undefined), true);   // non-browser client
  assert.equal(s.originAllowed(""), true);
  assert.equal(s.originAllowed("null"), false);
  assert.equal(s.originAllowed("http://127.0.0.1:4816"), true);
  assert.equal(s.originAllowed("https://evil.example.com"), false);
});

test("onTraversal: per-note tools report touched paths (post-hoc, via callTool) for the live agent trail", async () => {
  const server = new KosmosAgentServer(http, settings(), fixtureProvider());
  const seen = [];
  server.onTraversal = (paths, tool) => seen.push({ tool, paths });

  await server.callTool("get_note", { title: "Engine v2" });
  await server.callTool("get_lineage", { title: "Engine v1" });
  await server.callTool("get_related", { title: "Engine v2" });
  await server.callTool("search_notes", { query: "engine" });
  await server.callTool("graph_at_time", { time: "2026-06-01" });

  const byTool = Object.fromEntries(seen.map((s) => [s.tool, s.paths]));
  assert.deepEqual(byTool.get_note, ["Ideas/Engine v2.md"]);
  assert.deepEqual(new Set(byTool.get_lineage), new Set(["Ideas/Engine v1.md", "Ideas/Engine v2.md"]));
  assert.ok(byTool.get_related.includes("Ideas/Engine v2.md"));
  assert.ok(byTool.search_notes.length >= 1);
  assert.ok(byTool.graph_at_time.length >= 1, "graph_at_time samples valid notes for the trail");
});

test("onTraversal: paths are CAPPED per tool so broad results never flood the halo budget", async () => {
  // 30 interlinked notes -> uncapped search/lineage results would exceed the caps.
  const files = [];
  for (let i = 0; i < 30; i++) {
    const sup = i > 0 ? `supersedes:\n  - Note ${i - 1}\n` : "";
    files.push({ relativePath: `Note ${i}.md`, content: `---\ntype: idea\ntimestamp: 2026-01-${String((i % 27) + 1).padStart(2, "0")}T00:00:00Z\n${sup}---\nnote body ${i}` });
  }
  const graph = buildGraph(files, []);
  const provider = { getGraph: async () => graph, getNoteContent: async () => "", vaultName: () => "V", lanAddresses: () => [] };
  const server = new KosmosAgentServer(http, settings(), provider);
  const seen = [];
  server.onTraversal = (paths, tool) => seen.push({ tool, paths });

  await server.callTool("search_notes", { query: "note", limit: 50 });
  await server.callTool("get_lineage", { title: "Note 29" });
  await server.callTool("graph_at_time", { time: "2026-06-01", limit: 50 });

  const byTool = Object.fromEntries(seen.map((s) => [s.tool, s.paths]));
  assert.ok(byTool.search_notes.length <= 8, `search cap: ${byTool.search_notes.length}`);
  assert.ok(byTool.get_lineage.length <= 12, `lineage cap: ${byTool.get_lineage.length}`);
  assert.ok(byTool.graph_at_time.length <= 6, `at-time cap: ${byTool.graph_at_time.length}`);
});

test("onTraversal: whole-vault queries (overview/episodes/diagnostics) do NOT report a trail", async () => {
  const server = new KosmosAgentServer(http, settings(), fixtureProvider());
  let fired = false;
  server.onTraversal = () => { fired = true; };
  await server.callTool("vault_overview", {});
  await server.callTool("export_graphiti_episodes", {});
  await server.qDiagnostics();
  assert.equal(fired, false);
});

test("onTraversal: REST routes emit the same events as MCP tools", async () => {
  const server = new KosmosAgentServer(http, settings(), fixtureProvider());
  const seen = [];
  server.onTraversal = (paths, tool) => seen.push({ tool, paths });
  await new Promise((resolve) => { server.start(); server.server.on("listening", resolve); });
  const port = server.server.address().port;
  await request(port, { path: "/note?title=Engine%20v2", headers: auth });
  await request(port, { path: "/at?time=2026-06-01", headers: auth });
  server.stop();
  assert.ok(seen.some((s) => s.tool === "get_note" && s.paths.includes("Ideas/Engine v2.md")));
  assert.ok(seen.some((s) => s.tool === "graph_at_time"));
});

test("settings migration: v1 (no schema) turns query tokens OFF (Doc1 §3.7)", () => {
  const migrated = migrateAgentSettings({ agentEnabled: true, agentPort: 5000, agentToken: "keepme" });
  assert.equal(migrated.schemaVersion, AGENT_SETTINGS_SCHEMA);
  assert.equal(migrated.agentAllowQueryToken, false); // security default on upgrade
  assert.equal(migrated.agentSensitivityCeiling, "internal");
  assert.equal(migrated.agentToken, "keepme");        // existing token preserved
  assert.equal(migrated.agentPort, 5000);
  assert.equal(migrated.okfEnrichmentLanCeiling, "internal");
  assert.equal(migrated.okfDeveloperExclusions, false); // no silent file omission on upgrade
  assert.equal(migrated.noteTimestampsEnabled, true);
  assert.equal(migrated.graphitiCombinedExtraction, false);
  assert.deepEqual(migrated.okfExcludePatterns, []);
  const lan = migrateAgentSettings({ okfEnrichmentProvider: "lan", okfEnrichmentLanCeiling: "confidential", okfExcludePatterns: ["**/AGENTS.md"] });
  assert.equal(lan.okfEnrichmentProvider, "lan");
  assert.equal(lan.okfEnrichmentLanCeiling, "confidential");
  assert.deepEqual(lan.okfExcludePatterns, ["**/AGENTS.md"]);
  // defaults fill in for a null load
  const fresh = migrateAgentSettings(null);
  assert.equal(fresh.agentEnabled, DEFAULT_AGENT_SETTINGS.agentEnabled);
});
