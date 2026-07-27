import { defineConfig, devices } from "@playwright/test";

/**
 * Browser + visual regression config (CI/CD directive §7.4/§7.5).
 *
 * Serves the built stable WebGL2 artifacts over http on a fixed port and runs
 * the renderer smoke + visual tests across Chromium, Firefox and WebKit. These
 * tests require `npm run build` first (they load vault-kosmos.html) and the
 * Playwright browsers (`npx playwright install`).
 *
 * SOFTWARE GL (CI): headless CI runners have no GPU. Without the flags below a
 * WebGL2 context cannot be created at all and every renderer spec times out on
 * `waitForFunction` — which is exactly how the `Browser` workflow came to be
 * red on every push. Chromium is driven onto ANGLE/SwiftShader, a conformant
 * software WebGL2 implementation the r185 renderer accepts; Firefox needs its
 * WebGL2 gate re-opened because the Playwright build ships with
 * `AllowWebgl2:false`. WebKit has no equivalent knob — its WebGL support on
 * headless Linux is not dependable, which is why firefox/webkit run in the
 * advisory `Browser (full matrix)` workflow rather than the per-push gate.
 */
const PORT = 8330;

const CHROMIUM_SOFTWARE_GL = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--disable-gpu-sandbox",
];

const FIREFOX_SOFTWARE_GL = {
  "webgl.force-enabled": true,
  "webgl.disabled": false,
  "webgl.enable-webgl2": true,
  "webgl.forbid-software": false,
};

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
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: CHROMIUM_SOFTWARE_GL } },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], launchOptions: { firefoxUserPrefs: FIREFOX_SOFTWARE_GL } },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], launchOptions: { args: CHROMIUM_SOFTWARE_GL } },
    },
  ],
});
