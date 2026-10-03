import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { StoragePort } from "./ports";

export type S3Config = {
  endpoint?: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  forcePathStyle: boolean;
};

/** Uploads into the private bucket are never cached publicly. */
const PRIVATE_CACHE = "private, no-store";

/**
 * S3-compatible storage for the intake pipeline. Quarantine objects carry
 * `private, no-store`: nothing a visitor uploads is ever served from a CDN
 * until staff approve it and it is published under a property.
 */
export function createS3Storage(config: S3Config): StoragePort {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
  });
  const Bucket = config.bucket;

  return {
    async presignPut(key, contentType, byteSize, ttlSeconds = 900) {
      // Type, size and cache headers are part of the signature: the browser
      // cannot swap the type or send more bytes than it declared.
      const signed = new Set(["content-type", "content-length", "cache-control"]);
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: byteSize, CacheControl: PRIVATE_CACHE }),
        { expiresIn: ttlSeconds, signableHeaders: signed },
      );
      return { url, headers: { "content-type": contentType, "cache-control": PRIVATE_CACHE } };
    },
    async head(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { byteSize: head.ContentLength ?? 0, contentType: head.ContentType ?? "" };
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (error as { name?: string }).name === "NotFound") return null;
        throw error;
      }
    },
    async read(key) {
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return result.Body ? Buffer.from(await result.Body.transformToByteArray()) : Buffer.alloc(0);
    },
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, CacheControl: PRIVATE_CACHE }));
    },
    async copy(from, to, options) {
      await client.send(
        new CopyObjectCommand({
          Bucket,
          Key: to,
          CopySource: `${Bucket}/${from.split("/").map(encodeURIComponent).join("/")}`,
          // REPLACE so the destination takes the new cache header; type is kept explicitly.
          MetadataDirective: "REPLACE",
          CacheControl: options?.cacheControl ?? PRIVATE_CACHE,
          ContentType: (await client.send(new HeadObjectCommand({ Bucket, Key: from }))).ContentType,
        }),
      );
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async signedGetUrl(key, ttlSeconds = 300) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: ttlSeconds });
    },
  };
}
