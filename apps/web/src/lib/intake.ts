/**
 * The website's instance of the public intake service.
 *
 * Built lazily so importing a route never reads the environment or opens a
 * connection at build time. Storage is optional: without S3 settings the
 * upload endpoints answer 503 and flows that carry no files work as normal.
 */

import {
  createS3Storage,
  PublicLeadIntakeService,
  uploadLimitsFromEnv,
  type PiiPort,
  type StoragePort,
  type UploadLimits,
} from "@home88/intake";

import { COMPANY, SITE_URL } from "@/lib/config";
import { prisma } from "@/lib/db";
import { encryptField, hashEmail, hashPhone, hashSubject } from "@/lib/pii";

const pii: PiiPort = {
  hashEmail,
  hashPhone,
  hashSubject,
  encrypt: encryptField,
};

let storage: StoragePort | null | undefined;

export function intakeStorage(): StoragePort | null {
  if (storage !== undefined) return storage;
  const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_REGION, S3_FORCE_PATH_STYLE } = process.env;
  storage =
    S3_ENDPOINT && S3_ACCESS_KEY && S3_SECRET_KEY
      ? createS3Storage({
          endpoint: S3_ENDPOINT,
          region: S3_REGION || "us-east-1",
          accessKey: S3_ACCESS_KEY,
          secretKey: S3_SECRET_KEY,
          bucket: S3_BUCKET || "home88-properties",
          forcePathStyle: S3_FORCE_PATH_STYLE !== "false",
        })
      : null;
  return storage;
}

export function intakeLimits(): UploadLimits {
  return uploadLimitsFromEnv(process.env);
}

export function intakeService(): PublicLeadIntakeService | null {
  if (!prisma) return null;
  return new PublicLeadIntakeService({
    prisma,
    pii,
    storage: intakeStorage() ?? undefined,
    config: {
      policyVersion: COMPANY.policyVersion,
      ownHosts: [new URL(SITE_URL).hostname],
      limits: intakeLimits(),
      leadRetentionMonths: Number(process.env.LEAD_RETENTION_MONTHS) || 24,
      submissionRetentionMonths: Number(process.env.SUBMISSION_RETENTION_MONTHS) || 12,
    },
  });
}
