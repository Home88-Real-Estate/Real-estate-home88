/**
 * The two things the intake service needs from its host: personal-data
 * helpers and object storage. The website and the API each supply their own
 * (they hold different environment), and tests supply fakes, so the service
 * itself never reads `process.env` or talks to S3 directly.
 */

export interface PiiPort {
  hashEmail(email: string | null | undefined): string | null;
  /** Hash of the *normalised* phone (see normalisePhone). */
  hashPhone(phone: string | null | undefined): string | null;
  hashSubject(value: string | null | undefined): string | null;
  /** Null when no key is configured: callers store nothing rather than plaintext. */
  encrypt(plain: string | null | undefined): string | null;
}

export interface StoragePort {
  presignPut(key: string, contentType: string, byteSize: number, ttlSeconds?: number): Promise<{ url: string; headers: Record<string, string> }>;
  head(key: string): Promise<{ byteSize: number; contentType: string } | null>;
  read(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Copies an object to a new key, optionally with new cache headers. Used when
   * approved media leaves the private quarantine prefix for the public one.
   * The caller deletes the source once its database rows are committed.
   */
  copy(from: string, to: string, options?: { cacheControl?: string }): Promise<void>;
  signedGetUrl(key: string, ttlSeconds?: number): Promise<string>;
}
