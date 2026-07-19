/**
 * Kosmos standalone — resilient rescan-and-diff monitor (§9).
 *
 * No nonstandard filesystem watcher: the monitor re-enumerates the persistent
 * directory handle and diffs signatures (path/type/size/mtime). Triggers:
 *   - after initial folder selection (host calls scanNow)
 *   - window focus regained
 *   - page becomes visible again (immediate rescan)
 *   - manual "Rescan Now"
 *   - low-frequency polling while visible (default 3.5s); suspended while hidden
 */
import { diffSnapshots, type DirectorySnapshot, type KnowledgeSource, type SnapshotDiff } from "./directory-source";

export interface MonitorCallbacks {
  onDiff: (diff: SnapshotDiff, snapshot: DirectorySnapshot) => void;
  onError: (message: string) => void;
  onScan?: (snapshot: DirectorySnapshot) => void;
}

export interface MonitorOptions {
  /** Polling interval while the page is visible (ms). */
  intervalMs?: number;
}

export class DirectoryMonitor {
  private source: KnowledgeSource;
  private cb: MonitorCallbacks;
  private intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scanning = false;
  private stopped = false;
  paused = false;
  lastSnapshot: DirectorySnapshot | null = null;
  lastScanAt = 0;

  private onFocus = () => { void this.scanNow("focus"); };
  private onVisibility = () => {
    if (document.visibilityState === "visible") {
      void this.scanNow("visibility");
      this.scheduleNext();
    } else {
      this.clearTimer(); // suspend polling while hidden (§9.2)
    }
  };

  constructor(source: KnowledgeSource, initial: DirectorySnapshot, cb: MonitorCallbacks, opts: MonitorOptions = {}) {
    this.source = source;
    this.cb = cb;
    this.intervalMs = Math.max(1000, opts.intervalMs ?? 3500);
    this.lastSnapshot = initial;
    this.lastScanAt = initial.scannedAt;
  }

  start(): void {
    if (!this.source.canRescan) return; // snapshot mode: nothing to monitor
    this.stopped = false;
    window.addEventListener("focus", this.onFocus);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    window.removeEventListener("focus", this.onFocus);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; void this.scanNow("resume"); }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private scheduleNext(): void {
    this.clearTimer();
    if (this.stopped) return;
    this.timer = setTimeout(() => { void this.tick(); }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    if (document.visibilityState === "visible" && !this.paused) {
      await this.scanNow("poll");
    }
    this.scheduleNext();
  }

  /** Scan + diff once. Returns the diff, or null when scanning was skipped. */
  async scanNow(_reason: string): Promise<SnapshotDiff | null> {
    if (this.scanning || this.paused || !this.source.canRescan) return null;
    this.scanning = true;
    try {
      const next = await this.source.scan();
      this.lastScanAt = next.scannedAt;
      this.cb.onScan?.(next);
      for (const e of next.errors) this.cb.onError(e);
      const prev = this.lastSnapshot;
      this.lastSnapshot = next;
      if (!prev) return null;
      const diff = diffSnapshots(prev, next);
      if (!diff.isEmpty) this.cb.onDiff(diff, next);
      return diff;
    } catch (e: any) {
      // Permission lost / device detached: report but keep the page alive (§19.3)
      this.cb.onError(
        e?.name === "NotAllowedError"
          ? "Folder permission lost — click Rescan to re-authorize"
          : `Rescan failed: ${e?.message || e}`
      );
      return null;
    } finally {
      this.scanning = false;
    }
  }
}
