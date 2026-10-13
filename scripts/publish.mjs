// scripts/publish.mjs — 按依赖顺序发布到官方 npm（classic Automation (bypass 2FA) token）
// 策略：
//   - 认证使用 npm classic Automation token（绕过 2FA）；存于 ~/.npmrc 的
//     //registry.npmjs.org/:_authToken=...，或经环境变量 NPM_TOKEN 注入（CI 场景用 secret）
//   - **发布前置版本闸**：核对 5 个包在 registry 上的已发布版本，冲突/落后即中止
//     （避免 "cannot publish over previously published versions" 发到一半失败）
//   - 用法：NPM_TOKEN=npm_xxx npm run publish:all（已配 ~/.npmrc 时可省略 NPM_TOKEN）
//   - 全自动（发布前自动升版本并重建）：npm run release:auto
//   - 预演（不真正发布）：DRY=1 node scripts/publish.mjs
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { get } from "node:https";
import { join } from "node:path";

const REGISTRY = "https://registry.npmjs.org/";
const ORDER = [
  "@openskein/core",
  "@openskein/catalog",
  "@openskein/opencode",
  "@openskein/cli",
  "@openskein/mcp",
];

const token = process.env.NPM_TOKEN;
const dry = process.env.DRY === "1";

// NPM_TOKEN 经 CLI 配置注入（CI / 不落盘）；否则用 ~/.npmrc 现有凭据
const authArgs = token ? [`--//registry.npmjs.org/:_authToken=${token}`] : [];

// 发布前预检 0：根清单防呆（必备 devDependencies/scripts 存在，防整文件重写误删）
if (!dry) {
  try {
    execSync("node scripts/check-manifest.mjs", { stdio: "inherit" });
  } catch {
    console.error("\n[publish] 根 package.json 清单检查未通过，已中止。");
    process.exit(1);
  }
}

// 发布前预检 0b：源码中不得残留硬编码版本串（应由 build.mjs 的 __SKEIN_VERSION__ 注入）
{
  const hits = [];
  for (const name of ORDER) {
    const dir = join("packages", name.split("/")[1], "src");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      const text = readFileSync(join(dir, f), "utf8");
      text.split("\n").forEach((line, i) => {
        if (/version\s*:\s*"0\./.test(line) && !line.includes("__SKEIN_VERSION__"))
          hits.push(`packages/${name.split("/")[1]}/src/${f}:${i + 1}`);
      });
    }
  }
  if (hits.length > 0) {
    console.error("[publish] ✖ 源码中残留硬编码版本串（应由构建期注入 __SKEIN_VERSION__）：");
    for (const h of hits) console.error(`   ${h}`);
    process.exit(1);
  }
}

// 发布前预检 1：版本闸（本地版本不得已被占用、也不得落后于远端）
if (!dry) {
  try {
    execSync("node scripts/version.mjs", { stdio: "inherit" });
  } catch {
    console.error("\n[publish] 版本闸未通过，已中止。修复：npm run version:auto");
    process.exit(1);
  }
}

// 发布前预检 2：确认凭据可用（未认证立即中止，避免半途 403/404）
if (!dry) {
  try {
    const who = execSync(`npm whoami --registry ${REGISTRY} ${authArgs.join(" ")}`, { encoding: "utf8" }).trim();
    console.log(`[publish] 认证通过：${who}（registry=${REGISTRY}${token ? "，使用 NPM_TOKEN" : "，使用 ~/.npmrc"}）`);
  } catch {
    console.error(`[publish] 未在 ${REGISTRY} 认证。请配置 classic Automation (bypass 2FA) token：`);
    console.error("          NPM_TOKEN=npm_xxx npm run publish:all");
    console.error("          或写入 ~/.npmrc： //registry.npmjs.org/:_authToken=<token>");
    process.exit(1);
  }
}

// 发布前预检 3：产物新鲜度——dist 必须不早于其包的源码与 package.json
// （npm publish 不会自动 build；版本刚被改过而 dist 未重建时，会把旧产物发出去）
{
  const stale = [];
  for (const name of ORDER) {
    const short = name.split("/")[1];
    const dist = join("packages", short, "dist");
    if (!existsSync(dist)) {
      stale.push(`${name}: 缺少 dist（先执行 npm run build）`);
      continue;
    }
    const out = readdirSync(dist)
      .filter((f) => f.endsWith(".js"))
      .map((f) => statSync(join(dist, f)).mtimeMs);
    if (out.length === 0) {
      stale.push(`${name}: dist 中无 .js 产物`);
      continue;
    }
    const newestOut = Math.max(...out);
    const src = join("packages", short, "src");
    const inputs = [
      ...(existsSync(src) ? readdirSync(src).map((f) => join(src, f)) : []),
      join("packages", short, "package.json"),
    ];
    for (const f of inputs) {
      if (!existsSync(f)) continue;
      if (statSync(f).mtimeMs > newestOut) {
        stale.push(`${name}: ${f} 比 dist 产物新（需重新构建）`);
        break;
      }
    }
  }
  if (stale.length > 0) {
    console.error("[publish] ✖ 产物不新鲜，拒绝发布：");
    for (const s of stale) console.error(`   ${s}`);
    console.error("   修复：npm run build（或直接 npm run release:auto）");
    process.exit(1);
  }
  console.log("[publish] 产物新鲜度检查通过");
}

/** 读取已发布版本元数据（真实消费者路径；404 视为未上线） */
function fetchVersionMeta(name, version) {
  const url = `${REGISTRY}${name.replace("/", "%2F")}/${version}`;
  return new Promise((resolve) => {
    const req = get(url, { headers: { accept: "application/json", "cache-control": "no-cache" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(20000, () => req.destroy());
  });
}

/** 发布后验证：版本元数据可读 **且 tarball 可下载**（"202 但制品没落地"会在此暴露） */
async function verifyPublished(name, version) {
  const deadline = Date.now() + 120000; // 最多等 2 分钟（registry 传播）
  for (;;) {
    const meta = await fetchVersionMeta(name, version);
    if (meta?.dist?.tarball) {
      const ok = await new Promise((resolve) => {
        const req = get(meta.dist.tarball, { method: "HEAD" }, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on("error", () => resolve(false));
        req.setTimeout(20000, () => req.destroy());
      });
      if (ok) return true;
    }
    if (Date.now() >= deadline) return false;
    console.log(`[publish]   等待 ${name}@${version} 制品落地…`);
    await new Promise((r) => setTimeout(r, 10000));
  }
}

const failures = [];
for (const name of ORDER) {
  const version = JSON.parse(readFileSync(join("packages", name.split("/")[1], "package.json"), "utf8")).version;
  // --ignore-scripts：跳过各包 prepublishOnly 防呆（仅用于拦截手动 npm publish；本脚本已完成完整构建+校验）
  const parts = ["npm", "publish", "-w", name, "--registry", REGISTRY, "--ignore-scripts", ...authArgs];
  if (dry) parts.push("--dry-run");
  console.log(`\n[publish] ${name}${dry ? " (dry-run)" : ""}`);
  execSync(parts.join(" "), { stdio: "inherit" });
  if (dry) continue;
  // 发布后消费者侧验证：不通过则记录，继续发下一个（避免半途中断留下更多缺件），最后统一失败退出
  if (await verifyPublished(name, version)) {
    console.log(`[publish] ✔ ${name}@${version} 制品可下载（消费者可用）`);
  } else {
    console.error(`[publish] ✖ ${name}@${version} 已提交但制品不可下载（tarball 404）——需补发新补丁版本`);
    failures.push(`${name}@${version}`);
  }
}

if (failures.length > 0) {
  console.error(`\n[publish] ✖ 有 ${failures.length} 个包发布后验证失败（版本已占用，无法重发同版本）：`);
  for (const f of failures) console.error(`   - ${f}`);
  console.error("   处理：`npm run version:auto` 升补丁版本后重新发布，或联系 npm 支持。");
  process.exit(1);
}
console.log("\n[publish] done");


