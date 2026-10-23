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
  assert.match(source, /Flat GKX 2\.2 Properties are the human authoring surface/);
  for (const provider of ["S3-compatible object storage", "Dropbox", "Microsoft OneDrive", "Google Drive"]) assert.match(source, new RegExp(provider));
  assert.doesNotMatch(source, /enhanceSectionNavigation|openSections/);
});

test("Default-sensitivity setting sits before the Agent API enable toggle and fires a network disclosure", async () => {
  const source = await readFile(settingsPath, "utf8");
  const defIdx = source.indexOf('"Default sensitivity for unlabeled notes"');
  const enableIdx = source.indexOf('"Enable local Agent API"');
  assert.ok(defIdx > -1, "Default sensitivity setting present");
  assert.ok(enableIdx > -1, "Enable toggle present");
  assert.ok(defIdx < enableIdx, "Default sensitivity must render before the enable toggle");
  // Options come from the engine vocabulary, not a hardcoded list.
  assert.match(source, /for \(const level of SENSITIVITY_LEVELS\)/);
  // Enabling with a network-facing surface (LAN bind or active Nextcloud sync) warns the user.
  assert.match(source, /agentBindMode === "lan"/);
  assert.match(source, /nextcloudSettings\?\.enabled === true/);
  assert.match(source, /may be reachable over the network/);
  // Raise-only semantics are documented in the setting description.
  assert.match(source, /raise-only/i);
});

test("Options CSS stacks controls on mobile and keeps tabs horizontally reachable", async () => {
  const css = await readFile(stylesPath, "utf8");
  assert.match(css, /\.kosmos-settings-tabs[\s\S]*grid-template-columns:\s*repeat\(4/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.kosmos-settings-tabs[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /\.kosmos-settings-panel \.setting-item[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.kosmos-settings-panel\[hidden\][^{]*\{\s*display:\s*none/);
});
