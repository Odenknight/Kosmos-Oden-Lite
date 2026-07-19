import { requestUrl } from "obsidian";
import { isOkfLoopbackHost, isOkfPrivateLanIpLiteral } from "../core/okf-network";
import type { AgentSettings } from "./agent-server";

export function validatedOkfLlmEndpoint(provider: AgentSettings["okfEnrichmentProvider"], raw: string): string {
  if (provider === "none") throw new Error("Select an on-device, LAN, or cloud enrichment provider first.");
  const url = new URL(raw);
  if (url.username || url.password) throw new Error("Model endpoint credentials must not be embedded in the URL.");
  if (url.hash) throw new Error("Model endpoint fragments are not supported.");
  for (const key of url.searchParams.keys()) if (/(?:api[_-]?key|token|secret|password|signature|authorization)/i.test(key)) throw new Error("Model endpoint secrets must use the named environment-variable setting, not URL query parameters.");
  if (provider === "local" && !isOkfLoopbackHost(url.hostname)) throw new Error("On-device model endpoints must use localhost, 127.0.0.0/8, or ::1. Choose LAN LLM for a private-network model.");
  if (provider === "lan" && !isOkfPrivateLanIpLiteral(url.hostname)) throw new Error("LAN model endpoints must use a literal RFC1918, IPv4 link-local, IPv6 ULA, or IPv6 link-local address. DNS hostnames, public IPs, bind-all, and loopback addresses are rejected.");
  if (provider === "cloud" && url.protocol !== "https:") throw new Error("Cloud model endpoints must use HTTPS.");
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Model endpoint must use HTTP or HTTPS.");
  return url.toString();
}

export function validateOkfLlmConfiguration(settings: AgentSettings): string {
  if (!settings.okfEnrichmentModel.trim()) throw new Error("A model name is required.");
  const endpoint = validatedOkfLlmEndpoint(settings.okfEnrichmentProvider, settings.okfEnrichmentEndpoint);
  const envName = settings.okfEnrichmentApiKeyEnv.trim();
  const key = envName ? String((globalThis as any).process?.env?.[envName] || "") : "";
  if (settings.okfEnrichmentProvider === "cloud" && !key) throw new Error(`Cloud API key environment variable ${envName || "<unset>"} is unavailable to Obsidian.`);
  return endpoint;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("The model returned incomplete or malformed JSON. Its response was discarded; deterministic proposals remain available for review.");
  }
}

/** Bounded OpenAI-compatible JSON request shared by the two advisory passes. */
export async function requestOkfLlmJson(
  settings: AgentSettings,
  system: string,
  payload: unknown,
  maxTokens = 1200,
): Promise<unknown> {
  const endpoint = validateOkfLlmConfiguration(settings);
  const envName = settings.okfEnrichmentApiKeyEnv.trim();
  const key = envName ? String((globalThis as any).process?.env?.[envName] || "") : "";
  const body = JSON.stringify({
    model: settings.okfEnrichmentModel,
    temperature: 0,
    max_tokens: Math.max(100, Math.min(1600, maxTokens)),
    response_format: { type: "json_object" },
    tools: [],
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(payload) },
    ],
  });
  const request = requestUrl({ url: endpoint, method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body, throw: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Model request timed out; no retry was attempted.")), settings.okfEnrichmentTimeoutMs); });
  const response = await Promise.race([request, timeout]).finally(() => { if (timer) clearTimeout(timer); });
  if (response.status < 200 || response.status >= 300) throw new Error(`Model endpoint returned HTTP ${response.status}.`);
  const content = response.json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Model endpoint did not return OpenAI-compatible message content.");
  if (content.length > 65_536) throw new Error("Model response exceeded the 64 KiB safety limit.");
  return parseJsonObject(content);
}
