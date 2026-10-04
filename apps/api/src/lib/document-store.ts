/**
 * Private document storage (contracts, IDs, mandates, signed copies).
 *
 * Unlike listing media, documents are never public: keys live under
 * `private/`, carry 128 random bits, are written with `private, no-store`
 * caching, and are read only through short-lived signed links minted after
 * a permission check. The bucket policy must not make `private/` public.
 *
 * The store is swappable so tests run without object storage.
 */

import { createHash, randomBytes } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { loadConfig } from "../config";
import { storageClient, storageConfigured } from "./storage";

const CACHE = "private, no-store";

export interface DocumentStore {
  configured(): boolean;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<Buffer | null>;
  head(key: string): Promise<{ byteSize: number; contentType: string } | null>;
  presignPut(key: string, contentType: string, byteSize: number): Promise<{ url: string; headers: Record<string, string> }>;
  signedGet(key: string, filename: string, ttlSeconds: number): Promise<string>;
  remove(key: string): Promise<void>;
}

const s3Store: DocumentStore = {
  configured: () => storageConfigured(),
  async put(key, body, contentType) {
    const cfg = loadConfig();
    await storageClient(cfg).send(new PutObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: CACHE }));
  },
  async read(key) {
    const cfg = loadConfig();
    try {
      const r = await storageClient(cfg).send(new GetObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key }));
      return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : Buffer.alloc(0);
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  },
  async head(key) {
    const cfg = loadConfig();
    try {
      const h = await storageClient(cfg).send(new HeadObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key }));
      return { byteSize: h.ContentLength ?? 0, contentType: h.ContentType ?? "" };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (error as { name?: string }).name === "NotFound") return null;
      throw error;
    }
  },
  async presignPut(key, contentType, byteSize) {
    const cfg = loadConfig();
    const url = await getSignedUrl(
      storageClient(cfg),
      new PutObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key, ContentType: contentType, ContentLength: byteSize, CacheControl: CACHE }),
      { expiresIn: 600, signableHeaders: new Set(["content-type", "content-length", "cache-control"]) },
    );
    return { url, headers: { "content-type": contentType, "cache-control": CACHE } };
  },
  async signedGet(key, filename, ttlSeconds) {
    const cfg = loadConfig();
    const safe = filename.replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 120) || "document";
    return getSignedUrl(
      storageClient(cfg),
      new GetObjectCommand({
        Bucket: cfg.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(safe)}`,
        ResponseCacheControl: CACHE,
      }),
      { expiresIn: ttlSeconds },
    );
  },
  async remove(key) {
    const cfg = loadConfig();
    await storageClient(cfg).send(new DeleteObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key }));
  },
};

let store: DocumentStore = s3Store;

export function documentStore(): DocumentStore {
  return store;
}

/** Test seam. `null` restores object storage. */
export function setDocumentStore(next: DocumentStore | null): void {
  store = next ?? s3Store;
}

/** An in-memory store for tests and local runs without object storage. */
export function memoryDocumentStore(): DocumentStore & { objects: Map<string, { body: Buffer; contentType: string }> } {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    objects,
    configured: () => true,
    async put(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async read(key) {
      return objects.get(key)?.body ?? null;
    },
    async head(key) {
      const o = objects.get(key);
      return o ? { byteSize: o.body.length, contentType: o.contentType } : null;
    },
    async presignPut(key, contentType) {
      return { url: `memory://${key}`, headers: { "content-type": contentType, "cache-control": CACHE } };
    },
    async signedGet(key) {
      return `memory://${key}`;
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

export function documentKey(ext: string, now = new Date()): string {
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `private/documents/${month}/${randomBytes(16).toString("hex")}.${ext}`;
}

export function isDocumentKey(key: string): boolean {
  return /^private\/documents\/\d{4}\/\d{2}\/[0-9a-f]{32}\.[a-z]{2,5}$/.test(key);
}

export const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
