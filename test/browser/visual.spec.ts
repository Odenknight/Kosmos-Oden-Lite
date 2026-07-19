import { test, expect } from "@playwright/test";

/**
 * Deterministic visual-regression baselines (CI/CD directive §7.5).
 * Per-browser reference images with a perceptual threshold — NOT bit-for-bit
 * across GPU vendors. An agent may propose a new baseline but must not approve
 * its own visual-baseline update. Run after `npm run build`; generate baselines
 * with `playwright test --update-snapshots` on the reference machine.
 */
const base = (extra: string) =>
  `/vault-kosmos.html?capture=1&seed=1907&time=0&dpr=1&animation=off&${extra}`;

const VIEWS: Array<{ name: string; q: string }> = [
  { name: "overview-high", q: "quality=high&camera=overview" },
  { name: "overview-lite", q: "quality=lite&camera=overview" },
  { name: "star-focus", q: "quality=high&camera=focus" },
];

for (const v of VIEWS) {
  test(`visual: ${v.name}`, async ({ page }) => {
    await page.goto(base(v.q));
    await page.waitForFunction(() => {
      const b = document.getElementById("boot");
      return b && b.classList.contains("gone") && (window as any).__kosmosRenderStats?.frames > 1;
    }, null, { timeout: 15_000 });
    // let the frozen (deterministic) frame settle
    await page.waitForTimeout(400);
    await expect(page.locator("#stage canvas")).toHaveScreenshot(`${v.name}.png`);
  });
}
