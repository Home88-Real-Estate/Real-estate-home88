/**
 * The API's handle on the same bucket the website's quarantine uploads go to,
 * through the shared intake adapter (it can copy, which conversion needs).
 */

import { createS3Storage, type StoragePort } from "@home88/intake";

import { loadConfig } from "../config";
import { HttpError } from "./errors";
import { storageConfigured } from "./storage";

let override: StoragePort | null = null;

/** Test seam: route handlers use an in-memory store instead of S3. */
export function setIntakeStorageForTests(storage: StoragePort | null): void {
  override = storage;
}

export function intakeStorage(): StoragePort {
  if (override) return override;
  const cfg = loadConfig();
  if (!storageConfigured(cfg)) throw new HttpError(503, "storage_unavailable", "Object storage is not configured.");
  return createS3Storage({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    accessKey: cfg.S3_ACCESS_KEY,
    secretKey: cfg.S3_SECRET_KEY,
    bucket: cfg.S3_BUCKET,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  });
}
