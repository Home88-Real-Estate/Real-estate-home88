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
  HeadObjectCommand,
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

/** The shared S3 client, for modules with their own object rules (documents). */
export function storageClient(cfg: ApiConfig = loadConfig()): S3Client {
  return client(cfg);
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

/**
 * A short-lived URL the browser uploads one file to directly, so large photos
 * never pass through an API request. Content-Type is part of the signature,
 * and so is Content-Length when `byteSize` is given: the client cannot swap
 * the type or send a larger body than it declared. Unsized URLs are only for
 * browser-made variants, whose size is checked when the upload is confirmed.
 */
export async function presignPut(
  key: string,
  contentType: string,
  byteSize?: number,
  ttlSeconds = 900,
): Promise<{ url: string; headers: Record<string, string> }> {
  const cfg = loadConfig();
  const signed = new Set(["content-type", "cache-control"]);
  if (byteSize !== undefined) signed.add("content-length");
  const url = await getSignedUrl(
    client(cfg),
    new PutObjectCommand({
      Bucket: cfg.S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ...(byteSize !== undefined ? { ContentLength: byteSize } : {}),
      CacheControl: "public, max-age=31536000, immutable",
    }),
    { expiresIn: ttlSeconds, signableHeaders: signed },
  );
  return {
    url,
    headers: { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" },
  };
}

/** Size and type of a stored object, or null when it does not exist. */
export async function headObject(
  key: string,
): Promise<{ byteSize: number; contentType: string } | null> {
  const cfg = loadConfig();
  try {
    const head = await client(cfg).send(new HeadObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key }));
    return { byteSize: head.ContentLength ?? 0, contentType: head.ContentType ?? "" };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === "NotFound") return null;
    throw error;
  }
}

/** The first `bytes` of an object: enough to sniff its type and dimensions. */
export async function readObjectStart(key: string, bytes: number): Promise<Buffer> {
  const cfg = loadConfig();
  const result = await client(cfg).send(
    new GetObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key, Range: `bytes=0-${bytes - 1}` }),
  );
  const body = result.Body;
  if (!body) return Buffer.alloc(0);
  return Buffer.from(await body.transformToByteArray());
}

/** Whole (small) object, for serving approved media through the API. */
export async function getObjectBytes(key: string): Promise<{ bytes: Buffer; contentType: string | null } | null> {
  const cfg = loadConfig();
  try {
    const r = await client(cfg).send(new GetObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key }));
    if (!r.Body) return null;
    return { bytes: Buffer.from(await r.Body.transformToByteArray()), contentType: r.ContentType ?? null };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === "NoSuchKey") return null;
    throw error;
  }
}

/**
 * Where approved media is served from. The bucket stays private: approved files
 * are read through the API's public-media route, which only answers for keys
 * recorded on an approved or published media row.
 */
export function publicMediaUrl(key: string, cfg: ApiConfig = loadConfig()): string {
  // Root-relative by default: the CRM page and its API are one origin, whatever address it is opened on.
  const base = cfg.MEDIA_BASE_URL || `${cfg.CRM_BASE_PATH}/api/public-media`;
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
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
  if (PUBLIC_STATUSES.includes(status)) return publicMediaUrl(storageKey);
  if (!storageConfigured()) return publicObjectUrl(storageKey);
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
