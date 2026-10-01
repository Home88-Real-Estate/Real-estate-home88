/**
 * S3-compatible object storage.
 *
 * The database only ever holds an object key, never a URL: a public URL is
 * derived for approved media and a short-lived signed URL is minted for
 * anything still under review, so a leaked CRM preview link expires and a
 * database dump does not hand over the whole gallery.
 *
 * The client is built lazily and cached: importing this module must not read
 * `process.env` or construct a client, so tests and the type-checker are
 * unaffected by an unconfigured deployment.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { loadConfig, type ApiConfig } from "../config";

const PUBLIC_STATUSES = ["approved", "published"];

let cachedClient: S3Client | null = null;

export function storageConfigured(cfg: ApiConfig = loadConfig()): boolean {
  return cfg.S3_ENDPOINT.length > 0 && cfg.S3_ACCESS_KEY.length > 0 && cfg.S3_SECRET_KEY.length > 0;
}

function client(cfg: ApiConfig): S3Client {
  cachedClient ??= new S3Client({
    region: cfg.S3_REGION,
    endpoint: cfg.S3_ENDPOINT || undefined,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: cfg.S3_ACCESS_KEY,
      secretAccessKey: cfg.S3_SECRET_KEY,
    },
  });
  return cachedClient;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const cfg = loadConfig();
  await client(cfg).send(
    new PutObjectCommand({
      Bucket: cfg.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Keys are content-addressed by UUID, so a long immutable cache is safe.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  const cfg = loadConfig();
  await client(cfg).send(new DeleteObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key }));
}

export async function signedGetUrl(key: string, ttlSeconds?: number): Promise<string> {
  const cfg = loadConfig();
  return getSignedUrl(
    client(cfg),
    new GetObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key }),
    { expiresIn: ttlSeconds ?? cfg.S3_SIGNED_URL_TTL },
  );
}

/** Stable, unauthenticated URL for objects a bucket serves publicly. */
export function publicObjectUrl(key: string, cfg: ApiConfig = loadConfig()): string {
  const clean = key.replace(/^\/+/, "");
  if (cfg.S3_ENDPOINT) {
    const base = cfg.S3_ENDPOINT.replace(/\/+$/, "");
    return cfg.S3_FORCE_PATH_STYLE ? `${base}/${cfg.S3_BUCKET}/${clean}` : `${base}/${clean}`;
  }
  return `https://${cfg.S3_BUCKET}.s3.${cfg.S3_REGION}.amazonaws.com/${clean}`;
}

/**
 * The URL a client should use for one media item: public once approved, signed
 * while it is under review. Falls back to the public shape when storage is not
 * configured so the CRM can still render a broken-image placeholder rather than
 * throwing on a listing page.
 */
export async function mediaUrlFor(storageKey: string, status: string): Promise<string> {
  if (PUBLIC_STATUSES.includes(status) || !storageConfigured()) return publicObjectUrl(storageKey);
  try {
    return await signedGetUrl(storageKey);
  } catch {
    return publicObjectUrl(storageKey);
  }
}

/** Test seam. */
export function resetStorageClient(): void {
  cachedClient = null;
}
