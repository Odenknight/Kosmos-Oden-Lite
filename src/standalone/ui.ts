/**
 * Kosmos standalone — startup + status UI (§19).
 *
 * Injected at runtime on top of the shared Kosmos page so the embed (plugin)
 * and standalone artifacts share one body template. Capability-gated startup
 * controls, a live status panel, rescan controls, an in-page error log
 * (§19.3) and export actions (§34). Pure local DOM — no server, no network.
 */

export interface StandaloneUIHandlers {
  onOpenFolder: () => void;
  onReopenLast: () => void;
  onOpenSnapshot: (files: FileList) => void;
  onLoadDemo: () => void;
  onRescan: () => void;
  onPauseMonitor: () => void;
  onResumeMonitor: () => void;
  onForgetFolder: () => void;
  onExportGraph: () => void;
  onExportEpisodes: () => void;
}

export interface StatusModel {
  source?: string;
  mode?: "persistent" | "snapshot" | "demo" | "none";
  monitoring?: "active" | "paused" | "unavailable";
  lastScanAt?: number;
  notes?: number;
  folders?: number;
  attachments?: number;
  unresolvedLinks?: number;
  lineageEdges?: number;
  headNotes?: number;
  supersededNotes?: number;
  lineageWarnings?: string[];
  residualCollisions?: number;
}

export interface StandaloneUI {
  showStartup(opts: { canPicker: boolean; canReopen: boolean; reopenName?: string }): void;
  hideStartup(): void;
  setStatus(model: StatusModel): void;
  setMonitorState(state: "active" | "paused" | "unavailable"): void;
  addError(message: string): void;
  clearErrors(): void;
}

const CSS = `
.ko-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(3,6,15,.9);backdrop-filter:blur(6px)}
.ko-card{max-width:440px;width:calc(100% - 48px);background:rgba(10,16,30,.92);border:1px solid rgba(140,170,210,.2);border-radius:16px;padding:26px 26px 22px;color:#f3f7ff;font:400 14px/1.5 var(--font,system-ui,sans-serif);box-shadow:0 24px 60px rgba(0,0,0,.6)}
.ko-card h2{margin:0 0 4px;font-size:19px}
.ko-card .ko-sub{color:#9fb0c6;font-size:12.5px;margin:0 0 18px}
.ko-btn{display:block;width:100%;margin:8px 0;padding:11px 14px;border-radius:10px;border:1px solid rgba(125,211,252,.35);background:rgba(125,211,252,.1);color:#e7eefc;font:600 14px/1.2 var(--font,system-ui,sans-serif);cursor:pointer;text-align:left;transition:background .15s}
.ko-btn:hover{background:rgba(125,211,252,.22)}
.ko-btn small{display:block;font-weight:400;color:#9fb0c6;font-size:11.5px;margin-top:3px}
.ko-btn.ko-ghost{border-color:rgba(140,170,210,.18);background:transparent}
.ko-note{margin-top:14px;color:#5f7088;font-size:11px}
.ko-status{position:fixed;right:14px;top:64px;z-index:40;width:225px;background:rgba(10,16,30,.72);border:1px solid rgba(140,170,210,.16);border-radius:12px;padding:10px 12px;color:#c9d6ea;font:400 11.5px/1.55 var(--mono,monospace);backdrop-filter:blur(8px)}
.ko-status h4{margin:0 0 6px;font:700 11px/1 var(--font,system-ui,sans-serif);letter-spacing:.08em;text-transform:uppercase;color:#7dd3fc;display:flex;justify-content:space-between;align-items:center}
.ko-status h4 button{border:none;background:transparent;color:#5f7088;cursor:pointer;font-size:13px;padding:0}
.ko-status .ko-row{display:flex;justify-content:space-between;gap:8px}
.ko-status .ko-row b{color:#f3f7ff;font-weight:600}
.ko-status .ko-actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.ko-status .ko-actions button{flex:1 1 45%;padding:5px 6px;border-radius:7px;border:1px solid rgba(125,211,252,.25);background:rgba(125,211,252,.07);color:#c9d6ea;font:600 10.5px/1.2 var(--font,system-ui,sans-serif);cursor:pointer}
.ko-status .ko-actions button:hover{background:rgba(125,211,252,.18)}
.ko-status.ko-min .ko-body{display:none}
.ko-errors{position:fixed;left:14px;bottom:96px;z-index:45;max-width:340px;display:flex;flex-direction:column;gap:6px}
.ko-err{background:rgba(60,18,28,.92);border:1px solid rgba(251,113,133,.4);color:#ffd7dd;border-radius:10px;padding:8px 30px 8px 12px;font:500 12px/1.4 var(--font,system-ui,sans-serif);position:relative}
.ko-err button{position:absolute;right:6px;top:6px;border:none;background:transparent;color:#fb7185;cursor:pointer;font-size:13px}
@media (max-width:760px){.ko-status{top:auto;bottom:150px;right:10px;width:200px}.ko-errors{bottom:150px}}
`;

export function createStandaloneUI(handlers: StandaloneUIHandlers): StandaloneUI {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  /* hidden webkitdirectory input (fallback picker, §6.2) */
  const dirInput = document.createElement("input");
  dirInput.type = "file";
  (dirInput as any).webkitdirectory = true;
  dirInput.setAttribute("webkitdirectory", "");
  dirInput.setAttribute("directory", "");
  dirInput.multiple = true;
  dirInput.style.display = "none";
  document.body.appendChild(dirInput);
  dirInput.addEventListener("change", () => {
    if (dirInput.files && dirInput.files.length) handlers.onOpenSnapshot(dirInput.files);
    dirInput.value = "";
  });

  /* ---- startup overlay ---- */
  const overlay = document.createElement("div");
  overlay.className = "ko-overlay";
  overlay.style.display = "none";
  document.body.appendChild(overlay);

  function showStartup(opts: { canPicker: boolean; canReopen: boolean; reopenName?: string }): void {
    overlay.innerHTML = "";
    const card = document.createElement("div");
    card.className = "ko-card";
    card.innerHTML = `<h2>Vault Kosmos — Standalone</h2>
      <p class="ko-sub">Open a folder of Markdown notes (an Obsidian vault or any knowledge base) and explore it as a 3D cosmos. Everything runs locally in this page — nothing is uploaded, nothing is modified.</p>`;
    const mkBtn = (label: string, sub: string, ghost: boolean, onClick: () => void) => {
      const b = document.createElement("button");
      b.className = "ko-btn" + (ghost ? " ko-ghost" : "");
      b.innerHTML = `${label}<small>${sub}</small>`;
      b.addEventListener("click", onClick);
      card.appendChild(b);
      return b;
    };
    if (opts.canPicker) {
      mkBtn("Open Knowledge Folder", "Persistent folder access — Kosmos watches for changes while the page is open", false, handlers.onOpenFolder);
      if (opts.canReopen) {
        mkBtn(`Reopen Last Folder${opts.reopenName ? ` — ${opts.reopenName}` : ""}`, "Restore the previously selected folder (the browser may ask to confirm access)", false, handlers.onReopenLast);
      }
    }
    mkBtn(
      "Open Folder Snapshot",
      opts.canPicker
        ? "One-time import via the file picker — no live monitoring"
        : "Your browser does not support persistent folder access; this imports a static snapshot",
      opts.canPicker,
      () => dirInput.click()
    );
    mkBtn("Load Demo", "Explore a built-in demo cosmos — no files needed", true, handlers.onLoadDemo);
    const note = document.createElement("p");
    note.className = "ko-note";
    note.textContent = "Read-only by design: Kosmos never renames, edits, moves or deletes your files. Works fully offline.";
    card.appendChild(note);
    overlay.appendChild(card);
    overlay.style.display = "flex";
  }
  function hideStartup(): void { overlay.style.display = "none"; }

  /* ---- status panel (§19.1) ---- */
  const status = document.createElement("div");
  status.className = "ko-status";
  status.style.display = "none";
  document.body.appendChild(status);
  let model: StatusModel = {};
  let tick: any = null;

  function fmtAgo(t?: number): string {
    if (!t) return "—";
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 2) return "just now";
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
  }
  const MODE_LABEL: Record<string, string> = {
    persistent: "Persistent folder access",
    snapshot: "Imported folder snapshot",
    demo: "Demo",
    none: "—",
  };
  function render(): void {
    const m = model;
    const esc = (s: any) => String(s ?? "—").replace(/[&<>]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as any)[c]));
    const rows: Array<[string, any]> = [
      ["Source", m.source],
      ["Mode", MODE_LABEL[m.mode || "none"]],
      ["Monitoring", m.monitoring === "active" ? "Active" : m.monitoring === "paused" ? "Paused" : "Unavailable"],
      ["Last scan", fmtAgo(m.lastScanAt)],
      ["Notes", m.notes],
      ["Folders", m.folders],
      ["Attachments", m.attachments],
      ["Unresolved links", m.unresolvedLinks],
      ["Lineage edges", m.lineageEdges],
      ["HEAD notes", m.headNotes],
      ["Superseded", m.supersededNotes],
    ];
    if (m.residualCollisions != null && m.residualCollisions > 0) rows.push(["Residual overlaps", m.residualCollisions]);
    if (m.lineageWarnings && m.lineageWarnings.length) rows.push(["Lineage warnings", m.lineageWarnings.length]);
    const showMonitorControls = m.mode === "persistent";
    status.innerHTML = `<h4><span>Kosmos Status</span><button title="Collapse" data-act="min">▾</button></h4>
      <div class="ko-body">
        ${rows.map(([k, v]) => `<div class="ko-row"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}
        <div class="ko-actions">
          ${showMonitorControls ? `<button data-act="rescan">Rescan Now</button>
          <button data-act="pause">${m.monitoring === "paused" ? "Resume" : "Pause"} Monitoring</button>
          <button data-act="forget">Forget Folder</button>` : ""}
          ${m.mode !== "none" ? `<button data-act="exportGraph">Export Graph JSON</button>
          <button data-act="exportEpisodes">Export Graphiti Episodes</button>` : ""}
          <button data-act="reopen">Open Another Folder</button>
        </div>
      </div>`;
    status.querySelectorAll("button[data-act]").forEach((b: any) => {
      b.addEventListener("click", () => {
        const act = b.dataset.act;
        if (act === "min") status.classList.toggle("ko-min");
        else if (act === "rescan") handlers.onRescan();
        else if (act === "pause") (model.monitoring === "paused" ? handlers.onResumeMonitor : handlers.onPauseMonitor)();
        else if (act === "forget") handlers.onForgetFolder();
        else if (act === "exportGraph") handlers.onExportGraph();
        else if (act === "exportEpisodes") handlers.onExportEpisodes();
        else if (act === "reopen") location.reload();
      });
    });
  }
  function setStatus(m: StatusModel): void {
    model = { ...model, ...m };
    status.style.display = "block";
    render();
    if (!tick) tick = setInterval(() => { const el = status.querySelector(".ko-row b"); if (el && model.lastScanAt) render(); }, 5000);
  }
  function setMonitorState(state: "active" | "paused" | "unavailable"): void {
    setStatus({ monitoring: state });
  }

  /* ---- in-page error log (§19.3) ---- */
  const errHost = document.createElement("div");
  errHost.className = "ko-errors";
  document.body.appendChild(errHost);
  const seen = new Set<string>();
  function addError(message: string): void {
    if (seen.has(message)) return; // don't stack duplicates every poll
    seen.add(message);
    const el = document.createElement("div");
    el.className = "ko-err";
    el.textContent = message;
    const x = document.createElement("button");
    x.textContent = "×";
    x.addEventListener("click", () => { el.remove(); seen.delete(message); });
    el.appendChild(x);
    errHost.appendChild(el);
    while (errHost.children.length > 5) errHost.firstElementChild!.remove();
  }
  function clearErrors(): void { errHost.innerHTML = ""; seen.clear(); }

  return { showStartup, hideStartup, setStatus, setMonitorState, addError, clearErrors };
}

/** Trigger a browser download for generated content (§34 — no filesystem writes). */
export function downloadFile(name: string, content: string, type = "application/json"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
