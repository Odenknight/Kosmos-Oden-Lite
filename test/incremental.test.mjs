/** Incremental index tests (§10, §24): change granularity + reparse accounting. */
import test from "node:test";
import assert from "node:assert/strict";
import { KosmosIndex } from "../dist/kosmos-core.mjs";

const N = (path, content) => ({ relativePath: path, content, kind: "note" });

function seeded() {
  const idx = new KosmosIndex();
  const update = idx.setFiles(
    [
      N("Home.md", "# Home\n[[Notes/A]]"),
      N("Notes/A.md", "---\ntags: [x]\n---\nA links [[B]]"),
      N("Notes/B.md", "---\ntype: idea\ntimestamp: 2026-01-01\n---\nB body"),
      N("Notes/C.md", "---\ntype: idea\ntimestamp: 2026-02-01\n---\nC body"),
    ],
    ["Notes"],
    ["Notes/pic.png"]
  );
  return { idx, update };
}

test("full load parses everything once", () => {
  const { idx } = seeded();
  assert.equal(idx.parseCount, 4);
  assert.equal(idx.noteCount, 4);
  assert.equal(idx.graph.diagnostics.attachments, 1);
});

test("edit one note -> exactly one reparse, unaffected notes untouched", () => {
  const { idx } = seeded();
  const before = idx.parseCount;
  const { delta } = idx.applyChanges({ changed: [N("Notes/A.md", "---\ntags: [x,y]\n---\nA links [[B]] and [[C]]")] });
  assert.equal(delta.reparsed, 1);
  assert.equal(idx.parseCount, before + 1);
  assert.equal(delta.topologyChanged, true); // new link A->C
});

test("touch without content change -> zero reparses (hash gate)", () => {
  const { idx } = seeded();
  const before = idx.parseCount;
  const { delta } = idx.applyChanges({ changed: [N("Notes/B.md", "---\ntype: idea\ntimestamp: 2026-01-01\n---\nB body")] });
  assert.equal(delta.reparsed, 0);
  assert.equal(idx.parseCount, before);
  assert.equal(delta.topologyChanged, false);
  assert.deepEqual(delta.changedNodes, []);
});

test("add one note -> one reparse + added node in delta", () => {
  const { idx } = seeded();
  const { delta } = idx.applyChanges({ changed: [N("Notes/D.md", "D links [[Home]]")] });
  assert.equal(delta.reparsed, 1);
  assert.ok(delta.addedNodes.includes("file:Notes/D.md"));
});

test("delete one note -> removed node, zero reparses", () => {
  const { idx } = seeded();
  const before = idx.parseCount;
  const { delta } = idx.applyChanges({ removed: ["Notes/C.md"] });
  assert.equal(idx.parseCount, before);
  assert.ok(delta.removedNodes.includes("file:Notes/C.md"));
  assert.equal(idx.noteCount, 3);
});

test("rename moves the cached record without reparsing", () => {
  const { idx } = seeded();
  const before = idx.parseCount;
  const { graph, delta } = idx.applyChanges({ renames: [{ from: "Notes/C.md", to: "Notes/C2.md" }] });
  assert.equal(idx.parseCount, before);
  assert.ok(delta.addedNodes.includes("file:Notes/C2.md"));
  assert.ok(delta.removedNodes.includes("file:Notes/C.md"));
  assert.ok(graph.nodes.some((n) => n.id === "file:Notes/C2.md"));
});

test("add folder -> folder node appears (new galaxy candidate), no note reparses", () => {
  const { idx } = seeded();
  const before = idx.parseCount;
  const { graph, delta } = idx.applyChanges({ folders: ["Notes", "Lab"] });
  assert.equal(idx.parseCount, before);
  assert.ok(delta.addedNodes.includes("folder:Lab"));
  assert.ok(graph.nodes.some((n) => n.id === "folder:Lab"));
});

test("remove folder -> folder node disappears", () => {
  const { idx } = seeded();
  idx.applyChanges({ folders: ["Notes", "Lab"] });
  const { delta } = idx.applyChanges({ folders: ["Notes"] });
  assert.ok(delta.removedNodes.includes("folder:Lab"));
});

test("add/delete attachment updates diagnostics without reparsing", () => {
  const { idx } = seeded();
  const before = idx.parseCount;
  let r = idx.applyChanges({ attachments: ["Notes/pic.png", "Notes/new.pdf"] });
  assert.equal(r.graph.diagnostics.attachments, 2);
  r = idx.applyChanges({ attachments: [] });
  assert.equal(r.graph.diagnostics.attachments, 0);
  assert.equal(idx.parseCount, before);
});

test("lineage change in ONE note re-derives temporal state for its partner", () => {
  const { idx } = seeded();
  const { graph, delta } = idx.applyChanges({
    changed: [N("Notes/C.md", "---\ntype: idea\ntimestamp: 2026-02-01\nsupersedes:\n  - B\n---\nC body")],
  });
  assert.equal(delta.reparsed, 1);
  const b = graph.nodes.find((n) => n.id === "file:Notes/B.md");
  const c = graph.nodes.find((n) => n.id === "file:Notes/C.md");
  assert.equal(b.okf.invalidAt, c.validAt); // partner invalidated without being reparsed
  assert.equal(c.okf.head, true);
  assert.ok(delta.changedNodes.includes("file:Notes/B.md")); // meta delta captured
});

test("Related footer change retags the link kind", () => {
  const { idx } = seeded();
  const { graph, delta } = idx.applyChanges({
    changed: [N("Notes/A.md", "---\ntags: [x]\ntype: note\n---\nA links [[B]]\n\n**Related:** [[B]]")],
  });
  assert.equal(delta.reparsed, 1);
  const semantic = graph.links.find((l) => l.kind === "semantic" && l.source === "file:Notes/A.md");
  assert.ok(semantic);
  assert.equal(semantic.target, "file:Notes/B.md");
});

test("human edits to flat OKF+ labels and wikilinks update every graph projection incrementally", () => {
  const idx = new KosmosIndex();
  const note = (tags, related) => `---\nokf_version: "2.2"\nuid: "11111111-1111-4111-8111-111111111111"\ntype: "semantic"\ntitle: "Editable"\ndescription: "Human-editable metadata."\ntimestamp: "2026-07-01T00:00:00Z"\nepistemic_state: "hypothesis"\nscope: "node"\nscope_id: "11111111-1111-4111-8111-111111111111"\nsensitivity: "internal"\ntags: [${tags}]\nsupersedes: []\nsuperseded_by: []\nforked_from: []\nforked_to: []\nrelated_to: ["[[${related}]]"]\n---\nBody`;
  let { graph } = idx.setFiles([
    N("Editable.md", note("old-label", "B")),
    N("B.md", "# B"),
    N("C.md", "# C"),
  ]);
  assert.deepEqual(graph.nodes.find((node) => node.id === "file:Editable.md").tags, ["old-label"]);
  assert.ok(graph.links.some((link) => link.source === "file:Editable.md" && link.target === "file:B.md" && link.kind === "semantic"));

  const update = idx.applyChanges({ changed: [N("Editable.md", note("corrected, selected-label", "C"))] });
  graph = update.graph;
  assert.equal(update.delta.reparsed, 1);
  assert.equal(update.delta.topologyChanged, true);
  assert.ok(update.delta.changedNodes.includes("file:Editable.md"));
  assert.deepEqual(graph.nodes.find((node) => node.id === "file:Editable.md").tags, ["corrected", "selected-label"]);
  assert.ok(graph.links.some((link) => link.source === "file:Editable.md" && link.target === "file:C.md" && link.kind === "semantic"));
  assert.ok(!graph.links.some((link) => link.source === "file:Editable.md" && link.target === "file:B.md" && link.kind === "semantic"));
});

test("structural threshold reports full rebuild for bulk changes (§10.2)", () => {
  const idx = new KosmosIndex();
  const many = [];
  for (let i = 0; i < 40; i++) many.push(N(`n${i}.md`, `note ${i}`));
  idx.setFiles(many, []);
  const removed = many.slice(0, 20).map((f) => f.relativePath); // 50% > 25% threshold floor…
  const { delta } = idx.applyChanges({ removed });
  // touched(20) <= max(500, 40*0.25=10) -> 20 < 500, so NOT structural: threshold floor dominates
  assert.equal(delta.fullRebuild, false);
  // now force past the absolute floor
  const idx2 = new KosmosIndex();
  const lots = [];
  for (let i = 0; i < 900; i++) lots.push(N(`m${i}.md`, `note ${i}`));
  idx2.setFiles(lots, []);
  const { delta: d2 } = idx2.applyChanges({ removed: lots.slice(0, 600).map((f) => f.relativePath) });
  assert.equal(d2.fullRebuild, true);
});
