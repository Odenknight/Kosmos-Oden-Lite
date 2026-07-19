/**
 * Kosmos standalone — folder-handle persistence (§7).
 *
 * Stores the selected directory HANDLE (a structured-clonable object) in
 * IndexedDB so "Reopen Last Folder" can restore it on the next visit. Note
 * contents are never stored in browser storage — only the handle and its
 * display name. Access always goes back through the browser's permission
 * prompt when required; the folder is never read without authorization.
 */

const DB_NAME = "kosmos-oden";
const STORE = "handles";
const KEY = "lastFolder";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeHandle(handle: unknown, name: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ handle, name, storedAt: Date.now() }, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadStoredHandle(): Promise<{ handle: any; name: string } | null> {
  try {
    const db = await openDb();
    const rec = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rec && rec.handle ? { handle: rec.handle, name: rec.name || "Folder" } : null;
  } catch {
    return null;
  }
}

/** "Forget Folder": remove the persisted handle (§7). */
export async function forgetStoredHandle(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* nothing persisted */
  }
}

/**
 * Check/request read permission on a stored handle. Returns:
 *  'granted'  — usable right away
 *  'prompt'   — user gesture required; call requestPermission from a click
 *  'denied'   — user refused
 */
export async function permissionState(handle: any): Promise<"granted" | "prompt" | "denied"> {
  try {
    const q = await handle.queryPermission({ mode: "read" });
    return q as any;
  } catch {
    return "prompt";
  }
}

export async function requestPermission(handle: any): Promise<boolean> {
  try {
    const r = await handle.requestPermission({ mode: "read" });
    return r === "granted";
  } catch {
    return false;
  }
}
