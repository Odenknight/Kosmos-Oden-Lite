/**
 * Reproducible synthetic-vault benchmarks (§26).
 *
 * Generates deterministic vaults of 100 / 1,000 / 5,000 / 10,000 notes
 * (optionally 25,000 / 50,000 with --large), then measures:
 *   parse, graph build, cosmology classification, layout, single-note
 *   incremental update, new-folder incremental update, and RSS where
 *   available. Results print as a Markdown table — paste into
 *   benchmarks/RESULTS.md with the hardware line filled in.
 *
 *   node benchmarks/bench.mjs [--large]
 */
import { buildGraph, KosmosIndex } from "../dist/kosmos-core.mjs";
import { buildCosmos, layoutCosmos } from "../dist/kosmos-layout.mjs";

const LARGE = process.argv.includes("--large");
const SIZES = LARGE ? [100, 1000, 5000, 10000, 25000, 50000] : [100, 1000, 5000, 10000];

/** Deterministic PRNG (mulberry32) so every run builds the same vaults. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeVault(n) {
  const rand = rng(n * 2654435761);
  const areas = Math.max(4, Math.round(Math.sqrt(n) / 2));
  const files = [];
  const folders = [];
  for (let a = 0; a < areas; a++) folders.push(`Area${String(a).padStart(2, "0")}`);
  for (let i = 0; i < n; i++) {
    const area = folders[i % areas];
    const links = [];
    const linkCount = Math.floor(rand() * 5);
    for (let l = 0; l < linkCount; l++) {
      const t = Math.floor(rand() * n);
      links.push(`[[Area${String(t % areas).padStart(2, "0")}/Note ${t}]]`);
    }
    const okf = i % 7 === 0
      ? `type: idea\ntimestamp: 2026-01-${String((i % 27) + 1).padStart(2, "0")}T00:00:00Z\n` +
        (i % 21 === 0 && i > 0 ? `supersedes:\n  - Note ${i - 7}\n` : "")
      : `tags: [t${i % 11}]\n`;
    files.push({
      relativePath: `${area}/Note ${i}.md`,
      content: `---\n${okf}---\n# Note ${i}\n\nBody of note ${i}. ${links.join(" ")}\n`,
      modifiedTime: 1735689600000 + i * 60000,
      createdTime: 1735689600000 + i * 60000,
      kind: "note",
    });
  }
  return { files, folders };
}

const ms = (t) => `${t.toFixed(1)} ms`;
const rows = [];

for (const n of SIZES) {
  const { files, folders } = makeVault(n);

  // full build (parse + assemble)
  let t0 = performance.now();
  const graph = buildGraph(files, folders);
  const buildMs = performance.now() - t0;

  // cosmology classification
  t0 = performance.now();
  const cosmos = buildCosmos(graph, { attachments: [] });
  const cosmosMs = performance.now() - t0;

  // layout + separation + collision diagnostics
  t0 = performance.now();
  layoutCosmos(cosmos);
  const layoutMs = performance.now() - t0;

  // incremental single-note update
  const idx = new KosmosIndex();
  idx.setFiles(files, folders);
  const target = files[Math.floor(n / 2)];
  t0 = performance.now();
  const upd = idx.applyChanges({ changed: [{ ...target, content: target.content + "\nEdited. [[Note 1]]" }] });
  const singleMs = performance.now() - t0;

  // incremental new-folder update (folder + one note)
  t0 = performance.now();
  idx.applyChanges({
    changed: [{ relativePath: "NewArea/first.md", content: "# First\n[[Note 2]]", kind: "note" }],
    folders: [...folders, "NewArea"],
  });
  const folderMs = performance.now() - t0;

  const rss = typeof process !== "undefined" && process.memoryUsage ? `${Math.round(process.memoryUsage().rss / 1048576)} MB` : "n/a";
  rows.push({ n, buildMs, cosmosMs, layoutMs, singleMs, folderMs, reparsed: upd.delta.reparsed, rss, collisions: cosmos.__residualCollisions ?? 0 });
  console.error(`bench ${n}: done`);
}

console.log(`| Notes | Full build (parse+graph) | Cosmology | Layout | Single-note update | New-folder update | Reparsed | Residual collisions | RSS |`);
console.log(`| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
for (const r of rows) {
  console.log(`| ${r.n.toLocaleString("en-US")} | ${ms(r.buildMs)} | ${ms(r.cosmosMs)} | ${ms(r.layoutMs)} | ${ms(r.singleMs)} | ${ms(r.folderMs)} | ${r.reparsed} | ${r.collisions} | ${r.rss} |`);
}
