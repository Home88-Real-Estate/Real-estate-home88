/**
 * Browser checks for the AI assistant widget (launcher, chat, keyboard, mobile,
 * reduced motion, mascot eye tracking). Run against a running site:
 *
 *   GEMINI_API_KEY=<any non-empty value> npm run dev -w @home88/web   # the widget only renders when a key is set
 *   BASE_URL=http://localhost:3000 npm run test:ui -w @home88/web
 *
 * /api/ai/chat is stubbed here, so this exercises the UI only; the backend is
 * covered by src/lib/ai/*.test.ts. Chromium: PLAYWRIGHT_BROWSERS_PATH or CHROMIUM_PATH.
 */

import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

const CARD = { reference: "H88-000412", title: "Διαμέρισμα στη Γλυφάδα", listingType: "SALE", status: "ACTIVE", propertyType: "Διαμέρισμα", location: "Γλυφάδα", priceLabel: "€450.000", areaSqm: 105, bedrooms: 3, bathrooms: 2, url: "/property/H88-000412", image: null };

async function stub(page, handler) {
  const seen = [];
  await page.route("**/api/ai/chat", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    seen.push(body);
    const out = await handler(body, seen.length);
    await route.fulfill({ status: out.status ?? 200, contentType: "application/json", body: JSON.stringify(out.json) });
  });
  return seen;
}

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  const page = await ctx.newPage();
  await page.goto(BASE + (opts.path ?? "/"), { waitUntil: "networkidle" });
  return page;
}

await check("launcher shows the fox, is a labelled button, and opens the dialog", async () => {
  const page = await newPage();
  const launcher = page.locator(".ai-launcher");
  await launcher.waitFor();
  assert.match(await launcher.getAttribute("aria-label"), /AI Assistant/);
  assert.equal(await page.locator(".ai-launcher .fox svg image").first().getAttribute("href"), "/images/fox/home88-fox-assistant.webp");
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "HOME88 AI Assistant" });
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Είμαι ο AI Assistant της HOME88/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "ai-input", "focus moves to the input");
});

await check("mascot eyes follow the cursor within small limits and return to neutral", async () => {
  const page = await newPage();
  const box = await page.locator(".ai-launcher").boundingBox();
  const iris = () => page.evaluate(() => [...document.querySelectorAll(".ai-launcher svg g[transform]")].map((g) => g.getAttribute("transform")));
  const parse = (s) => s.match(/-?\d+(\.\d+)?/g).map(Number);
  await page.mouse.move(2, box.y + 46, { steps: 5 });
  await page.waitForTimeout(800);
  const left = (await iris()).map(parse);
  await page.mouse.move(1278, box.y + 46, { steps: 5 });
  await page.waitForTimeout(800);
  const right = (await iris()).map(parse);
  assert.ok(left.length === 2 && right.length === 2, "two eye layers");
  assert.ok(left[0][0] < -2 && right[0][0] > 2, `eyes look left then right (${left[0][0]}, ${right[0][0]})`);
  for (const [x, y] of [...left, ...right]) assert.ok(Math.abs(x) <= 9.01 && Math.abs(y) <= 6.01, "within eyeMax limits");
  await page.mouse.move(box.x + 46, box.y + 46);
  const rot = await page.locator(".ai-launcher .fox").evaluate((el) => el.style.getPropertyValue("--fox-rot"));
  assert.ok(Math.abs(parseFloat(rot)) <= 3.01, `head rotation is subtle (${rot})`);
});

await check("mouse movement only touches attributes: no DOM nodes are added or removed (no re-render per move)", async () => {
  const page = await newPage();
  await page.evaluate(() => {
    window.__childMutations = 0;
    new MutationObserver((list) => { window.__childMutations += list.filter((m) => m.type === "childList").length; }).observe(document.querySelector(".ai-launcher"), { childList: true, subtree: true });
  });
  for (let i = 0; i < 40; i++) await page.mouse.move(100 + i * 20, 300 + (i % 5) * 10);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__childMutations), 0);
});

await check("a chat turn: Enter sends, Shift+Enter adds a line, cards render from the response, 'Ενδιαφέρομαι' sends a follow-up", async () => {
  const page = await newPage({ path: "/property/H88-000412" });
  const seen = await stub(page, (body, n) =>
    n === 1
      ? { json: { ok: true, message: "Βρήκα ένα ακίνητο.", properties: [CARD], actions: [], leadCreated: false, sessionId: body.sessionId } }
      : { json: { ok: true, message: "Θα χρειαστώ το όνομά σας.", properties: [], actions: [], leadCreated: false, sessionId: body.sessionId } });
  await page.locator(".ai-launcher").click();
  const input = page.locator("#ai-input");
  await input.fill("γραμμή 1");
  await input.press("Shift+Enter");
  await input.type("γραμμή 2");
  assert.equal(await input.inputValue(), "γραμμή 1\nγραμμή 2");
  await input.fill("2άρι στη Γλυφάδα");
  await input.press("Enter");
  await page.getByText("Βρήκα ένα ακίνητο.").waitFor();
  assert.equal(seen[0].message, "2άρι στη Γλυφάδα");
  assert.equal(seen[0].propertyReference, "H88-000412", "property page context is passed");
  assert.equal(seen[0].pageUrl, "/property/H88-000412");
  const card = page.locator(".ai-card");
  assert.match(await card.innerText(), /H88-000412[\s\S]*€450\.000/);
  assert.equal(await card.getByRole("link", { name: "Προβολή" }).getAttribute("href"), "/property/H88-000412");
  await card.getByRole("button", { name: "Ενδιαφέρομαι" }).click();
  await page.getByText("Θα χρειαστώ το όνομά σας.").waitFor();
  assert.match(seen[1].message, /H88-000412/);
  assert.ok(seen[1].history.length >= 2);
});

await check("a created request shows a received notice, never a confirmation", async () => {
  const page = await newPage();
  await stub(page, (b) => ({ json: { ok: true, message: "Το αίτημα επίσκεψης καταχωρήθηκε.", properties: [], actions: [{ kind: "viewing_request", reference: "VR-1", duplicate: false }], leadCreated: true, sessionId: b.sessionId } }));
  await page.locator(".ai-launcher").click();
  await page.locator("#ai-input").fill("θέλω επίσκεψη");
  await page.locator("#ai-input").press("Enter");
  const notice = page.getByRole("status").filter({ hasText: "παρελήφθη" });
  await notice.waitFor();
  assert.ok(!/επιβεβαιώθηκε|κλείστηκε/.test(await notice.innerText()));
});

await check("failure shows an error message with working fallbacks (contact, request, search)", async () => {
  const page = await newPage();
  await stub(page, () => ({ status: 503, json: { ok: false, unavailable: true, message: "Συγγνώμη, αντιμετωπίζω προσωρινά ένα τεχνικό πρόβλημα." } }));
  await page.locator(".ai-launcher").click();
  await page.locator("#ai-input").fill("γεια");
  await page.locator("#ai-input").press("Enter");
  await page.getByText("τεχνικό πρόβλημα").waitFor();
  for (const [name, href] of [["Επικοινωνία", "/contact"], ["Ζητώ ακίνητο", "/request"], ["Αναζήτηση ακινήτων", "/properties"]]) {
    assert.equal(await page.locator(".ai-fallback").getByRole("link", { name }).getAttribute("href"), href);
  }
  assert.equal(await page.locator(".ai-msg--error").count(), 1);
  // A network failure degrades the same way.
  await page.unroute("**/api/ai/chat");
  await page.route("**/api/ai/chat", (r) => r.abort());
  await page.locator("#ai-input").fill("ξανά");
  await page.locator("#ai-input").press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".ai-msg--error").length === 2);
});

await check("keyboard: controls are reachable, Escape closes and returns focus to the launcher, focus is not trapped", async () => {
  const page = await newPage();
  const inWindow = () => page.evaluate(() => document.activeElement?.closest(".ai-window") !== null);
  await page.locator(".ai-launcher").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "HOME88 AI Assistant" }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "ai-input");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await inWindow(), true, "header buttons are reachable");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Νέα συνομιλία");
  await page.keyboard.press("Escape");
  await page.locator(".ai-launcher").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.className), "ai-launcher");

  // Non-modal: Tab from the input eventually leaves the chat for the rest of the page.
  await page.keyboard.press("Enter");
  await page.locator("#ai-input").waitFor();
  let left = false;
  for (let i = 0; i < 6 && !left; i++) { await page.keyboard.press("Tab"); left = !(await inWindow()); }
  assert.equal(left, true, "focus can leave the chat");
  assert.equal(await page.locator(".ai-log").getAttribute("role"), "log");
  assert.equal(await page.locator(".ai-log").getAttribute("aria-live"), "polite");
  assert.equal(await page.locator("label[for=ai-input]").count(), 1);
});

await check("mobile: the window fits the viewport and the launcher does not cover the consent buttons", async () => {
  const page = await newPage({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  const l = await page.locator(".ai-launcher").boundingBox();
  const consent = await page.locator(".consent").boundingBox().catch(() => null);
  if (consent) assert.ok(l.y + l.height <= consent.y + 1, "launcher sits above the consent bar");
  await page.locator(".ai-launcher").tap();
  const w = await page.locator(".ai-window").boundingBox();
  assert.ok(w.x >= 0 && w.x + w.width <= 375 && w.y >= 0 && w.y + w.height <= 667, JSON.stringify(w));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no horizontal scroll");
});

await check("reduced motion: no animation loop, no head transform, no blinking", async () => {
  const page = await newPage({ reducedMotion: "reduce" });
  const box = await page.locator(".ai-launcher").boundingBox();
  await page.mouse.move(2, box.y + 46, { steps: 5 });
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".ai-launcher svg g[transform]").count(), 0, "eyes stay still");
  assert.equal(await page.locator(".ai-launcher .fox__body").evaluate((el) => getComputedStyle(el).animationName), "none");
  await page.waitForTimeout(2500);
  assert.equal(await page.locator(".ai-launcher svg polygon[opacity='1']").count(), 0, "no blink");
});

await check("the fox artwork is served", async () => {
  const res = await (await browser.newContext()).request.get(BASE + "/images/fox/home88-fox-assistant.webp");
  assert.equal(res.status(), 200);
});

await browser.close();
if (failures) { console.error(`${failures} UI check(s) failed`); process.exit(1); }
console.log("all UI checks passed");
