import { api, authorizeUrl, createPkce, tokenRequest } from "./oauth-pkce";
const AUTH = "https://www.dropbox.com/oauth2/authorize", TOKEN = "https://api.dropboxapi.com/oauth2/token", RPC = "https://api.dropboxapi.com/2", CONTENT = "https://content.dropboxapi.com/2";
export const dropboxRest = {
  createPkce,
  authorize: (clientId: string, redirectUri: string, challenge: string) => authorizeUrl(AUTH, { client_id: clientId, redirect_uri: redirectUri, response_type: "code", token_access_type: "offline", code_challenge: challenge, code_challenge_method: "S256" }),
  exchange: (clientId: string, redirectUri: string, code: string, verifier: string) => tokenRequest(TOKEN, { client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier, grant_type: "authorization_code" }),
  refresh: (clientId: string, refreshToken: string) => tokenRequest(TOKEN, { client_id: clientId, refresh_token: refreshToken, grant_type: "refresh_token" }),
  list: (token: string, path = "") => api(`${RPC}/files/list_folder`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, recursive: true }) }).then((r) => r.json()),
  get: (token: string, path: string) => api(`${CONTENT}/files/download`, token, { method: "POST", headers: { "Dropbox-API-Arg": JSON.stringify({ path }) } }).then((r) => r.arrayBuffer()),
  put: (token: string, path: string, data: ArrayBuffer) => api(`${CONTENT}/files/upload`, token, { method: "POST", headers: { "Content-Type": "application/octet-stream", "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite" }) }, body: data }),
  remove: (token: string, path: string) => api(`${RPC}/files/delete_v2`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) }),
};
globalThis.__kosmosProviderStudy = dropboxRest;
