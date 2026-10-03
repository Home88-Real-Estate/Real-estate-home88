import type { StoragePort } from "./ports";

/** In-memory object store for tests and local development. Not for production. */
export class MemoryStorage implements StoragePort {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async presignPut(key: string, contentType: string, byteSize: number) {
    return { url: `memory://${key}?size=${byteSize}`, headers: { "content-type": contentType } };
  }

  /** What the browser's PUT would do: stores bytes under a presigned key. */
  upload(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, { body, contentType });
  }

  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { byteSize: o.body.length, contentType: o.contentType } : null;
  }

  async read(key: string) {
    const o = this.objects.get(key);
    if (!o) throw new Error("NoSuchKey");
    return o.body;
  }

  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }

  async copy(from: string, to: string) {
    const o = this.objects.get(from);
    if (!o) throw new Error("NoSuchKey");
    this.objects.set(to, { body: Buffer.from(o.body), contentType: o.contentType });
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async signedGetUrl(key: string, ttlSeconds = 300) {
    return `memory://${key}?ttl=${ttlSeconds}`;
  }
}
