function base64url(bytes: Uint8Array): string {
  let value = ""; for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}
export function authorizeUrl(endpoint: string, values: Record<string, string>): string {
  const url = new URL(endpoint); for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value); return url.toString();
}
export async function tokenRequest(endpoint: string, values: Record<string, string>): Promise<any> {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) });
  if (!response.ok) throw new Error(`OAuth token request failed (${response.status})`); return response.json();
}
export async function api(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`Storage request failed (${response.status})`); return response;
}
