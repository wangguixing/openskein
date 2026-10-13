// scripts/reset-manifests.mjs — 包清单幂等修复器
// 用途：把根与 5 个包的 package.json 收敛到「仓库约定状态」。当编辑器缓冲区/手工编辑把清单改回旧状态
//       （例如 0.1.0 + `@openskein/*: "*"`、丢失 prepublishOnly）时，一条命令即可恢复。
// 收敛内容：
//   - 根/5 包 version = PACKAGE_VERSION（改动版本请走 `npm run version:auto`，不是改这里）
//   - 内部依赖 @openskein/* = ^<version>
//   - 每个包 scripts.prepublishOnly = npm run build -w <pkg>（直连 npm publish 也会先重建）
//   - 根 scripts.build 末尾带 `npm run check:version`
// 幂等：已符合则不写盘（--check 模式只报告，漂移时退出码 1）
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_VERSION = "0.1.2";
const PKGS = [
  ["@openskein/core", "packages/core"],
  ["@openskein/catalog", "packages/catalog"],
  ["@openskein/opencode", "packages/opencode"],
  ["@openskein/cli", "packages/cli"],
  ["@openskein/mcp", "packages/mcp"],
];
const ROOT = "package.json";
const checkOnly = process.argv.includes("--check");

const read = (f) => JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const write = (f, j) => writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`, "utf8");

const drift = [];

// 根：版本 + build 链包含 check:version
{
  const j = read(ROOT);
  const before = JSON.stringify(j);
  j.version = PACKAGE_VERSION;
  const build = j.scripts?.build ?? "";
  if (!build.includes("check:version")) {
    j.scripts.build = `${build}${build.includes("&&") ? " && " : ""}npm run check:version`;
  }
  if (JSON.stringify(j) !== before) {
    drift.push(`${ROOT}: version/build`);
    if (!checkOnly) write(ROOT, j);
  }
}

// 5 包：版本 + 内部依赖范围 + prepublishOnly
for (const [name, dir] of PKGS) {
  const f = join(dir, "package.json");
  const j = read(f);
  const before = JSON.stringify(j);
  j.version = PACKAGE_VERSION;
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const dep of Object.keys(j[field] ?? {})) if (dep.startsWith("@openskein/")) j[field][dep] = `^${PACKAGE_VERSION}`;
  }
  j.scripts = j.scripts ?? {};
  // ⛔ 不用 `npm run build -w <pkg>`（那只跑 tsc，不跑 esbuild 的 __SKEIN_VERSION__ 注入与压缩）——
  //    曾因此发布出 "version: __SKEIN_VERSION__" 的中间产物。改为拒绝直发，引导走发布脚本。
  const want = 'node -e "console.error(\'请勿直接 npm publish；请用 npm run publish:all（含完整构建+校验）\');process.exit(1)"';
  if (j.scripts.prepublishOnly !== want) j.scripts.prepublishOnly = want;
  if (JSON.stringify(j) !== before) {
    drift.push(`${f}: version/deps/prepublishOnly`);
    if (!checkOnly) write(f, j);
  }
}

if (drift.length === 0) {
  console.log(`✔ 6 个清单均已符合约定（version=${PACKAGE_VERSION}，含 prepublishOnly 与 check:version）`);
  process.exit(0);
}
if (checkOnly) {
  console.error(`✖ 检测到 ${drift.length} 处清单漂移（可能被编辑器旧缓冲覆盖）：`);
  for (const d of drift) console.error(`   - ${d}`);
  console.error("   修复：npm run fix:manifests");
  process.exit(1);
}
console.log(`[reset] 已修复 ${drift.length} 处清单漂移：`);
for (const d of drift) console.log(`   - ${d}`);
