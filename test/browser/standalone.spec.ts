import { test, expect } from "@playwright/test";

/**
 * Real-browser smoke test for the stable WebGL2 standalone artifact
 * (CI/CD directive §7.4). Uses deterministic capture mode so the scene boots
 * without a folder picker. Run after `npm run build`.
 */
const CAPTURE = "/vault-kosmos.html?capture=1&seed=1907&time=0&dpr=1&quality=high&camera=overview&animation=off";

test("standalone boots the r185 WebGL2 renderer and draws the demo cosmos", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(CAPTURE);

  // renderer descriptor is exposed once createKosmosApp runs
  await page.waitForFunction(() => (window as any).__kosmosRenderer != null, null, { timeout: 15_000 });
  const r = await page.evaluate(() => (window as any).__kosmosRenderer);
  expect(r.backend).toBe("webgl2");
  expect(r.threeRevision).toBe("185");

  // the demo scene reaches a ready state (boot overlay clears, stats populate)
  await page.waitForFunction(() => {
    const b = document.getElementById("boot");
    return b && b.classList.contains("gone");
  }, null, { timeout: 15_000 });
  const stats = await page.locator("#stats").innerText();
  expect(stats).toMatch(/nodes/i);

  // canvas present and at least one frame produced while visible
  await page.waitForFunction(() => (window as any).__kosmosRenderStats?.frames > 0, null, { timeout: 15_000 });
  expect(await page.locator("#stage canvas").count()).toBe(1);

  // no external network requests were emitted (offline promise)
  expect(errors, "no console/page errors").toEqual([]);
});

test("standalone reports WebGL2 requirement message when WebGL2 is unavailable", async ({ page }) => {
  // Force getContext('webgl2') to fail before any script runs.
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // @ts-ignore
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: any[]) {
      if (type === "webgl2") return null;
      return orig.call(this, type, ...rest);
    };
  });
  await page.goto(CAPTURE);
  await expect(page.locator("#bootMsg")).toContainText(/WebGL2/i, { timeout: 10_000 });
});

test("agent traversal renders a breadcrumb plus bounded comet dust", async ({ page }) => {
  await page.goto(CAPTURE);
  await page.waitForFunction(() => (window as any).__kosmos?.ok === true, null, { timeout: 15_000 });
  await page.evaluate(() => {
    const k=(window as any).__kosmos;
    k.notifyAgentTraversal(["10_Research/Literature Radar.md"],"get_note","Codex");
    k.notifyAgentTraversal(["10_Research/Spatial Computing.md"],"get_related","Codex");
  });
  await page.waitForFunction(() => {
    const d=(window as any).__kosmos?.getDiagnostics?.();
    return d?.agentTraversalHops >= 2 && d?.agentDustParticles > 0;
  }, null, { timeout: 5_000 });
  const d=await page.evaluate(() => (window as any).__kosmos.getDiagnostics());
  expect(d.agentTraversalHops).toBeGreaterThanOrEqual(2);
  expect(d.agentDustParticles).toBeGreaterThan(0);
  expect(d.agentDustParticles).toBeLessThanOrEqual(640);
});

test("primary controls remain inside compact-desktop and mobile viewports", async ({ page }) => {
  await page.goto("/vault-kosmos.html");
  await page.getByRole("button", { name: /Load Demo/ }).click();
  await page.waitForFunction(() => document.getElementById("boot")?.classList.contains("gone"), null, { timeout: 15_000 });
  for (const viewport of [
    { width: 1468, height: 891 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 800, height: 600 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector) as HTMLElement | null;
        if (!element || getComputedStyle(element).display === "none") return null;
        const box = element.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      };
      const buttons = Array.from(document.querySelectorAll(".deck button"))
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => { const box = element.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }; });
      return { deck: rect(".deck"), brand: rect(".brand"), toolbar: rect(".toolbar"), legend: rect(".legend"), buttons };
    });
    for (const box of [layout.deck, layout.brand, layout.toolbar, ...layout.buttons]) {
      expect(box).not.toBeNull();
      expect(box!.left).toBeGreaterThanOrEqual(-0.5);
      expect(box!.top).toBeGreaterThanOrEqual(-0.5);
      expect(box!.right).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(box!.bottom).toBeLessThanOrEqual(viewport.height + 0.5);
    }
    if (layout.legend) expect(layout.deck!.right).toBeLessThanOrEqual(layout.legend.left);
  }
});

test("constellation key and minimap can be shown from the toolbar", async ({ page }) => {
  await page.goto("/vault-kosmos.html");
  await page.getByRole("button", { name: /Load Demo/ }).click();
  await page.waitForFunction(() => document.getElementById("boot")?.classList.contains("gone"), null, { timeout: 15_000 });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator(".legend")).toBeHidden();
  await page.locator("#legendToggle").click();
  await expect(page.locator(".legend")).toBeVisible();
  await expect(page.locator(".mmwrap")).toBeVisible();
  await expect(page.locator("#legendToggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#timelineBtn")).toHaveCount(0);
});
