import { api, authorizeUrl, createPkce, tokenRequest } from "./oauth-pkce";
const AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token", GRAPH = "https://graph.microsoft.com/v1.0/me/drive/special/approot";
export const oneDriveRest = {
  createPkce,
  authorize: (clientId: string, redirectUri: string, challenge: string) => authorizeUrl(AUTH, { client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "offline_access Files.ReadWrite.AppFolder", code_challenge: challenge, code_challenge_method: "S256" }),
  exchange: (clientId: string, redirectUri: string, code: string, verifier: string) => tokenRequest(TOKEN, { client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier, grant_type: "authorization_code" }),
  refresh: (clientId: string, refreshToken: string) => tokenRequest(TOKEN, { client_id: clientId, refresh_token: refreshToken, grant_type: "refresh_token" }),
  list: (token: string) => api(`${GRAPH}/children`, token).then((r) => r.json()),
  get: (token: string, path: string) => api(`${GRAPH}:/${encodeURIComponent(path)}:/content`, token).then((r) => r.arrayBuffer()),
  put: (token: string, path: string, data: ArrayBuffer) => api(`${GRAPH}:/${encodeURIComponent(path)}:/content`, token, { method: "PUT", body: data }),
  remove: (token: string, path: string) => api(`${GRAPH}:/${encodeURIComponent(path)}`, token, { method: "DELETE" }),
};
globalThis.__kosmosProviderStudy = oneDriveRest;
