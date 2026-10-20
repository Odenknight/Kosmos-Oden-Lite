/**
 * One-time settings import from the plugin's former id.
 *
 * The plugin id changed in the breaking GKX rename. When this plugin has no
 * saved data yet, main.ts reads the former plugin folder's data.json once,
 * passes it through importLegacySettings(), and saves the result as this
 * plugin's own data. The former folder is never modified or deleted.
 *
 * Pure and Obsidian-free so it can be unit-tested in Node.
 */

/** Plugin id used before the rename; its folder is read, never written. */
export const LEGACY_PLUGIN_ID = "vault-kosmos-oden";
/** Prefix of the former Nextcloud Secret Storage id. */
export const LEGACY_NEXTCLOUD_SECRET_PREFIX = "vault-kosmos-nextcloud-";
/** Former settings-key prefix and its replacement. */
const LEGACY_KEY_PREFIX = "okf";
const KEY_PREFIX = "gkx";

/** True when the plugin has no saved settings of its own. */
export function isEmptyPluginData(data: unknown): boolean {
  return data == null || (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0);
}

/**
 * Rename former settings keys (okf* to gkx*). Every other key and every value,
 * including nested Nextcloud settings and sync state, is kept unchanged. A key
 * already present under its new name wins over its former name. Returns null
 * for data that is not a settings object.
 */
export function importLegacySettings(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, unknown> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (!key.startsWith(LEGACY_KEY_PREFIX)) out[key] = value;
  }
  for (const [key, value] of entries) {
    if (!key.startsWith(LEGACY_KEY_PREFIX)) continue;
    const renamed = KEY_PREFIX + key.slice(LEGACY_KEY_PREFIX.length);
    if (!(renamed in out)) out[renamed] = value;
  }
  return out;
}

/** FNV-1a 32-bit hash as lowercase hex; used for per-vault Secret Storage ids. */
export function fnv1a32Hex(source: string): string {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}

/** Secret Storage id the former plugin used for this vault's Nextcloud password. */
export function legacyNextcloudSecretId(vaultName: string): string {
  return LEGACY_NEXTCLOUD_SECRET_PREFIX + fnv1a32Hex(`${LEGACY_PLUGIN_ID}-${vaultName}`.toLowerCase());
}
