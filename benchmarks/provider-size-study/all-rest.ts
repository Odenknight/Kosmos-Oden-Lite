import { googleRest } from "./google-rest";
import { oneDriveRest } from "./onedrive-rest";
import { dropboxRest } from "./dropbox-rest";
import { s3Rest } from "./s3-rest";
globalThis.__kosmosProviderStudy = { googleRest, oneDriveRest, dropboxRest, s3Rest };
