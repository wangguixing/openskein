// scripts/build.mjs — 构建各包：tsc 产出 JS+d.ts，esbuild 压缩 JS（依赖外置，仅压缩不内联）
// 版本注入：构建期把各包 package.json 的 version 以 define 注入 __SKEIN_VERSION__——
// 避免源码/产物里出现硬编码版本串（曾出现 MCP server 上报 0.1.0 而包已是 0.1.1 的漂移）。
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const ORDER = ["core", "catalog", "opencode", "cli", "mcp"];
const tsc = join("node_modules", "typescript", "lib", "tsc.js");

function jsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

for (const name of ORDER) {
  const pkg = `packages/${name}`;
  const dist = join(pkg, "dist");
  const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;

  console.log(`[tsc] @openskein/${name}`);
  execFileSync(process.execPath, [tsc, "-p", `${pkg}/tsconfig.build.json`], { stdio: "inherit" });

  const entries = jsFiles(dist);
  const before = entries.reduce((n, f) => n + statSync(f).size, 0);
  await build({
    entryPoints: entries,
    outdir: dist,
    allowOverwrite: true,
    bundle: false, // 依赖外置：只压缩自身产物，不内联 node_modules
    minify: true,
    format: "esm",
    platform: "node",
    target: "node18",
    legalComments: "none",
    logLevel: "warning",
    define: { __SKEIN_VERSION__: JSON.stringify(version) },
  });
  const after = entries.reduce((n, f) => n + statSync(f).size, 0);
  console.log(`[min] @openskein/${name}  v${version}  ${entries.length} files  ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB`);
}

console.log("[build] done");
