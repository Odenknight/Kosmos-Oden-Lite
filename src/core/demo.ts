/** Kosmos Core — built-in demo vault (used by the standalone "Load Demo" and plugin boot). */
import type { KosmosGraph, KosmosLink, KosmosNode } from "./types";

const demoAreas = [
  { path: "00_Atlas", label: "Atlas", color: "#7dd3fc", tags: ["map", "structure"], notes: ["Knowledge Constellation", "Navigation Principles", "Concept Cartography", "Open Questions", "Semantic Landmarks", "Routes and Tours", "Depth Cues", "Graph Vocabulary"] },
  { path: "10_Research", label: "Research", color: "#a78bfa", tags: ["research", "signal"], notes: ["Literature Radar", "AI Interface Notes", "Spatial Computing", "Local First Systems", "Cognitive Load", "Human Attention", "Pattern Library", "Insight Pipeline"] },
  { path: "20_Projects", label: "Projects", color: "#34d399", tags: ["project", "active"], notes: ["Vault Kosmos", "Learning Studio", "Publishing Engine", "Workshop Planner", "Knowledge Garden", "Presentation Route Alpha", "Review Dashboard", "Automation Console"] },
  { path: "30_Sources", label: "Sources", color: "#fbbf24", tags: ["source", "reference"], notes: ["Obsidian Graph", "Three Dimensional UI", "Local Data Ethics", "Graph Layout Notes", "WebGL Performance", "File Watchers", "Navigation Research", "Interface Atmosphere"] },
  { path: "40_Writing", label: "Writing", color: "#fb7185", tags: ["writing", "draft"], notes: ["Public Alpha Story", "Demo Walkthrough", "Design Notes", "Launch Checklist", "Field Report", "Narrative Arc", "Readme Draft", "Release Notes"] },
  { path: "50_People", label: "People", color: "#f472b6", tags: ["people", "context"], notes: ["Research Partners", "Workshop Audience", "Maintainers", "Learners", "Editors", "Decision Makers", "Power Users", "Future Contributors"] },
  { path: "60_Archive", label: "Archive", color: "#94a3b8", tags: ["archive", "history"], notes: ["Prototype Log", "Old Layouts", "Rejected Ideas", "Screenshot Notes", "Performance Traces", "Branch History", "Session Summaries", "Release Archive"] },
];
const unresolvedTargets = ["Future Knowledge Engine", "Immersive Presentation Mode", "Semantic Embeddings"];

function addLink(links: KosmosLink[], kind: KosmosLink["kind"], source: string, target: string, label?: string): void {
  if (!source || !target || source === target) return;
  links.push({ id: `${kind}:${source}->${target}:${links.length}`, source, target, kind, label });
}

function applyDemoCounts(nodes: KosmosNode[], links: KosmosLink[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const l of links) {
    if (l.kind === "contains") continue;
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    if (s) s.outgoing++;
    if (t) t.incoming++;
  }
}

export function createDemoVaultGraph(now = Date.now()): KosmosGraph {
  const nodes: KosmosNode[] = [];
  const links: KosmosLink[] = [];
  nodes.push({ id: "folder:.", kind: "folder", path: "", label: "Demo Vault", area: "Vault", depth: 0, tags: [], aliases: [], color: "#e2e8f0", outgoing: 0, incoming: 0 });
  for (const a of demoAreas) {
    nodes.push({ id: `folder:${a.path}`, kind: "folder", path: a.path, label: a.label, area: a.path, depth: 1, tags: a.tags, aliases: [], color: a.color, outgoing: 0, incoming: 0 });
    links.push({ id: `contains:folder:.->folder:${a.path}`, source: "folder:.", target: `folder:${a.path}`, kind: "contains" });
  }
  let fi = 0;
  const byArea = new Map<string, string[]>();
  const all: string[] = [];
  for (const a of demoAreas) {
    const ids: string[] = [];
    for (const note of a.notes) {
      const path = `${a.path}/${note}.md`;
      const id = `file:${path}`;
      const createdAt = new Date(now - (demoAreas.length * 8 - fi) * 36 * 36e5).toISOString();
      const updatedAt = new Date(now - ((fi % 13) + 1) * 18 * 6e4).toISOString();
      nodes.push({
        id, kind: "file", path, label: note, area: a.path, depth: 2, extension: "md",
        size: 1600 + fi * 137, createdAt, updatedAt, validAt: createdAt,
        type: fi % 5 === 0 ? "hub" : fi % 3 === 0 ? "note" : "brief",
        status: fi % 7 === 0 ? "active" : fi % 4 === 0 ? "draft" : "stable",
        priority: fi % 6 === 0 ? "high" : "normal",
        tags: [...a.tags, fi % 2 === 0 ? "demo" : "linked"], aliases: [],
        color: a.color, outgoing: 0, incoming: 0,
      });
      links.push({ id: `contains:folder:${a.path}->${id}`, source: `folder:${a.path}`, target: id, kind: "contains" });
      ids.push(id);
      all.push(id);
      fi++;
    }
    byArea.set(a.path, ids);
  }
  for (const t of unresolvedTargets) {
    nodes.push({ id: `unresolved:${t}`, kind: "unresolved", path: t, label: t, area: "Unresolved", depth: 1, tags: ["open"], aliases: [], color: "#64748b", outgoing: 0, incoming: 0, unresolved: true });
  }
  for (const [ai, a] of demoAreas.entries()) {
    const ids = byArea.get(a.path) ?? [];
    const next = demoAreas[(ai + 1) % demoAreas.length];
    const nextIds = byArea.get(next.path) ?? [];
    const projectHub = byArea.get("20_Projects")?.[0];
    const atlasHub = byArea.get("00_Atlas")?.[0];
    ids.forEach((id, i) => {
      addLink(links, "wikilink", id, ids[(i + 1) % ids.length]);
      addLink(links, "wikilink", id, nextIds[i % nextIds.length]);
      if (i % 2 === 0 && projectHub && id !== projectHub) addLink(links, "property", id, projectHub, "initiative");
      if (i % 3 === 0 && atlasHub && id !== atlasHub) addLink(links, "markdown", id, atlasHub, "map");
      if (i === 2) addLink(links, "wikilink", id, `unresolved:${unresolvedTargets[ai % unresolvedTargets.length]}`);
    });
  }
  applyDemoCounts(nodes, links);
  const content = links.filter((l) => l.kind !== "contains");
  return {
    nodes, links,
    stats: {
      indexedAt: new Date(now).toISOString(), durationMs: 42, files: all.length,
      folders: demoAreas.length + 1, unresolved: unresolvedTargets.length, links: links.length,
      wikilinks: links.filter((l) => l.kind === "wikilink").length,
      markdownLinks: links.filter((l) => l.kind === "markdown").length,
      propertyLinks: links.filter((l) => l.kind === "property").length,
      orphans: nodes.filter((n) => n.kind === "file" && !content.some((l) => l.source === n.id || l.target === n.id)).length,
    },
    areas: ["Vault", ...demoAreas.map((a) => a.path), "Unresolved"],
    tags: ["active", "archive", "context", "demo", "draft", "linked", "map", "project", "reference", "research", "signal", "source", "structure", "writing"],
    statuses: ["active", "draft", "stable"],
    types: ["brief", "hub", "note"],
    diagnostics: {
      notes: all.length, folders: demoAreas.length + 1, attachments: 0,
      unresolvedLinks: unresolvedTargets.length, ambiguousLinks: 0,
      lineageEdges: 0, lineageCycles: 0, lineageWarnings: [], residualCollisions: 0,
    },
  };
}

export interface DemoEvent {
  id: string;
  type: "add" | "change";
  path: string;
  area: string;
  extension: string;
  at: string;
  message?: string;
}

export function createDemoVaultEvents(now = Date.now()): DemoEvent[] {
  const paths = ["20_Projects/Vault Kosmos.md", "40_Writing/Public Alpha Story.md", "00_Atlas/Routes and Tours.md", "30_Sources/WebGL Performance.md", "10_Research/Spatial Computing.md", "50_People/Future Contributors.md", "20_Projects/Presentation Route Alpha.md", "40_Writing/Demo Walkthrough.md"];
  return paths.map((path, i) => ({
    id: `demo-event:${i}`,
    type: i % 3 === 0 ? ("add" as const) : ("change" as const),
    path,
    area: path.split("/")[0] ?? "Demo",
    extension: "md",
    at: new Date(now - (paths.length - i) * 54000).toISOString(),
    message: i === paths.length - 1 ? "Demo focus pulse" : undefined,
  }));
}
