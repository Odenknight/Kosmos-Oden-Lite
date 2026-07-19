/** Kosmos Core — deterministic area palette (shared by every surface). */
import { hashString } from "./paths";

const preferredAreaPalette = new Map<string, string>([
  ["00_System", "#65a7ff"], ["01_Dashboard", "#f4d35e"], ["10_Inbox", "#ff6b6b"],
  ["20_Wissen", "#b38cff"], ["30_Quellen", "#2dd4bf"], ["40_Projekte", "#60d394"],
  ["50_Codex", "#ff8bd1"], ["51_Claude", "#f9a03f"], ["52_ChatGPT", "#7dd3fc"],
  ["60_Organisation", "#a3e635"], ["70_Outputs", "#fb7185"], ["90_Archiv", "#94a3b8"],
  ["Vault", "#f8fafc"], ["Root", "#dbeafe"], ["Unresolved", "#ffb86b"],
]);

const generatedAreaPalette = [
  "#65a7ff", "#f4d35e", "#ff6b6b", "#b38cff", "#2dd4bf", "#60d394", "#ff8bd1",
  "#f9a03f", "#7dd3fc", "#a3e635", "#fb7185", "#c084fc", "#38bdf8", "#34d399",
  "#facc15", "#818cf8", "#fb923c", "#22d3ee",
];

export function colorForArea(area: string): string {
  const pref = preferredAreaPalette.get(area);
  if (pref) return pref;
  const h = hashString(area || "Vault");
  const base = generatedAreaPalette[h % generatedAreaPalette.length];
  const rot = Math.floor(h / generatedAreaPalette.length) % 7;
  return rotateHex(base, (rot - 3) * 6);
}

function rotateHex(hex: string, deg: number): string {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToHex((h + deg + 360) % 360, s, l);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((ch) => Math.round((ch + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
