import { Dropbox, DropboxAuth } from "dropbox";
export function makeDropbox(clientId: string) {
  const auth = new DropboxAuth({ clientId });
  return { auth, client: (accessToken: string) => new Dropbox({ accessToken }) };
}
globalThis.__kosmosProviderStudy = makeDropbox;
