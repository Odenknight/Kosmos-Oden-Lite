#!/usr/bin/env node
/**
 * First-party MCP stdio adapter for Vault Kosmos.
 *
 * Some desktop harnesses can launch stdio servers but cannot attach custom
 * headers to a local Streamable HTTP endpoint. This adapter translates one
 * newline-delimited JSON-RPC message at a time and preserves the negotiated
 * MCP session and protocol-version headers. Protocol output is stdout-only;
 * diagnostics go to stderr.
 */
import readline from "node:readline";

const endpoint = process.env.KOSMOS_MCP_URL || "http://127.0.0.1:4816/mcp";
const token = process.env.KOSMOS_MCP_TOKEN || "";
let sessionId = "";
let protocolVersion = "";

try {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
} catch {
  process.stderr.write("Vault Kosmos stdio adapter: KOSMOS_MCP_URL must be an http(s) URL\n");
  process.exit(2);
}

function writeMessage(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function requestError(message, detail) {
  if (message?.id === undefined) return;
  writeMessage({
    jsonrpc: "2.0",
    id: message?.id ?? null,
    error: { code: -32000, message: "Vault Kosmos MCP transport error", data: detail },
  });
}

async function forward(message) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  if (sessionId && protocolVersion) headers["MCP-Protocol-Version"] = protocolVersion;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(65_000),
    });
  } catch (error) {
    requestError(message, String(error?.message || error));
    return;
  }

  const newSession = response.headers.get("mcp-session-id");
  if (newSession) sessionId = newSession;
  const text = await response.text();
  if (!response.ok && response.status !== 202) {
    let detail = `${response.status} ${response.statusText}`;
    if (text) detail += `: ${text.slice(0, 2000)}`;
    requestError(message, detail);
    return;
  }
  if (!text) return; // accepted notification

  let payload;
  try { payload = JSON.parse(text); }
  catch {
    requestError(message, "server returned a non-JSON response");
    return;
  }
  if (message?.method === "initialize" && payload?.result?.protocolVersion) {
    protocolVersion = String(payload.result.protocolVersion);
  }
  writeMessage(payload);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
for await (const line of input) {
  if (!line.trim()) continue;
  let message;
  try { message = JSON.parse(line); }
  catch {
    writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    continue;
  }
  await forward(message);
}

if (sessionId && protocolVersion) {
  const headers = { "Mcp-Session-Id": sessionId, "MCP-Protocol-Version": protocolVersion };
  if (token) headers.Authorization = `Bearer ${token}`;
  try { await fetch(endpoint, { method: "DELETE", headers, signal: AbortSignal.timeout(2_000) }); }
  catch { /* process is already shutting down */ }
}
