import { test, expect } from "@playwright/test";

/**
 * Plugin embed sandbox harness (CI/CD directive §7.4). Loads dist/kosmos-embed.html
 * inside a sandboxed, opaque-origin iframe (allow-scripts allow-pointer-lock
 * allow-downloads — NO allow-same-origin, matching the plugin) and drives it via
 * the versioned postMessage protocol, confirming the r185 renderer initializes
 * and renders under sandbox. Run after `npm run build`.
 */
test("embed renders under the plugin sandbox (no allow-same-origin)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  // Host page that embeds the sandboxed iframe and feeds it a snapshot.
  await page.goto("/test/browser/embed-harness.html");
  await page.waitForFunction(() => (window as any).__embedReady === true, null, { timeout: 20_000 });

  const ok = await page.evaluate(() => (window as any).__embedOk);
  expect(ok, "embed reported a rendered scene").toBeTruthy();
  expect(errors).toEqual([]);
});
