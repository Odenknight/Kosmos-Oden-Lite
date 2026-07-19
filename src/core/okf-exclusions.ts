export const COMMON_OKF_DEVELOPER_EXCLUSIONS = [
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

export function normalizeOkfExclusionPatterns(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n/) : [];
  return [...new Set(rows.map((row) => normalizePath(String(row).trim())).filter((row) => row && row.length <= 240 && !row.includes("\0")))].slice(0, 200);
}

export function effectiveOkfExclusionPatterns(custom: unknown, developerPreset: boolean): string[] {
  return normalizeOkfExclusionPatterns([...(developerPreset ? COMMON_OKF_DEVELOPER_EXCLUSIONS : []), ...normalizeOkfExclusionPatterns(custom)]);
}

export function matchedOkfExclusion(path: string, custom: unknown, developerPreset: boolean): string | null {
  const normalized = normalizePath(path);
  for (const pattern of effectiveOkfExclusionPatterns(custom, developerPreset)) {
    const target = pattern.includes("/") ? normalized : normalized.split("/").pop() ?? normalized;
    if (globRegex(pattern).test(target)) return pattern;
  }
  return null;
}

export function isOkfPathExcluded(path: string, custom: unknown, developerPreset: boolean): boolean {
  return matchedOkfExclusion(path, custom, developerPreset) != null;
}
