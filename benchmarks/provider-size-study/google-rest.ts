import { api, authorizeUrl, createPkce, tokenRequest } from "./oauth-pkce";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth", TOKEN = "https://oauth2.googleapis.com/token", DRIVE = "https://www.googleapis.com/drive/v3";
export const googleRest = {
  createPkce,
  authorize: (clientId: string, redirectUri: string, challenge: string) => authorizeUrl(AUTH, { client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "https://www.googleapis.com/auth/drive.file", access_type: "offline", code_challenge: challenge, code_challenge_method: "S256" }),
  exchange: (clientId: string, redirectUri: string, code: string, verifier: string) => tokenRequest(TOKEN, { client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier, grant_type: "authorization_code" }),
  refresh: (clientId: string, refreshToken: string) => tokenRequest(TOKEN, { client_id: clientId, refresh_token: refreshToken, grant_type: "refresh_token" }),
  list: (token: string, pageToken = "") => api(`${DRIVE}/files?spaces=drive&q=trashed%3Dfalse&fields=nextPageToken%2Cfiles(id%2Cname%2Cparents%2CmodifiedTime%2Csize%2Cmd5Checksum)&pageToken=${encodeURIComponent(pageToken)}`, token).then((r) => r.json()),
  get: (token: string, id: string) => api(`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`, token).then((r) => r.arrayBuffer()),
  put: (token: string, id: string, data: ArrayBuffer) => api(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`, token, { method: "PATCH", body: data }),
  remove: (token: string, id: string) => api(`${DRIVE}/files/${encodeURIComponent(id)}`, token, { method: "DELETE" }),
};
globalThis.__kosmosProviderStudy = googleRest;
