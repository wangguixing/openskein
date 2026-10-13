// scripts/version.mjs — 版本治理：核对远端已发布版本，并自动升级到可发布的版本
// 动机：0.1.0 已发布过时 `npm publish` 会以 "cannot publish over previously published versions" 失败——
//       应在构建/发布**之前**拦截，而不是发到一半炸。
// 用法：
//   node scripts/version.mjs                            核对（只读，发现问题退出码 1）
//   node scripts/version.mjs --bump                     自动升级到「所有包皆可发布」的最小版本
//   node scripts/version.mjs --release 1.0.0            指定版本（低于远端已发布最高版则拒绝）
//   node scripts/version.mjs --release 0.2.0 --force    强制设为该版本（回滚用；该版本必须未被发布）
//
// 实现要点（踩过的坑）：
//   - **不用 `npm version --workspaces`**：它会把 workspace 内依赖重写成精确版本，而精确版本会被 npm
//     解析为"去 registry 取该版本"，在 registry 上没有该版本时报 `ETARGET notarget`。改为直接写
//     package.json（BOM 无），并把 `@openskein/*` 依赖统一写成 `^<version>`（npm 优先链接本地 workspace）。
//   - **写盘后必须 `npm install`**：同步 package-lock.json 与 node_modules 链接，否则发布/构建状态不一致。
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { get } from "node:https";

const REGISTRY = "https://registry.npmjs.org/";
const PACKAGES = [
  ["@openskein/core", "packages/core"],
  ["@openskein/catalog", "packages/catalog"],
  ["@openskein/opencode", "packages/opencode"],
  ["@openskein/cli", "packages/cli"],
  ["@openskein/mcp", "packages/mcp"],
];
const ROOT_PKG = "package.json";

const args = process.argv.slice(2);
const releaseIdx = args.indexOf("--release");
const explicit = releaseIdx >= 0 ? args[releaseIdx + 1] : undefined;
const force = args.includes("--force"); // 允许降版（回滚）；目标版本必须未被发布
const doBump = args.includes("--bump") || releaseIdx >= 0;

/** 写盘用的 npm：优先「当前 node 同目录的 npm-cli.js」（PATH 里可能是 npm@6，不支持 workspaces） */
function resolveNpm() {
  if (process.env.SKEIN_NPM) return process.env.SKEIN_NPM;
  const cli = join(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(cli)) return `"${process.execPath}" "${cli}"`;
  return "npm";
}
const NPM = resolveNpm();

/** semver 三段解析（仅 x.y.z，忽略 pre-release 比较） */
function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
const fmt = (v) => v.join(".");

/** 读 package.json（原样文本 + 解析结果；写回时保持无 BOM） */
function readPkg(file) {
  const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  return { raw, json: JSON.parse(raw) };
}

/** 远端已发布版本（未发布 -> []；网络失败抛出） */
function publishedVersions(name) {
  const url = `${REGISTRY}${name.replace("/", "%2F")}`;
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { accept: "application/vnd.npm.install-v1+json" } }, (res) => {
      if (res.statusCode === 404) {
        res.resume();
        resolve([]);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`registry 返回 ${res.statusCode}`));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(Object.keys(JSON.parse(body).versions ?? {}));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("registry 请求超时")));
  });
}

const local = new Map();
for (const [name, dir] of PACKAGES) local.set(name, readPkg(join(dir, "package.json")).json.version);

console.log(`[version] registry=${REGISTRY}`);
const remote = new Map();
for (const [name] of PACKAGES) {
  try {
    remote.set(name, await publishedVersions(name));
  } catch (e) {
    console.error(`✖ 无法读取 ${name} 的远端版本：${e.message}`);
    process.exit(2);
  }
}

let conflicts = 0;
let behind = 0;
const rows = [];
for (const [name] of PACKAGES) {
  const lv = local.get(name);
  const vs = remote.get(name);
  const lp = parse(lv);
  const highest = vs.map(parse).filter(Boolean).sort(cmp).at(-1);
  const taken = vs.includes(lv);
  const isBehind = Boolean(highest && lp && cmp(lp, highest) < 0);
  if (taken) conflicts++;
  if (isBehind) behind++;
  rows.push({ name, local: lv, highest: highest ? fmt(highest) : "(未发布)", published: vs.length, taken, isBehind });
}

console.log("\n包名                  本地      远端最高    已发布  状态");
for (const r of rows) {
  const state = r.taken ? "✖ 已占用" : r.isBehind ? "✖ 落后于远端" : "✔ 可发布";
  console.log(
    `${r.name.padEnd(22)}${r.local.padEnd(10)}${r.highest.padEnd(12)}${String(r.published).padEnd(8)}${state}`,
  );
}

const allParsed = [];
for (const [name] of PACKAGES) {
  for (const v of remote.get(name)) {
    const p = parse(v);
    if (p) allParsed.push(p);
  }
  const p = parse(local.get(name));
  if (p) allParsed.push(p);
}
const maxAll = allParsed.sort(cmp).at(-1) ?? [0, 0, 0];
const autoNext = fmt([maxAll[0], maxAll[1], maxAll[2] + 1]);

function suggest() {
  if (explicit) {
    const p = parse(explicit);
    if (!p) throw new Error(`--release 版本号非法：${explicit}`);
    if (force) {
      for (const [name] of PACKAGES)
        if (remote.get(name).includes(fmt(p)))
          throw new Error(`--release ${explicit} 已被 ${name} 发布，不能用 --force 覆盖`);
      return fmt(p);
    }
    if (cmp(p, maxAll) <= 0) throw new Error(`--release ${explicit} 不高于已存在最高版 ${fmt(maxAll)}`);
    return fmt(p);
  }
  let next = [maxAll[0], maxAll[1], maxAll[2] + 1];
  while (PACKAGES.some(([name]) => remote.get(name).includes(fmt(next)))) next = [next[0], next[1], next[2] + 1];
  return fmt(next);
}

if (!doBump) {
  if (conflicts === 0 && behind === 0) {
    console.log("\n✔ 全部包版本可发布");
    process.exit(0);
  }
  console.error(`\n✖ 存在 ${conflicts} 个版本冲突${behind ? `、${behind} 个落后` : ""}，当前版本不可发布。`);
  console.error(`  修复：npm run version:auto                   （自动升到 ${autoNext}）`);
  console.error(`        npm run version:auto -- --release 1.0.0 （指定版本）`);
  process.exit(1);
}

// --bump 且无冲突/无落后 -> 无需升级（避免无谓升版）
if (args.includes("--bump") && !explicit && conflicts === 0 && behind === 0) {
  console.log("\n✔ 全部包版本已可发布，无需升级");
  process.exit(0);
}

let target;
try {
  target = suggest();
} catch (e) {
  console.error(`\n✖ ${e.message}`);
  console.error(`  远端已存在的最高版本：${fmt(maxAll)}；请选一个更高的版本号。`);
  process.exit(1);
}

const current = new Set([...local.values()]);
if (current.size === 1 && current.has(target)) {
  console.log(`\n✔ 已是 ${target}，无需升级`);
  process.exit(0);
}

// 直接写 package.json：版本 + 把 @openskein/* 依赖统一为 ^target（避免精确版本被解析到 registry）
// ⛔ 唯一允许改动的字段：`version` 与 `@openskein/*` 的版本范围；`scripts` 键集合必须保持不变。
//    任何越界差异都中止 —— 防止版本脚本误删/静默回退其它字段（曾出现 check:version 脚本被回退）。
console.log(`\n[version] 升级 ${[...current].join("/")} -> ${target}`);
const transformed = (src) => {
  const out = structuredClone(src);
  out.version = target;
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const dep of Object.keys(out[field] ?? {})) if (dep.startsWith("@openskein/")) out[field][dep] = `^${target}`;
  }
  return out;
};

const targets = [ROOT_PKG, ...PACKAGES.map(([, dir]) => join(dir, "package.json"))];
const plan = targets.map((file) => {
  const { json: before } = readPkg(file);
  return { file, before, after: transformed(before) };
});

// 越界改动自检：逐键比较（只容忍 version 与 @openskein/* 范围差异）
function diffKeys(before, after, path = "") {
  const out = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    const p = path ? `${path}.${k}` : k;
    const a = before?.[k];
    const b = after?.[k];
    const bothObj = a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b);
    if (bothObj) out.push(...diffKeys(a, b, p));
    else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(p);
  }
  return out;
}
const ALLOWED = /^version$|^(dependencies|devDependencies|peerDependencies|optionalDependencies)\.@openskein\//;
for (const { file, before, after } of plan) {
  const bad = diffKeys(before, after).filter((k) => !ALLOWED.test(k));
  if (bad.length > 0) {
    console.error(`✖ ${file} 存在越界改动，已中止：${bad.join(", ")}`);
    process.exit(1);
  }
}

for (const { file, before, after } of plan) {
  if (JSON.stringify(before) === JSON.stringify(after)) {
    console.log(`  ${file} 无需改动`);
    continue;
  }
  writeFileSync(file, `${JSON.stringify(after, null, 2)}\n`, "utf8");
  console.log(`  ${file} -> ${after.version}`);
}

// 同步 lockfile + workspace 链接（不装依赖，只重算元数据）
try {
  execSync(`${NPM} install --package-lock-only`, { stdio: "inherit" });
} catch {
  console.warn("[version] 警告：package-lock-only 同步失败，请手动执行 npm install");
}

// 写盘后自检：所有包同版本，且 @openskein/* 依赖为 ^target
let bad = 0;
for (const [name, dir] of PACKAGES) {
  const { json } = readPkg(join(dir, "package.json"));
  if (json.version !== target) {
    console.error(`✖ ${name} 版本未同步：${json.version} != ${target}`);
    bad++;
  }
  for (const [dep, range] of Object.entries(json.dependencies ?? {}))
    if (dep.startsWith("@openskein/") && range !== `^${target}`) {
      console.error(`✖ ${name} 的 ${dep} 依赖应为 ^${target}，实际 ${range}`);
      bad++;
    }
}
const rootJson = readPkg(ROOT_PKG).json;
if (rootJson.version !== target) {
  console.error(`✖ 根 package.json 版本未同步：${rootJson.version} != ${target}`);
  bad++;
}
if (bad > 0) {
  console.error(`\n✖ 版本写盘自检失败（${bad} 项）`);
  process.exit(1);
}
console.log(`\n✔ 已升级到 ${target}；请重新构建后发布：npm run build && npm run publish:all`);
