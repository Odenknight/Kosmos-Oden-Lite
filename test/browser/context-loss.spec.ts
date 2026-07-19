import { test, expect } from "@playwright/test";

/**
 * WebGL2 context loss/restore behavior (build-instructions §11).
 * Uses WEBGL_lose_context to force loss, then confirms the renderer stops
 * cleanly, shows a recovering state, and rebuilds + resumes on restore.
 * Chromium-only (reliable lose_context extension). Run after `npm run build`.
 */
test.describe("context loss", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "lose_context is reliable on Chromium");

  test("loses and restores the WebGL2 context without a frozen canvas", async ({ page }) => {
    await page.goto("/vault-kosmos.html?capture=1&seed=1907&time=0&dpr=1&quality=high&camera=overview");
    await page.waitForFunction(() => (window as any).__kosmosRenderStats?.frames > 0, null, { timeout: 15_000 });

    // Force context loss via the debug extension on the live canvas.
    await page.evaluate(() => {
      const c = document.querySelector("#stage canvas") as HTMLCanvasElement;
      const gl = c.getContext("webgl2");
      const ext = gl && (gl.getExtension("WEBGL_lose_context") as any);
      if (ext) ext.loseContext();
    });
    // recovering state shown, loop stopped
    await expect(page.locator("#bootMsg")).toContainText(/recovering/i, { timeout: 10_000 });

    // Restore and confirm the loop resumes and the scene rebuilds.
    await page.evaluate(() => {
      const c = document.querySelector("#stage canvas") as HTMLCanvasElement;
      const gl = c.getContext("webgl2");
      const ext = gl && (gl.getExtension("WEBGL_lose_context") as any);
      if (ext) setTimeout(() => ext.restoreContext(), 50);
    });
    await page.waitForFunction(() => (window as any).__kosmosRenderStats?.running === true, null, { timeout: 15_000 });
  });
});
