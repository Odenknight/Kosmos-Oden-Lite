/** DOM/Obsidian-free public surface used by the sync planner tests. */
export {
  buildNextcloudDavRoot,
  effectiveSyncExcludes,
  emptyNextcloudState,
  isExcluded,
  migrateNextcloudSettings,
  migrateNextcloudState,
  normalizeRemotePath,
  planSync,
  safeRelativePath,
  syncScope,
} from "./nextcloud-sync-core";
export type { LocalEntry, RemoteEntry, SyncRecord } from "./nextcloud-sync-core";
