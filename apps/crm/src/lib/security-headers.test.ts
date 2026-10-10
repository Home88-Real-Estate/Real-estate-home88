import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** The voice assistant needs the microphone and blob: audio, the location picker GPS and map tiles; nothing else should have loosened. */
describe("CRM security headers", async () => {
  const config = (await import("../../next.config.mjs")).default as { headers: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>> };
  const all = (await config.headers()).flatMap((h) => h.headers);
  const header = (name: string) => all.find((h) => h.key === name)?.value ?? "";

  it("lets the CRM's own pages use the microphone and location, and nothing else", () => {
    const policy = header("Permissions-Policy");
    assert.match(policy, /microphone=\(self\)/);
    assert.match(policy, /camera=\(\)/, "the camera button uses the phone's own camera app; the page needs no camera permission");
    assert.match(policy, /geolocation=\(self\)/, "GPS for the property location, on the CRM's own pages only");
    assert.ok(!/(microphone|geolocation)=\*/.test(policy), "never open to other origins");
  });

  it("allows map tile images from the tile server only, never scripts or frames from it", () => {
    const csp = header("Content-Security-Policy");
    const img = /img-src ([^;]+)/.exec(csp)?.[1] ?? "";
    assert.match(img, /https:\/\/tile\.openstreetmap\.org/);
    assert.ok(!/(^|\s)\*(\s|$)/.test(img));
    assert.ok(!/tile\.openstreetmap/.test(/script-src ([^;]+)/.exec(csp)?.[1] ?? ""));
    assert.match(csp, /frame-src 'none'/);
  });

  it("allows blob: media for spoken replies without allowing data: or arbitrary media", () => {
    const csp = header("Content-Security-Policy");
    const media = /media-src ([^;]+)/.exec(csp)?.[1] ?? "";
    assert.match(media, /'self'/);
    assert.match(media, /blob:/);
    assert.ok(!/data:/.test(media));
    assert.ok(!/\*/.test(media));
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /default-src 'self'/);
  });
});
