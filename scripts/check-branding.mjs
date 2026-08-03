import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const files = ["package.json", "manifest.json", "README.md"];
for (const dir of ["src/plugin", "src/renderer"]) {
  for (const name of readdirSync(new URL(`../${dir}`, import.meta.url))) {
    if (name.endsWith(".ts")) files.push(join(dir, name));
  }
}

const failures = [];
for (const path of files) {
  const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.includes("OKF+")) continue;
    if (/formerly|previously|legacy|compatib|historical|existing/i.test(line)) continue;
    failures.push(`${path}:${index + 1}: ${line.trim()}`);
  }
}

if (failures.length) {
  console.error("check-branding: visible KRS-Lite copy must use GKX; OKF+ is permitted only in explicit compatibility or historical context");
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("check-branding: OK — visible KRS-Lite copy uses GKX with bounded legacy compatibility references");
