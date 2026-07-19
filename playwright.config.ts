import { defineConfig, devices } from "@playwright/test";

/**
 * Browser + visual regression config (CI/CD directive §7.4/§7.5).
 *
 * Serves the built stable WebGL2 artifacts over http on a fixed port and runs
 * the renderer smoke + visual tests across Chromium, Firefox and WebKit. These
 * tests require `npm run build` first (they load vault-kosmos.html) and the
 * Playwright browsers (`npx playwright install`). They are the real-browser
 * rendering gate the assessment flags as the largest assurance gap; they are
 * scaffolding here — wire them into browser.yml / visual.yml in CI.
 */
const PORT = 8330;

export default defineConfig({
  testDir: "test/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  // Serve the repo root (built artifacts + node bundles) statically.
  webServer: {
    command: "node scripts/serve-static.mjs " + PORT,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Deterministic screenshots: fixed viewport + DPR, animations disabled.
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: "on-first-retry",
  },
  // Perceptual tolerance — do NOT demand bit-for-bit equality across GPU vendors.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, threshold: 0.2 } },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
