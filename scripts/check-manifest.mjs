// scripts/check-manifest.mjs — 防呆：根 package.json 必备 devDependencies 与 scripts
import { readFileSync } from "node:fs";

const REQUIRED_DEV = ["typescript", "esbuild", "@types/node"];
const REQUIRED_SCRIPTS = [
  "check:manifest",
  "check:version",
  "version:check",
  "version:auto",
  "typecheck",
  "test",
  "clean",
  "build:packages",
  "build",
  "publish:all",
  "release:auto",
];

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const missing = [];

for (const d of REQUIRED_DEV) {
  if (!pkg.devDependencies || !pkg.devDependencies[d]) missing.push(`devDependencies.${d}`);
}
for (const s of REQUIRED_SCRIPTS) {
  if (!pkg.scripts || !pkg.scripts[s]) missing.push(`scripts.${s}`);
}

if (missing.length > 0) {
  console.error("✖ package.json 缺少必备项：");
  for (const m of missing) console.error(`   - ${m}`);
  console.error("（用于防止整文件重写时误删 devDependencies / scripts）");
  process.exit(1);
}

console.log(`✔ package.json 检查通过（devDependencies×${REQUIRED_DEV.length}，scripts×${REQUIRED_SCRIPTS.length}）`);
