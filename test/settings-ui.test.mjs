import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPath = new URL("../src/plugin/settings.ts", import.meta.url);
const stylesPath = new URL("../styles.css", import.meta.url);

test("Options exposes the four required first-class tabs and routes Sync controls to Sync", async () => {
  const source = await readFile(settingsPath, "utf8");
  for (const label of [
    "Agent API (HTTP + MCP)",
    "GKOS Note Formatting",
    "Quick Connect MCP",
    "Connectivity to Sync Vault",
  ]) assert.match(source, new RegExp(label.replace(/[+()]/g, "\\$&")));
  assert.match(source, /role\", \"tablist/);
  assert.match(source, /role\", \"tabpanel/);
  assert.match(source, /new Setting\(syncEl\)\.setName\(\"Nextcloud server URL\"\)/);
  assert.match(source, /new Setting\(syncEl\)\.setName\(\"Sync hidden Obsidian configuration \(\.obsidian\)\"\)/);
  for (const label of ["Scan and repair", "Convert all to editable 2.2", "Convert all to editable 2.3", "Scan labels and links"]) assert.ok(source.includes(label));
  assert.match(source, /Flat OKF\+ 2\.2 Properties are the human authoring surface/);
  for (const provider of ["S3-compatible object storage", "Dropbox", "Microsoft OneDrive", "Google Drive"]) assert.match(source, new RegExp(provider));
  assert.doesNotMatch(source, /enhanceSectionNavigation|openSections/);
});

test("Options CSS stacks controls on mobile and keeps tabs horizontally reachable", async () => {
  const css = await readFile(stylesPath, "utf8");
  assert.match(css, /\.kosmos-settings-tabs[\s\S]*grid-template-columns:\s*repeat\(4/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.kosmos-settings-tabs[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /\.kosmos-settings-panel \.setting-item[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.kosmos-settings-panel\[hidden\][^{]*\{\s*display:\s*none/);
});
