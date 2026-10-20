export const COMMON_GKX_DEVELOPER_EXCLUSIONS = [
  "**/AGENT.md",
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/CODEX.md",
  "**/GEMINI.md",
  "**/copilot-instructions.md",
  "**/.github/copilot-instructions.md",
  "**/.claude/**",
  "**/_Claude-Code/**",
] as const;

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
}

function globRegex(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  let out = "^";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        i++;
        if (normalized[i + 1] === "/") { i++; out += "(?:.*/)?"; }
        else out += ".*";
      } else out += "[^/]*";
    } else if (char === "?") out += "[^/]";
    else out += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${out}$`, "i");
}

export function normalizeGkxExclusionPatterns(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n/) : [];
  return [...new Set(rows.map((row) => normalizePath(String(row).trim())).filter((row) => row && row.length <= 240 && !row.includes("\0")))].slice(0, 200);
}

export function effectiveGkxExclusionPatterns(custom: unknown, developerPreset: boolean): string[] {
  return normalizeGkxExclusionPatterns([...(developerPreset ? COMMON_GKX_DEVELOPER_EXCLUSIONS : []), ...normalizeGkxExclusionPatterns(custom)]);
}

export function matchedGkxExclusion(path: string, custom: unknown, developerPreset: boolean): string | null {
  const normalized = normalizePath(path);
  for (const pattern of effectiveGkxExclusionPatterns(custom, developerPreset)) {
    const target = pattern.includes("/") ? normalized : normalized.split("/").pop() ?? normalized;
    if (globRegex(pattern).test(target)) return pattern;
  }
  return null;
}

export function isGkxPathExcluded(path: string, custom: unknown, developerPreset: boolean): boolean {
  return matchedGkxExclusion(path, custom, developerPreset) != null;
}
