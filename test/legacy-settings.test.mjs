import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_PLUGIN_ID,
  fnv1a32Hex,
  importLegacySettings,
  isEmptyPluginData,
  legacyNextcloudSecretId,
} from "../dist/kosmos-legacy-settings.mjs";

test("legacy settings import renames former okf* keys to gkx* and keeps everything else", () => {
  const legacy = {
    schemaVersion: 2,
    agentEnabled: true,
    agentToken: "t0ken",
    okfEnrichmentProvider: "lan",
    okfEnrichmentEndpoint: "http://192.168.1.5:11434/v1/chat/completions",
    okfEnrichmentMaxNotes: 40,
    okfExcludePatterns: ["private/**"],
    okfDeveloperExclusions: true,
    nextcloud: { serverUrl: "https://cloud.example.com", remoteFolder: "Cloud/Main" },
    nextcloudState: { schemaVersion: 2, scope: "s", files: {} },
  };
  const imported = importLegacySettings(legacy);
  assert.deepEqual(imported, {
    schemaVersion: 2,
    agentEnabled: true,
    agentToken: "t0ken",
    nextcloud: { serverUrl: "https://cloud.example.com", remoteFolder: "Cloud/Main" },
    nextcloudState: { schemaVersion: 2, scope: "s", files: {} },
    gkxEnrichmentProvider: "lan",
    gkxEnrichmentEndpoint: "http://192.168.1.5:11434/v1/chat/completions",
    gkxEnrichmentMaxNotes: 40,
    gkxExcludePatterns: ["private/**"],
    gkxDeveloperExclusions: true,
  });
  assert.ok(!Object.keys(imported).some((key) => key.startsWith("okf")), "no former key survives");
  assert.equal(legacy.okfEnrichmentProvider, "lan", "input is not mutated");
});

test("legacy settings import prefers an existing gkx* key and rejects non-objects", () => {
  assert.deepEqual(importLegacySettings({ okfEnrichmentModel: "old", gkxEnrichmentModel: "new" }), { gkxEnrichmentModel: "new" });
  for (const bad of [null, undefined, "x", 3, [1, 2]]) assert.equal(importLegacySettings(bad), null);
});

test("empty plugin data triggers the import; saved data does not", () => {
  assert.equal(isEmptyPluginData(null), true);
  assert.equal(isEmptyPluginData(undefined), true);
  assert.equal(isEmptyPluginData({}), true);
  assert.equal(isEmptyPluginData({ agentEnabled: false }), false);
});

test("legacy Nextcloud secret id matches the former plugin's derivation", () => {
  assert.equal(LEGACY_PLUGIN_ID, "vault-kosmos-oden");
  // Former main.ts: FNV-1a over `${manifest.id}-${vaultName}`.toLowerCase(), prefixed.
  assert.equal(legacyNextcloudSecretId("My Vault"), `vault-kosmos-nextcloud-${fnv1a32Hex("vault-kosmos-oden-my vault")}`);
  assert.equal(fnv1a32Hex(""), "811c9dc5");
});
