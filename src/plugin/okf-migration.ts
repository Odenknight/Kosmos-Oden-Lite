/** Obsidian host for the safety-first OKF+ audit/backup/apply workflow. */
import { App, Modal, Notice, Setting, TFile, normalizePath } from "obsidian";
import { matchedOkfExclusion } from "../core/okf-exclusions";
import {
  createOkfMigrationPlan,
  publicOkfMigrationPlan,
  verifyOkfMigrationPlan,
  type OkfMigrationEntry,
  type OkfMigrationMode,
  type OkfMigrationPlan,
  type OkfMigrationSource,
} from "../core/okf-migration";
import type { AgentSettings } from "./agent-server";
import { openOkfBlockedReview } from "./okf-blocked-review";

export interface OkfMigrationApplyResult {
  runId: string;
  planHash: string;
  applied: string[];
  skippedChanged: string[];
  skippedMissing: string[];
  failed: Array<{ path: string; error: string }>;
  backupRoot: string;
  planPath: string;
  resultPath: string;
  completedAt: string;
  mode: OkfMigrationMode;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  let current = "";
  for (const part of normalizePath(path).split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) {
      try { await app.vault.createFolder(current); }
      catch (_) { if (!(await app.vault.adapter.exists(current))) throw _; }
    }
  }
}

export interface OkfMigrationScanResult { plan: OkfMigrationPlan; excluded: Array<{ path: string; pattern: string }> }

export async function scanVaultForOkf(app: App, mode: OkfMigrationMode = "safe-onboarding", settings?: AgentSettings): Promise<OkfMigrationScanResult> {
  const files = app.vault.getMarkdownFiles()
    .filter((f) => !f.path.toLowerCase().startsWith(".okf/"));
  const sources: OkfMigrationSource[] = [];
  const excluded: Array<{ path: string; pattern: string }> = [];
  for (const file of files) {
    const pattern = matchedOkfExclusion(file.path, settings?.okfExcludePatterns ?? [], settings?.okfDeveloperExclusions === true);
    if (pattern) { excluded.push({ path: file.path, pattern }); continue; }
    sources.push({
      path: file.path,
      content: await app.vault.read(file),
      createdTime: file.stat.ctime,
      modifiedTime: file.stat.mtime,
    });
  }
  return { plan: await createOkfMigrationPlan(sources, { mode }), excluded };
}

function persistedResult(result: OkfMigrationApplyResult): string {
  return JSON.stringify(result, null, 2) + "\n";
}

/** Save the content-free, hash-bound dry-run for review without editing notes. */
export async function saveOkfMigrationPlan(app: App, plan: OkfMigrationPlan): Promise<string> {
  const migrationRoot = normalizePath(`.okf/migrations/${plan.runId}`);
  const planPath = `${migrationRoot}/plan.json`;
  await ensureFolder(app, migrationRoot);
  const serialized = JSON.stringify(publicOkfMigrationPlan(plan), null, 2) + "\n";
  if (await app.vault.adapter.exists(planPath)) {
    const existing = await app.vault.adapter.read(planPath);
    if (existing !== serialized) throw new Error(`a different audit already exists at ${planPath}`);
  } else {
    await app.vault.adapter.write(planPath, serialized);
  }
  return planPath;
}

/**
 * Apply only the exact dry-run plan shown to the user. Every source is checked
 * again, then copied with readBinary/writeBinary before the atomic Vault.process
 * call. A concurrently edited note is skipped, never overwritten.
 */
export async function applyOkfMigrationPlan(app: App, plan: OkfMigrationPlan): Promise<OkfMigrationApplyResult> {
  if (!(await verifyOkfMigrationPlan(plan))) throw new Error("approved OKF+ plan or in-memory note contents changed after preview; run a new scan");
  const migrationRoot = normalizePath(`.okf/migrations/${plan.runId}`);
  const backupRoot = normalizePath(`.okf/backup/${plan.runId}`);
  const planPath = `${migrationRoot}/plan.json`;
  const resultPath = `${migrationRoot}/result.json`;
  await ensureFolder(app, backupRoot);
  await saveOkfMigrationPlan(app, plan);

  const result: OkfMigrationApplyResult = {
    runId: plan.runId,
    planHash: plan.planHash,
    applied: [],
    skippedChanged: [],
    skippedMissing: [],
    failed: [],
    backupRoot,
    planPath,
    resultPath,
    completedAt: "",
    mode: plan.mode,
  };

  for (const entry of plan.entries.filter((e) => e.status === "needs-okf-plus")) {
    try {
      const abstract = app.vault.getAbstractFileByPath(entry.path);
      if (!(abstract instanceof TFile)) { result.skippedMissing.push(entry.path); continue; }
      const live = await app.vault.read(abstract);
      if (live !== entry.originalContent) { result.skippedChanged.push(entry.path); continue; }
      const backupPath = normalizePath(`${backupRoot}/${entry.path}.bak`);
      const slash = backupPath.lastIndexOf("/");
      if (slash > 0) await ensureFolder(app, backupPath.slice(0, slash));
      if (await app.vault.adapter.exists(backupPath)) throw new Error(`backup already exists: ${backupPath}`);
      const originalBytes = await app.vault.adapter.readBinary(entry.path);
      await app.vault.adapter.writeBinary(backupPath, originalBytes);

      let matchedPlan = false;
      const written = await app.vault.process(abstract, (current) => {
        if (current !== entry.originalContent) return current;
        matchedPlan = true;
        return entry.proposedContent!;
      });
      if (!matchedPlan || written !== entry.proposedContent) result.skippedChanged.push(entry.path);
      else result.applied.push(entry.path);
    } catch (error: any) {
      result.failed.push({ path: entry.path, error: String(error?.message || error) });
    }
  }
  result.completedAt = new Date().toISOString();
  await app.vault.adapter.write(resultPath, persistedResult(result));
  return result;
}

function warningBox(parent: HTMLElement, heading: string, text: string): void {
  const box = parent.createDiv();
  box.style.border = "1px solid var(--text-warning, #d69e2e)";
  box.style.borderRadius = "8px";
  box.style.padding = "10px 12px";
  box.style.margin = "10px 0";
  box.createEl("strong", { text: heading });
  box.createEl("div", { text, cls: "setting-item-description" });
}

function confirmation(parent: HTMLElement, text: string, onChange: (checked: boolean) => void): HTMLInputElement {
  const label = parent.createEl("label");
  label.style.display = "flex";
  label.style.gap = "8px";
  label.style.alignItems = "flex-start";
  label.style.margin = "10px 0";
  const checkbox = label.createEl("input", { type: "checkbox" });
  label.createSpan({ text });
  checkbox.addEventListener("change", () => onChange(checkbox.checked));
  return checkbox;
}

export class OkfMigrationPreviewModal extends Modal {
  private plan: OkfMigrationPlan;
  private onApply: (plan: OkfMigrationPlan) => Promise<void>;
  private applying = false;

  constructor(app: App, plan: OkfMigrationPlan, onApply: (plan: OkfMigrationPlan) => Promise<void>, private settings?: AgentSettings, private excluded: Array<{ path: string; pattern: string }> = []) {
    super(app); this.plan = plan; this.onApply = onApply;
  }

  onOpen(): void {
    const { contentEl, plan } = this;
    contentEl.empty();
    const upgradeAll = plan.mode === "upgrade-all";
    const convertTo23 = plan.mode === "convert-to-23";
    contentEl.createEl("h2", { text: convertTo23 ? "Convert recoverable notes to flat editable OKF+ 2.3 — preview" : upgradeAll ? "Convert recoverable notes to editable OKF+ 2.2 — preview" : "Repair human-editable OKF+ metadata — preview" });
    contentEl.createEl("p", { text: `Scanned ${plan.totals.notes} notes. This dry run proposes ${plan.totals.changes} note changes; nothing has been changed yet.` });

    const summary = contentEl.createEl("ul");
    summary.createEl("li", { text: `${plan.totals["okf-plus-2.2"]} already use human-editable OKF+ 2.2 Properties` });
    summary.createEl("li", { text: `${plan.totals["okf-plus-2.3"]} already conform to native OKF+ 2.3` });
    summary.createEl("li", { text: `${plan.totals["google-okf-0.1"]} conform to Google's OKF 0.1 draft${upgradeAll ? "" : " and will be left unchanged"}` });
    summary.createEl("li", { text: `${plan.totals["google-reserved"]} reserved index.md/log.md files${upgradeAll ? " are included when mechanically recoverable" : " will be left unchanged"}` });
    summary.createEl("li", { text: `${plan.totals["needs-okf-plus"]} can be safely repaired or converted to ${convertTo23 ? "flat editable OKF+ 2.3" : "editable OKF+ 2.2"}` });
    summary.createEl("li", { text: `${plan.totals.blocked} need manual review and will not be changed` });
    summary.createEl("li", { text: `${this.excluded.length} excluded by OKF processing rules` });
    if (this.excluded.length) {
      const details = contentEl.createEl("details"); details.createEl("summary", { text: `Excluded from this OKF scan (${this.excluded.length})` });
      const list = details.createEl("ul");
      for (const item of this.excluded.slice(0, 100)) list.createEl("li", { text: `${item.path} — ${item.pattern}` });
      if (this.excluded.length > 100) list.createEl("li", { text: `…and ${this.excluded.length - 100} more.` });
    }

    warningBox(contentEl, "Back up the vault before continuing.", "Bulk metadata changes propagate through Obsidian Sync, Nextcloud, Dropbox, OneDrive, and Git. Sync is not a backup: it can synchronize an unwanted change. Make a separate, restorable snapshot first. Vault Kosmos also creates a byte-exact local backup of every changed file under .okf/backup/<run-id>, but that is a recovery aid—not a substitute for an independent backup.");
    warningBox(contentEl, "Repair and conversion are deterministic; model enrichment is a separate re-scan.", convertTo23 ? "This screen does not call any model or send note content anywhere. Editable 2.3 output keeps every property flat — scalars plus quoted-wikilink lists — so Obsidian Properties, humans, and agents can edit tags and relationships without touching nested YAML. No nested governance blocks are written into notes." : "This screen does not call any model or send note content anywhere. It restores flat Obsidian Properties for tags and relationship wikilinks. Only notes carrying the beta.10 deterministic-migration marker are flattened automatically; genuinely authored native 2.3 notes remain unchanged.");
    warningBox(contentEl, "Review sensitivity after migration.", "The default label is internal; it is not a content-based privacy classification. Review notes that may contain confidential data or protected health information before enabling cloud agents or raising connector access. Existing invalid governance values, duplicate UIDs, duplicate keys, and nested/ambiguous YAML are blocked instead of overwritten.");
    if (upgradeAll || convertTo23) warningBox(contentEl, "Convert-all is a governed override, not a force switch.", convertTo23 ? "Recoverable legacy values are mapped to conservative, flat editable OKF+ 2.3 Properties and their overridden originals are retained in the hash-bound migration plan. Unsafe relationship targets, ambiguous YAML, and duplicate UIDs remain blocked. Confidence measures mechanical migration safety only." : "Recoverable legacy values are mapped to conservative, flat OKF+ 2.2 Properties and their overridden originals are retained in the hash-bound migration plan. Unsafe relationship targets, ambiguous YAML, and duplicate UIDs remain blocked. Confidence measures mechanical migration safety only.");

    contentEl.createEl("p", { text: `Plan SHA-256: ${plan.planHash}`, cls: "setting-item-description" });
    contentEl.createEl("p", { text: "When applied, the human-authored Markdown body remains byte-for-byte unchanged. Only frontmatter is added or normalized, and a note edited after this scan is skipped.", cls: "setting-item-description" });

    const changed = plan.entries.filter((e) => e.status === "needs-okf-plus");
    if (changed.length) this.renderEntries(contentEl, "Proposed changes", changed);
    const blocked = plan.entries.filter((e) => e.status === "blocked");
    if (blocked.length) this.renderEntries(contentEl, "Blocked for review", blocked);
    if (blocked.length) {
      const advisoryProvider = this.settings?.okfEnrichmentProvider;
      const advisoryConfigured = advisoryProvider === "local" || advisoryProvider === "lan";
      new Setting(contentEl)
        .setName("On-device/LAN advisory review of blocked notes")
        .setDesc(advisoryConfigured
          ? `Sends bounded frontmatter with likely credential-key values redacted, plus deterministic blocker codes, to your configured ${advisoryProvider === "lan" ? "private-IP LAN" : "loopback"} model. LAN requires a fresh disclosure confirmation. The model returns explanations, manual steps, and questions only—never YAML, an executable patch, or a note write.`
          : "Choose On-device LLM or LAN LLM under Content-assisted enrichment first. Cloud review is prohibited because blocked notes may have missing or invalid sensitivity labels.")
        .addButton((button) => button
          .setButtonText(advisoryConfigured ? `Review ${Math.min(blocked.length, this.settings!.okfEnrichmentMaxNotes)} blocked notes` : "On-device or LAN LLM required")
          .setDisabled(!advisoryConfigured)
          .onClick(async () => { if (this.settings) await openOkfBlockedReview(this.app, plan, this.settings); }));
    }

    if (!plan.totals.changes) {
      new Setting(contentEl)
        .addButton((b) => b.setButtonText("Save audit report").onClick(async () => {
          try { const path = await saveOkfMigrationPlan(this.app, plan); new Notice(`Vault Kosmos: audit saved to ${path}`); }
          catch (error: any) { new Notice(`Could not save audit: ${String(error?.message || error)}`, 10000); }
        }))
        .addButton((b) => b.setButtonText("Close").setCta().onClick(() => this.close()));
      return;
    }

    let backupConfirmed = false, policyConfirmed = false, overrideConfirmed = !(upgradeAll || convertTo23);
    let applyButton: HTMLButtonElement | null = null;
    const refresh = () => { if (applyButton) applyButton.disabled = !(backupConfirmed && policyConfirmed && overrideConfirmed) || this.applying; };
    confirmation(contentEl, "I have made a separate, restorable backup or snapshot of this vault; I understand that cloud sync alone is not a backup.", (v) => { backupConfirmed = v; refresh(); });
    confirmation(contentEl, "I understand the conservative defaults are not an AI privacy review, and I will review confidential/PHI sensitivity before cloud use.", (v) => { policyConfirmed = v; refresh(); });
    if (upgradeAll || convertTo23) confirmation(contentEl, convertTo23 ? "I approve converting recoverable notes to flat editable OKF+ 2.3; original overridden values will remain in the migration plan and byte-exact backup." : "I approve converting recoverable legacy fields to conservative, human-editable OKF+ 2.2 Properties; original overridden values will remain in the migration plan and byte-exact backup.", (v) => { overrideConfirmed = v; refresh(); });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Save audit only").onClick(async () => {
        try { const path = await saveOkfMigrationPlan(this.app, plan); new Notice(`Vault Kosmos: audit saved to ${path}`); }
        catch (error: any) { new Notice(`Could not save audit: ${String(error?.message || error)}`, 10000); }
      }))
      .addButton((b) => {
        b.setButtonText(`Back up and apply ${plan.totals.changes} changes`).setWarning();
        applyButton = b.buttonEl; refresh();
        b.onClick(async () => {
          if (this.applying || !backupConfirmed || !policyConfirmed || !overrideConfirmed) return;
          this.applying = true; refresh(); applyButton!.textContent = "Applying safely…";
          try {
            await this.onApply(plan);
            this.close();
          } catch (_) {
            this.applying = false;
            applyButton!.textContent = `Back up and apply ${plan.totals.changes} changes`;
            refresh();
          }
        });
      });
  }

  private renderEntries(parent: HTMLElement, title: string, entries: OkfMigrationEntry[]): void {
    const details = parent.createEl("details");
    details.createEl("summary", { text: `${title} (${entries.length})` });
    const list = details.createEl("ul");
    for (const entry of [...entries].sort((a, b) => a.review.confidence - b.review.confidence || a.path.localeCompare(b.path)).slice(0, 50)) {
      const confidence = `${Math.round(entry.review.confidence * 100)}% migration confidence`;
      const reasons = entry.review.reasons.map((finding) => `${finding.code}: ${finding.message}`).join(" | ");
      list.createEl("li", { text: `${entry.path} — ${confidence}${reasons ? ` — ${reasons}` : ""}` });
    }
    if (entries.length > 50) list.createEl("li", { text: `…and ${entries.length - 50} more. The complete list is saved with the plan when you apply.` });
  }
}

export async function openOkfMigrationWorkflow(
  app: App,
  mode: OkfMigrationMode = "safe-onboarding",
  onApplied?: (result: OkfMigrationApplyResult) => void,
  settings?: AgentSettings,
): Promise<void> {
  const scanning = new Notice("Vault Kosmos: scanning notes for OKF/OKF+ frontmatter…", 0);
  try {
    const scan = await scanVaultForOkf(app, mode, settings);
    const plan = scan.plan;
    scanning.hide();
    new OkfMigrationPreviewModal(app, plan, async (approved) => {
      const running = new Notice(`Vault Kosmos: backing up and applying ${approved.totals.changes} OKF+ changes…`, 0);
      try {
        const result = await applyOkfMigrationPlan(app, approved);
        running.hide();
        onApplied?.(result);
        const skipped = result.skippedChanged.length + result.skippedMissing.length;
        new Notice(`Vault Kosmos: ${result.applied.length} notes updated; ${skipped} changed/missing notes skipped; ${result.failed.length} failed. Audit: ${result.resultPath}`, 12000);
      } catch (error: any) {
        running.hide();
        new Notice(`Vault Kosmos OKF+ migration stopped: ${String(error?.message || error)}. No unbacked note is intentionally written.`, 15000);
        throw error;
      }
    }, settings, scan.excluded).open();
  } catch (error: any) {
    scanning.hide();
    new Notice(`Vault Kosmos could not scan OKF+ frontmatter: ${String(error?.message || error)}`, 15000);
  }
}
