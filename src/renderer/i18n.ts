/** Kosmos renderer — EN/DE interface strings. */

export const I18N: Record<string, Record<string, string>> = {
  en: {
    overview: "Overview", focus: "Focus", depth: "Depth", fly: "Fly", labels: "Labels", clear: "Clear",
    filters: "Filters", areas: "Areas", tags: "Tags", types: "Types", status: "Status", unresolved: "Show unresolved",
    grow: "Grow", timeline: "Timeline", trailer: "Trailer", chrono: "Chrono", links: "Links", backlinks: "Backlinks",
    allLinks: "All links", allObjects: "All objects",
    star: "Star", planet: "Planet", moon: "Moon · moonlet", asteroid: "Asteroid",
    hubMajor: "major hub", hubMinor: "minor hub", related: "related note", rogue: "rogue / unresolved",
    relrow: "links & relations", keyTitle: "Constellation key",
  },
  de: {
    overview: "Überblick", focus: "Fokus", depth: "Tiefe", fly: "Flug", labels: "Labels", clear: "Leeren",
    filters: "Filter", areas: "Bereiche", tags: "Tags", types: "Typen", status: "Status", unresolved: "Unaufgelöste zeigen",
    grow: "Wachsen", timeline: "Zeitachse", trailer: "Trailer", chrono: "Chrono", links: "Verweise", backlinks: "Rückverweise",
    allLinks: "Alle Verbindungen", allObjects: "Alle Objekte",
    star: "Stern", planet: "Planet", moon: "Mond · Mondchen", asteroid: "Asteroid",
    hubMajor: "großer Knoten", hubMinor: "kleiner Knoten", related: "verwandte Notiz", rogue: "lose / unaufgelöst",
    relrow: "Verweise & Relationen", keyTitle: "Sternbild-Legende",
  },
};

export function detectLang(): string {
  const nav = typeof navigator !== "undefined" ? navigator.language || "en" : "en";
  return nav.toLowerCase().indexOf("de") === 0 ? "de" : "en";
}
