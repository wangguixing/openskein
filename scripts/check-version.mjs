// scripts/check-version.mjs — 产物与版本一致性防呆（发布前必过）
// 1) 产物中 MCP 上报版本必须等于 packages/mcp/package.json.version（构建期 __SKEIN_VERSION__ 注入）
// 2) **全包 dist 不得残留未替换的 __SKEIN_VERSION__ 占位符**——出现即"该包未经过 esbuild 注入"，
//    是"发布了未构建中间产物"的直接证据（曾发生：线上 mcp@0.1.2 的 version 变成字面量 __SKEIN_VERSION__）
// 3) dist 不得残留未剥离的 TS 类型注解/import type（同一类"未构建"信号）
// 4) 源码不得残留硬编码 `version: "0.x"`
// 用法：node scripts/check-version.mjs（已接入 npm run build 与发布前预检）
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PKGS = ["core", "catalog", "opencode", "cli", "mcp"];
const problems = [];
const notes = [];

function jsFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

// 1) + 2) MCP 产物版本注入核对 + 全包占位符残留扫描
const mcpVersion = JSON.parse(readFileSync(join("packages", "mcp", "package.json"), "utf8")).version;
const mcpDist = join("packages", "mcp", "dist", "index.js");
if (existsSync(mcpDist)) {
  const text = readFileSync(mcpDist, "utf8");
  const m = /name:\s*"openskein"\s*,\s*version:\s*"([^"]+)"/.exec(text);
  if (!m) problems.push("packages/mcp/dist/index.js 中未找到 MCP 版本串（构建期 __SKEIN_VERSION__ 注入失效？）");
  else if (m[1] !== mcpVersion) problems.push(`MCP 上报版本 ${m[1]} 与 packages/mcp/package.json 的 ${mcpVersion} 不一致`);
} else {
  notes.push("跳过 MCP 产物校验（packages/mcp/dist 尚未构建）");
}

for (const p of PKGS) {
  const dist = join("packages", p, "dist");
  const files = jsFiles(dist);
  if (files.length === 0) continue;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (text.includes("__SKEIN_VERSION__"))
      problems.push(`${f} 残留未替换的 __SKEIN_VERSION__ 占位符 → 该包未经过构建期注入（勿发布）`);
    if (/^import\s+type\s/m.test(text) || /:\s*(string|number|boolean)\s*[,)=]/m.test(text))
      problems.push(`${f} 疑似未剥离类型（import type / 类型注解残留）→ 该包未经过构建（勿发布）`);
  }
}

// 3) 源码硬编码版本串扫描
for (const p of PKGS) {
  const src = join("packages", p, "src");
  if (!existsSync(src)) continue;
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".ts")) continue;
    const lines = readFileSync(join(src, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/version\s*:\s*"0\./.test(line)) problems.push(`packages/${p}/src/${f}:${i + 1} 残留硬编码版本串`);
    });
  }
}

for (const n of notes) console.log(`· ${n}`);
if (problems.length > 0) {
  console.error("✖ 版本/产物一致性检查失败：");
  for (const p of problems) console.error(`   - ${p}`);
  console.error("   修复：npm run build（须跑完整 build:packages，不能只跑 tsc）");
  process.exit(1);
}
console.log(`✔ 版本与产物一致性通过（MCP 上报 = ${mcpVersion}；无占位符/类型残留；无硬编码版本串）`);
