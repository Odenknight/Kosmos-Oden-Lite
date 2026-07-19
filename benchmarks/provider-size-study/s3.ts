import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
export function makeS3(config: ConstructorParameters<typeof S3Client>[0]) {
  const client = new S3Client(config);
  return { client, commands: { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } };
}
globalThis.__kosmosProviderStudy = makeS3;
