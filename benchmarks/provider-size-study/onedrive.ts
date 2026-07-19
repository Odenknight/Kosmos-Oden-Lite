import { PublicClientApplication } from "@azure/msal-browser";
import { Client } from "@microsoft/microsoft-graph-client";
export function makeOneDrive(clientId: string) {
  const auth = new PublicClientApplication({ auth: { clientId, authority: "https://login.microsoftonline.com/common" }, cache: { cacheLocation: "localStorage" } });
  return { auth, graph: (token: string) => Client.init({ authProvider: (done) => done(null, token) }) };
}
globalThis.__kosmosProviderStudy = makeOneDrive;
