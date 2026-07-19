import { App, Modal, Notice, Setting, TFile, normalizePath } from "obsidian";
import { publicOkfEnrichmentApplyPlan, verifyOkfEnrichmentApplyPlan, type OkfEnrichmentApplyEntry, type OkfEnrichmentApplyPlan } from "../core/okf-enrichment";

export interface OkfEnrichmentApplyResult {
  runId: string;
  planHash: string;
  applied: string[];
  skippedChanged: string[];
  skippedMissing: string[];
  failed: Array<{ path: string; error: string }>;
  reviewed: number;
  accepted: number;
  rejected: number;
  edited: number;
  backupRoot: string;
  planPath: string;
  resultPath: string;
  completedAt: string;
}
async function ensureFolder(app: App, path: string): Promise<void> {
  let current = "";
  for (const part of normalizePath(path).split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) {
      try { await app.vault.createFolder(current); }
      catch (error) { if (!(await app.vault.adapter.exists(current))) throw error; }
    }
  }
}

export async function saveOkfEnrichmentApplyPlan(app: App, plan: OkfEnrichmentApplyPlan): Promise<string> {
  const root = normalizePath(`.okf/enrichment/${plan.runId}`);
  const path = `${root}/plan.json`;
  await ensureFolder(app, root);
  const serialized = JSON.stringify(publicOkfEnrichmentApplyPlan(plan), null, 2) + "\n";
  if (await app.vault.adapter.exists(path)) {
    if (await app.vault.adapter.read(path) !== serialized) throw new Error(`a different enrichment plan already exists at ${path}`);
  } else await app.vault.adapter.write(path, serialized);
  return path;
}

export async function applyOkfEnrichmentPlan(app: App, plan: OkfEnrichmentApplyPlan): Promise<OkfEnrichmentApplyResult> {
  if (!(await verifyOkfEnrichmentApplyPlan(plan))) throw new Error("approved enrichment plan or in-memory content changed after preview; build a new plan");
  const root = normalizePath(`.okf/enrichment/${plan.runId}`);
  const backupRoot = normalizePath(`.okf/backup/${plan.runId}`);
  const planPath = await saveOkfEnrichmentApplyPlan(app, plan);
  const resultPath = `${root}/result.json`;
  await ensureFolder(app, backupRoot);
  const result: OkfEnrichmentApplyResult = { runId: plan.runId, planHash: plan.planHash, applied: [], skippedChanged: [], skippedMissing: [], failed: [], reviewed: plan.totals.reviewed, accepted: plan.totals.accepted, rejected: plan.totals.rejected, edited: plan.totals.edited, backupRoot, planPath, resultPath, completedAt: "" };
  for (const entry of plan.entries.filter((candidate) => candidate.status === "ready")) {
    try {
      const abstract = app.vault.getAbstractFileByPath(entry.path);
      if (!(abstract instanceof TFile)) { result.skippedMissing.push(entry.path); continue; }
      const live = await app.vault.read(abstract);
      if (live !== entry.originalContent) { result.skippedChanged.push(entry.path); continue; }
      const backupPath = normalizePath(`${backupRoot}/${entry.path}.bak`);
      const slash = backupPath.lastIndexOf("/");
      if (slash > 0) await ensureFolder(app, backupPath.slice(0, slash));
      if (await app.vault.adapter.exists(backupPath)) throw new Error(`backup already exists: ${backupPath}`);
      await app.vault.adapter.writeBinary(backupPath, await app.vault.adapter.readBinary(entry.path));
      let matched = false;
      const written = await app.vault.process(abstract, (current) => {
        if (current !== entry.originalContent) return current;
        matched = true; return entry.proposedContent!;
      });
      if (!matched || written !== entry.proposedContent) result.skippedChanged.push(entry.path);
      else result.applied.push(entry.path);
    } catch (error: any) { result.failed.push({ path: entry.path, error: String(error?.message || error) }); }
  }
  result.completedAt = new Date().toISOString();
  await app.vault.adapter.write(resultPath, JSON.stringify(result, null, 2) + "\n");
  return result;
}

function acknowledgement(parent: HTMLElement, text: string, changed: (checked: boolean) => void): void {
  const label = parent.createEl("label"); label.style.display = "flex"; label.style.gap = "8px"; label.style.alignItems = "flex-start"; label.style.margin = "10px 0";
  const input = label.createEl("input", { type: "checkbox" }); label.createSpan({ text });
  input.addEventListener("change", () => changed(input.checked));
}

function renderEntries(parent: HTMLElement, title: string, entries: OkfEnrichmentApplyEntry[]): void {
  const details = parent.createEl("details"); details.createEl("summary", { text: `${title} (${entries.length})` });
  for (const entry of entries.slice(0, 50)) {
    const note = details.createEl("div"); note.style.margin = "8px 0 12px";
    note.createEl("strong", { text: entry.path });
    if (entry.reasons.length) note.createEl("div", { text: entry.reasons.join(" | "), cls: "setting-item-description" });
    const accepted = entry.decisions.filter((decision) => decision.decision === "accepted" && decision.finalSuggestion);
    if (accepted.length) {
      const list = note.createEl("ul");
      for (const decision of accepted) list.createEl("li", { text: `${decision.finalSuggestion!.field}: ${JSON.stringify(decision.finalSuggestion!.value)}${decision.edited ? " (reviewer edited)" : ""}` });
    }
  }
}

export class OkfEnrichmentApplyPreviewModal extends Modal {
  private applying = false;
  constructor(app: App, private plan: OkfEnrichmentApplyPlan, private onApplied?: (result: OkfEnrichmentApplyResult) => void) { super(app); }
  onOpen(): void {
    const { contentEl, plan } = this; contentEl.empty();
    contentEl.createEl("h2", { text: "Apply reviewed OKF+ enrichment — governed preview" });
    contentEl.createEl("p", { text: `${plan.totals.reviewed} suggestions reviewed: ${plan.totals.accepted} accepted, ${plan.totals.rejected} rejected, ${plan.totals.edited} edited. ${plan.totals.ready} notes are ready; ${plan.totals.blocked} are blocked; ${plan.totals.noChange} require no write.` });
    contentEl.createEl("p", { text: `Plan SHA-256: ${plan.planHash}`, cls: "setting-item-description" });
    contentEl.createEl("p", { text: "The plan contains hashes and decisions, not note bodies. Each ready note is rechecked, byte-backed up, and written only if it still exactly matches the reviewed source. Markdown body bytes remain unchanged." });
    renderEntries(contentEl, "Ready changes", plan.entries.filter((entry) => entry.status === "ready"));
    renderEntries(contentEl, "Blocked", plan.entries.filter((entry) => entry.status === "blocked"));
    renderEntries(contentEl, "No change", plan.entries.filter((entry) => entry.status === "no-change"));
    if (!plan.totals.ready) {
      new Setting(contentEl).addButton((button) => button.setButtonText("Save decision audit").onClick(async () => { const path = await saveOkfEnrichmentApplyPlan(this.app, plan); new Notice(`Decision audit saved to ${path}`); })).addButton((button) => button.setButtonText("Close").setCta().onClick(() => this.close()));
      return;
    }
    let backup = false, reviewed = false, relationship = false; let applyButton: HTMLButtonElement | null = null;
    const refresh = () => { if (applyButton) applyButton.disabled = !(backup && reviewed && relationship) || this.applying; };
    acknowledgement(contentEl, "I have made a separate, restorable vault backup; cloud sync alone is not a backup.", (value) => { backup = value; refresh(); });
    acknowledgement(contentEl, "I explicitly reviewed every accepted value, including any reviewer edits; confidence did not approve anything automatically.", (value) => { reviewed = value; refresh(); });
    acknowledgement(contentEl, "I verified supersession direction and relationship meaning. Resolved targets do not by themselves prove the relationship is true.", (value) => { relationship = value; refresh(); });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Save plan only").onClick(async () => { const path = await saveOkfEnrichmentApplyPlan(this.app, plan); new Notice(`Enrichment plan saved to ${path}`); }))
      .addButton((button) => {
        button.setButtonText(`Back up and apply ${plan.totals.ready} notes`).setWarning(); applyButton = button.buttonEl; refresh();
        button.onClick(async () => {
          if (this.applying || !backup || !reviewed || !relationship) return;
          this.applying = true; refresh(); applyButton!.textContent = "Applying safely…";
          const notice = new Notice("Vault Kosmos: backing up and applying reviewed enrichment…", 0);
          try {
            const result = await applyOkfEnrichmentPlan(this.app, plan); notice.hide(); this.onApplied?.(result);
            new Notice(`Vault Kosmos: ${result.applied.length} notes updated; ${result.skippedChanged.length + result.skippedMissing.length} changed/missing skipped; ${result.failed.length} failed. Audit: ${result.resultPath}`, 12000); this.close();
          } catch (error: any) { notice.hide(); this.applying = false; applyButton!.textContent = `Back up and apply ${plan.totals.ready} notes`; refresh(); new Notice(`Enrichment apply stopped: ${String(error?.message || error)}. No unbacked note is intentionally written.`, 15000); }
        });
      });
  }
}
