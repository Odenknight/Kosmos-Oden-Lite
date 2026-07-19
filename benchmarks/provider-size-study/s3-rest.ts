import { AwsClient } from "aws4fetch";
export function s3Rest(accessKeyId: string, secretAccessKey: string, region: string, endpoint: string, bucket: string) {
  const auth = new AwsClient({ accessKeyId, secretAccessKey, region, service: "s3" });
  const root = `${endpoint.replace(/\/$/, "")}/${encodeURIComponent(bucket)}`;
  const request = async (path: string, init: RequestInit = {}) => {
    const url = path.startsWith("?") ? `${root}/${path}` : `${root}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const response = await auth.fetch(url, init); if (!response.ok) throw new Error(`S3 request failed (${response.status})`); return response;
  };
  return {
    list: (prefix = "") => request(`?list-type=2&prefix=${encodeURIComponent(prefix)}`).then((r) => r.text()),
    get: (path: string) => request(path).then((r) => r.arrayBuffer()),
    put: (path: string, data: ArrayBuffer) => request(path, { method: "PUT", body: data }),
    remove: (path: string) => request(path, { method: "DELETE" }),
  };
}
globalThis.__kosmosProviderStudy = s3Rest;
