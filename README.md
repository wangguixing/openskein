# openskein

> 运行时无关的「声明式状态机内核 + 适配层」：用一套引擎统一驱动 **workflow 执行 / agent 委派 / skill 装载**。

设计蓝图见 [`PLAN.md`](./PLAN.md)。

## 设计铁律

1. **纯内核**：`reduce(state, event) → { state, effects }` 零依赖 / 零 IO / 零运行时耦合。
2. **定义即数据**：工作流用 JSON（+ JSON Schema 校验），不做 markdown 正则解析。
3. **事件溯源**：状态由追加事件日志推导，不覆盖快照。
4. **效果即值**：副作用以 `Effect` 数据返回，由适配层执行。

## 包结构

```
packages/
  core/      纯内核：状态机 + 定义校验 + 事件存储 + 工具 + schema 迁移 + 干跑
  catalog/   资源图：扫描 skills/agents/commands/workflows + 引用解析/校验
  opencode/  opencode 插件适配（注册 skein_* 工具，状态落 .skein/）
  mcp/       MCP stdio server 适配（复用同一 ToolSpec）
  cli/       命令行：validate / list / sim / status / install / doctor / uninstall
```

## 快速开始

```bash
npm run build    # 完整流水线：typecheck → test → clean → build:packages
npm run typecheck        # 类型检查（tsc --noEmit）
npm test         # 单测（源码直跑，无需先 build）
npm run build:packages   # 仅产出 dist（tsc + esbuild 压缩）
npm run clean    # 清理 dist
node packages/cli/bin/skein.mjs help
node examples/catalog-smoke.ts [configRoot]   # 对真实配置仓跑资源图
```

> 源码为 TypeScript：**开发/测试**经各包 `exports` 的 `development` 条件解析到 `src`（Node ≥ 22.6 原生类型擦除），故 `npm test` **无需先 build**；**发布/产物**用 `build:packages` 产出 `dist/`（JS + 类型声明，esbuild 压缩，`bundle:false` 依赖外置）。`npm run build` 按 **先类型检查、再测试、清理旧产物、最后构建** 的顺序成链。
>
> ⚠ **Node 运行时要求**：`node --test` + `.ts` 直跑需 **Node ≥ 22.18 / 24**（类型擦除默认开启）。Node 22.6–22.17 需显式加 `--experimental-strip-types`；Node ≤ 22.5 不支持（表现为 `bad option: --test` 或 `ERR_UNKNOWN_FILE_EXTENSION`）。若本机 nvm 切换过版本导致 `node` 指向旧版，请显式指定高版本 Node 跑门禁：
>
> ```powershell
> $node='D:\programs\TopAIDEV\resources\npm-runtime\node.exe'   # v22.14.0
> & $node scripts/check-manifest.mjs
> & $node node_modules/typescript/lib/tsc.js -p tsconfig.json
> & $node --experimental-strip-types --conditions=development --test 'packages/core/test/*.test.ts' 'packages/catalog/test/*.test.ts' 'packages/cli/test/*.test.ts' 'packages/mcp/test/*.test.ts'
> & $node scripts/build.mjs
> ```

## CLI（`skein`）

```bash
skein validate <fileOrDir>                            # 静态校验定义
skein list <dir>                                      # 列出定义
skein sim <file> --events '<json>'                    # 干跑（重放事件；`@file` 从文件读事件数组）
skein status <instanceId> --def <file> --state <dir>  # 查看实例状态
skein check <configRoot>                              # 校验配置仓资源图与引用
skein install <kitDir> --target <dir>                 # 安装 kit（skills/agents/commands/flows）
skein doctor --target <dir>                           # 校验已安装 kit（哈希）
skein uninstall --target <dir>                        # 按 lockfile 卸载
```

## opencode 集成

把 `@openskein/opencode` 加入 `opencode.json` 的 `plugin` 数组，即可获得 `skein_start/status/advance/await/pause/resume/cancel/validate` 工具（8 个）。

- **作用域**：定义支持 **全局 + 项目** 双作用域，按 `id` 合并（**项目覆盖全局**）。
  - 全局：`<globalRoot>/.skein/flows`，`globalRoot` 由适配层解析（`SKEIN_HOME` → `OPENCODE_CONFIG_DIR` → `~/.config/opencode`）。
  - 项目：`<project>/.skein/flows`。
- **状态**：事件日志持久化在 `<project>/.skein/events/`。

> ⚠ 本地试用需先 `npm publish`（opencode 从 npm 装插件），或把适配层产物放入 `.opencode/plugins/`。

## 内置流程

- `feature`：需求 → 规格 → 实现 → 审查
- `bug`：报告 → 诊断 → 最小复现 → TDD 修复 → 审查 → 提交 → 生成提交信息（移植自配置仓 `workflows/bug.md`）
- `review`：审查 → 人工确认（`await` 中断）→ 通过 / 返工回环（v2 原语样板）

## 定义规范 v2（最小原语）

> 方向依据：`workflow-engineering/docs/design/kernel-minimal-primitives-v2.md`。核心原则是**编排语义用原语组合表达**，而非给步骤机堆业务元数据（hooks/checkpoint/brief/pushRight）。

| 原语 | 形态 | 语义 |
|------|------|------|
| `state` + per-key reducer | 定义级 `state: { key: { reducer } }`；事件级 `patch` | `replace`（默认，覆盖；值为 `undefined` 删键）· `append`（数组拼接，**空数组不清空**）· `merge`（对象浅合并，`null`/非对象**跳过不清空**） |
| `await` 中断 | 步骤级 `await: { kind: "human", question, schema }` | 步骤通过 CC 后**停在当前步**：`status:"awaiting"` + 产出 `await_human` Effect（不推进） |
| `step.effects[]` | 步骤级 `effects: Effect[]` | 声明式附带副作用，**追加在** `kind` 派生 Effect **之后**（承载旧 hooks） |

`InstanceStatus` 因此为 5 态：`running | awaiting | paused | done | canceled`。

### await / resume 语义（唯一行为变更，请注意）

```text
start → [running] step 命中 await
  advance(step, evidence, patch)  → awaiting（停步，产出 await_human）
  resume(evidence?, patch?, branch?) → 完成判定 + 合并 patch + 推进到后继
  pause → paused，此时 resume 仅回到 running（v1 原语义，不推进）
```

- `resume` 按 `status` 分流：`paused` → 仅恢复运行；`awaiting` → 注入答复并推进（`evidence` 判 CC、`patch` 并入 `data`、`branch` 指定分支去向）。
- 步骤若带 `branch` 表，`resume` 必须给 `branch`（否则报"无后继"）。
- `await.kind:"signal"` 是 **Phase 2** 原语，Phase 1 静态校验报 `E_AWAIT_SIGNAL`，且不构成停步等待（避免留下无法满足的死分支）。

### 校验与告警

`skein validate` 区分**错误（`E_*`，阻断，退出码 1）**与**告警（`W_*`，不阻断）**：

- 错误：`E_SCHEMA` / `E_DANGLING` / `E_NEXT` / `E_UNREACHABLE` / `E_STATE_REDUCER` / `E_AWAIT_KIND` / `E_AWAIT_SIGNAL` / `E_EFFECT_KIND` / `E_CONSTRAINT_KIND` / `E_CONSTRAINT_TARGET` / `E_CONSTRAINT_TEXT` …
- 告警：`W_SCHEMA_OLD`（旧版本待迁移）、`W_CYCLE`（**返工/迭代回环是合法原语用法**，故降级为告警）

### 定义级约束（`constraints`）与适配层义务

内核**不执行** `constraints`（属适配层职责，见定稿 §6），但内核把义务**脚本化**，使"已声明未落地"可被检出：

| 类别 | kind | 说明 |
|------|------|------|
| **约束性义务** | `pre` `guard` `write` `timeout` `dispatch` `effect` `fallback` | 适配层必须处理；失败是否阻断见契约 |
| 注解 | `note` `output` `skip` | 供 LLM/人类阅读或纯声明，不要求动作 |

```ts
import { CONSTRAINT_CONTRACT, planConstraints } from "@openskein/core";

CONSTRAINT_CONTRACT.phase;      // kind → 触发时机：{ pre: "before-start", guard: "before-advance", ... }
CONSTRAINT_CONTRACT.blocking;   // kind → 失败是否阻断：{ pre: true, guard: true, dispatch: false, ... }
CONSTRAINT_CONTRACT.capability; // kind → 所需适配层能力：{ pre: "env-check", write: "fs-scope", ... }

const plan = planConstraints(def, { capabilities: ["env-check", "fs-scope"] });
plan.byPhase;   // 按时机分组的义务
plan.uncovered; // 无能力覆盖的约束性义务（适配层应视为缺口）
```

CLI 侧（可作为**适配层实现的验收门禁**，能力未接完则退出码 1 并指名缺口）：

```bash
skein obligations <dir...> [--caps a,b,c] [--verbose]
```

> 能力标签：`env-check`(pre) · `step-gate`(guard) · `fs-scope`(write) · `timer`(timeout) · `subagent-dispatch`(dispatch) · `tool-invoke`(effect) · `degrade-log`(fallback)。
> 新增 constraint kind 必须同时登记 `CONSTRAINT_CONTRACT`，否则被 `E_CONSTRAINT_KIND` 拦下（`checkContract()` 自检契约三表一致性）。

### 迁移

`schema: 1 → 2` 是破坏性升级，由 `migrate` 自动完成（v1 定义补 `state: {}`，迁移名 `state-context`，对原定义不可变且幂等）；CLI 全部入口在加载时自动迁移。

```bash
skein sim workflow-engineering/tests/flows/bug.json --events @workflow-engineering/tests/bug-v2.events.json
```

## 资源图配置（catalog targets）

`@openskein/catalog` **不写死任何仓库布局**，仅提供通用默认（`skills/agents/commands/workflows`）。仓库专属布局用配置文件注入：

```jsonc
// <configRoot>/.skein/catalog.json（或用 `skein check --config <file>`）
{ "targets": [
  { "kind": "skill", "dir": "skills", "layout": "skill-dir" },
  { "kind": "skill", "dir": "my-skills", "layout": "skill-dir" }
] }
```

完整示例见 [`examples/catalog.config.json`](./examples/catalog.config.json)。

## 可配置项

| 配置 | 默认 | 覆盖方式 |
|------|------|---------|
| 状态根目录 | `.skein` | `SKEIN_BASE_DIR` 环境变量 · `createSkeinPlugin({ baseDir })` · mcp `startServer(dir, baseDir)` |
| 全局根 | 适配层解析：`SKEIN_HOME` → `OPENCODE_CONFIG_DIR` → `~/.config/opencode` | `SKEIN_HOME` · `createSkeinPlugin({ globalRoot })` · mcp `startServer(dir, baseDir, globalRoot)` |
| 定义作用域 | global + project 合并（同 id 项目覆盖全局） | `createSkeinPlugin({ global: false })` 关闭全局 |
| catalog 扫描目录 | 通用默认 | `<configRoot>/.skein/catalog.json` · `skein check --config <file>` |
| kit 安装映射 | `skills/agents/commands/flows` → 同名/`.skein/flows` | kit 目录内 `kit.json` 的 `map` 字段 |

## 发布

- **安装（开发）**：走镜像——项目根 `.npmrc` 指向 `https://registry.npmmirror.com/`。
- **认证（classic bypass token）**：走官方源（镜像只读，不能 publish）。
  1. npm 网站 → Access Tokens → Generate New Token → **Classic Token**
  2. 类型选 **Automation**（绕过 2FA，供自动化发布）
  3. 写入 `~/.npmrc`：`//registry.npmjs.org/:_authToken=<token>`；CI 场景用环境变量注入
- **发布**：

  ```bash
  npm run release:auto                    # 推荐：自动升版本（如需）→ build → 按序发布
  npm run publish:all                     # 已确认版本可发布时：build → 发布
  NPM_TOKEN=npm_xxx npm run publish:all   # 或注入 token（CI / 不落盘）：core→catalog→opencode→cli→mcp 顺序
  DRY=1 node scripts/publish.mjs          # 预演（不真正发布，跳过版本闸与认证预检）
  ```

  单包发布亦可（各包 `publishConfig` 已声明 `access: public` + 官方源）：

  ```bash
  npm publish --workspace @openskein/core --registry https://registry.npmjs.org/
  ```

- **版本治理（`scripts/version.mjs`）**：发布前**必须**通过版本闸，避免 `cannot publish over previously published versions`。

  ```bash
  npm run version:check                       # 只读核对 5 个包的远端已发布版本（冲突/落后则退出码 1）
  npm run version:auto                        # 需要时自动升到「所有包皆可发布」的最小版本
  npm run version:auto -- --release 1.0.0     # 指定版本（不得低于远端已发布最高版）
  npm run version:auto -- --release 0.2.0 --force   # 回滚/降版（该版本必须尚未被发布）
  ```

  - `scripts/publish.mjs` 内置该闸门（发布前自动调用，未通过即中止）；`release:auto` = 升版 + 发布一条链。
  - 版本策略：**5 个包 + 根统一同版本号**；`@openskein/*` 内部依赖恒为 `^<version>`。
  - ⚠ **不要用 `npm version --workspaces`** 改版本：它会把内部依赖重写成**精确版本**，npm 随后会去 registry 取该版本（本地未发布时直接 `ETARGET notarget`）。脚本改为直接写 `package.json` 并同步 `package-lock.json`。
  - 版本脚本自身有**越界改动守卫**：除 `version` 与 `@openskein/*` 版本范围外，任何字段差异都不写盘（防止误删 `scripts` 等字段）。

- **清单漂移闸（`scripts/reset-manifests.mjs`）**：手工编辑 `package.json` 或做降级复现时，清单可能偏离仓库约定（版本非统一值、内部依赖回到 `*`、丢失 `prepublishOnly`）：

  ```bash
  npm run check:manifests   # 只读体检 6 个清单（漂移则退出码 1）
  npm run fix:manifests     # 幂等收敛回约定状态（统一版本 + ^版本依赖 + prepublishOnly）
  ```

  漂移时 `npm run build` 会在第一步 `check:manifest` 直接阻断并指名缺失项。

- **版本单一来源（禁止硬编码）**：代码里**不得**写死版本串；MCP server 的上报版本由构建期注入：

  ```ts
  declare const __SKEIN_VERSION__: string;      // packages/mcp/src/index.ts
  { name: "openskein", version: __SKEIN_VERSION__ }
  ```

  `scripts/build.mjs` 按包注入 `package.json.version`；`npm run check:version` 断言「产物上报版本 == package.json 版本」且源码无硬编码，已接入 `npm run build` 与发布前预检。

- **产物新鲜度闸**：`npm publish` 自身**不会**构建——版本刚改过而 dist 未重建时会把旧产物发出去（已发生过：`@openskein/mcp@0.1.1` 的 tarball 内仍上报 `0.1.0`）。因此：

  - `scripts/publish.mjs` 发布前比对 **源码 / package.json 的 mtime 与 dist 产物 mtime**，不新鲜即中止；
  - 每个包带 `prepublishOnly: npm run build -w <pkg>`，直接 `npm publish -w <pkg>` 也会先重建（发布 5 包时会重复构建一遍，可接受）。

- **发布后消费者侧验证**：`npm publish` 返回 202（"being processed"）**不等于制品可用**——已发生过 `@openskein/{opencode,cli,mcp}@0.1.2` 版本已登记（`dist-tags.latest` 已指向它）但 **tarball 始终 404**，消费者 `npm i` 直接失败，而 npm 又以"已发布过"拒绝重发同版本。

  `scripts/publish.mjs` 现在每发一个包就做**真实消费者验证**：读取版本元数据 → `HEAD` 该 tarball（最多等 2 分钟传播）→ 不通过则记录，5 个包全跑完再统一以非零码失败，并提示"补发补丁版本"。

  ```bash
  # 手工复核（干净 cache，等价消费者路径）
  npm pack @openskein/<pkg>@<version> --cache ./.npmcache
  ```

- **凭据策略**：使用 npm **classic Automation token**（绕过 2FA，仅用于自动化发布）。本地存 `~/.npmrc`，CI 经 `NPM_TOKEN` 注入；泄露或人员变动时应在 npm 网站撤销并轮换。`scripts/publish.mjs` 发布前会 `npm whoami` 预检凭据，未认证即中止。

## 开发与 CI

- **本地门禁**（= CI 闸门）：`npm run build`（`check:manifest → typecheck → test → clean → build:packages`）。- **pre-commit**：`npm run hooks:install` 一次性配置 `core.hooksPath=.githooks`，提交前自动跑 `typecheck + test`。
- **CI**：`.github/workflows/ci.yml`（push / PR 触发，Node 24，`npm ci && npm run build`）。

## 里程碑

- **M1**（完成）：纯内核 + JSON 定义 + fs 事件存储 + `feature` 流 + 工具 + 单测
- **M2**（完成）：`catalog` 资源图 + 引用校验（`configRoot` 入参化）
  - **M2.1**（完成）：引用解析器忠实移植 `catalog-core`；真仓校验 148 引用 / 0 悬空
- **M3**（完成）：`opencode` 插件适配层（注册 `skein_*` 工具）
  - **M3.1**（完成）：MCP stdio server + CLI（validate / list / sim / status）
- **M4**（完成）：schema 版本 + 迁移框架（`migrate`）+ 干跑（`simulate`）
- **M5**（完成）：分包发布元数据（LICENSE / publishConfig）+ 安装器（install / doctor / uninstall）
- **M6**（完成）：内核最小原语 v2 **Phase 1**——`data` 上下文 + per-key reducer、`await` 中断语义、`step.effects[]`、`schema 1→2` 迁移、校验告警分级
  - 场景：`review` 内置流程（`await` 样板）+ `workflow-engineering/tests/flows/{bug,review}.json` + `bug-v2.events.json` 干跑至 `done`

## Phase 2（裁剪项，须有消费方再动）

| 项 | 状态 | 重启条件 |
|----|------|---------|
| 独立 `signal` 事件 / `await.kind:"signal"` | 推迟（校验期 `E_AWAIT_SIGNAL` 硬拦） | 出现内核外注入源（定时器 / webhook / 子代理回调） |
| `next` 对象化 | 裁掉（保留 `next` + 独立 `branch` 字段） | `branch` 表达不了的条件选边 |
| `on.trigger.schedule` | 删除（仅 `manual`） | 先解禁 daemon 前提 |
| 长流程分段续跑（ContinueAsNew 式） | 推迟 | events JSONL 单文件超阈值 |
| 迁移点事件化审计 | 推迟 | 多版本定义并存 |
| `await.schema` 实际校验 / 自定义 reducer 函数 | 推迟 | 出现第三个真实消费方 |

## License

MIT
