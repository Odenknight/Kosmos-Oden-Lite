import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildGraph } from "../dist/kosmos-core.mjs";
import { KosmosAgentServer, LATEST_MCP_PROTOCOL_VERSION } from "../dist/kosmos-agent-server.mjs";

test("bundled stdio adapter preserves Streamable HTTP session lifecycle", async (t) => {
  const token = "bridge-test-token";
  const graph = buildGraph([{ relativePath: "Hello.md", content: "# Hello" }], []);
  const server = new KosmosAgentServer(http, {
    schemaVersion: 3,
    agentEnabled: true,
    agentPort: 0,
    agentToken: token,
    agentRequireToken: true,
    agentBindMode: "localhost",
    agentAllowQueryToken: false,
    agentSensitivityCeiling: "internal",
    agentGraphNamespace: "bridgetest",
  }, {
    getGraph: async () => graph,
    getNoteContent: async () => "# Hello",
    vaultName: () => "BridgeTest",
    vaultIdentity: () => "bridge-test",
    lanAddresses: () => [],
  });
  await new Promise((resolve) => { server.start(); server.server.on("listening", resolve); });
  const port = server.server.address().port;
  t.after(() => server.stop());

  const child = spawn(process.execPath, ["kosmos-mcp-stdio.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, KOSMOS_MCP_URL: `http://127.0.0.1:${port}/mcp`, KOSMOS_MCP_TOKEN: token },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => { try { child.kill(); } catch {} });

  const queued = [];
  const waiters = [];
  let partial = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    partial += chunk;
    let nl;
    while ((nl = partial.indexOf("\n")) >= 0) {
      const line = partial.slice(0, nl); partial = partial.slice(nl + 1);
      if (!line) continue;
      const value = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter(value); else queued.push(value);
    }
  });
  const next = () => queued.length ? Promise.resolve(queued.shift()) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for stdio response")), 5000);
    waiters.push((value) => { clearTimeout(timer); resolve(value); });
  });
  const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");

  send({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: LATEST_MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "stdio-test", version: "1" } },
  });
  const initialized = await next();
  assert.equal(initialized.result.protocolVersion, LATEST_MCP_PROTOCOL_VERSION);

  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const listed = await next();
  assert.ok(listed.result.tools.some((tool) => tool.name === "get_note"));

  child.stdin.end();
  const exitCode = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(exitCode, 0);
});
