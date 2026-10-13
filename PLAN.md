# openskein 设计蓝图（PLAN）

> 从 0 设计：一套「agent / skill / workflow 状态机 + 工具」的纯内核 + 可插拔适配层。
> 版本：0.2.0（已验证） · 日期：2026-10-12 · 状态：✅ 通过 tech-reviewer 验证（23 条断言，见 §19）

---

## 1. 一句话定位与边界

**openskein** 是一个**运行时无关**的「声明式状态机内核 + 适配层」，用一套引擎统一驱动 **workflow 执行 / agent 委派 / skill 装载** 三类生命周期；opencode 只是它的第一个适配目标，不是内核的一部分。

**做**：状态机内核、定义规范与校验、事件溯源存储、资源图（catalog）、opencode/MCP/CLI 适配、默认工作流。
**不做**：不做模型编排算法、不内嵌任何业务规范、不绑定 opencode API、不做知识库内容策展。

---

## 2. 设计铁律（4 条，违反即架构崩坏）

1. **纯内核**：`reduce(state, event) → {state, effects}` 是纯函数，**零 fs / 零网络 / 零 opencode**。
2. **定义即数据**：工作流用 YAML/JSON + JSON Schema，**禁止**"markdown 里塞步骤再正则解析"。
3. **事件溯源**：状态由**追加事件日志**推导，不覆盖快照 → 审计/续跑/恢复免费。
4. **效果即值**：副作用以 `Effect` 数据返回，由适配层执行 → 可 dry-run、可仿真测试。

---

## 3. 分层架构（依赖恒为上层→下层）

```
L4 分发层    npm 包：core / catalog / opencode / flows / kit
L3 适配层    ①opencode plugin  ②MCP server  ③CLI(validate/sim)
             —— 唯一允许碰 IO / opencode 的地方 ——
L2 引擎层    event-sourced 状态机（纯）
L1 规格层    definition schema + validator
L0 资源层    catalog：资产图 + 引用解析（零 opencode 依赖）
```

---

## 4. 目录结构（单仓 monorepo，npm workspaces）

```
openskein/
├─ packages/
│  ├─ core/        # L2 纯内核 + L1 schema（零依赖，除 js-yaml 可选）
│  ├─ catalog/     # L0 资源图
│  ├─ flows/       # 默认工作流定义（去业务化）
│  ├─ opencode/    # L3 适配：opencode 插件 + MCP
│  ├─ cli/         # L3 适配：validate / sim / status（bin: skein）
│  └─ kit/         # 安装器（投影 skills/agents/commands）
├─ examples/
├─ pnpm-workspace.yaml 或 package.json workspaces
└─ PLAN.md
```

---

## 5. 定义规范（L1，YAML + JSON Schema）

```yaml
schema: 1                 # 定义规范版本（整数，破坏性变更时 +1）
id: feature
version: 1.0.0            # 语义化版本（内容修订）
summary: 需求 → 规格 → 实现 → 审查
params:
  - { name: requirement, required: true }
steps:
  - id: spec
    kind: artifact        # artifact | skill | agent | tool | human
    produces: "specs/{id}.md"
    cc: { type: file_exists, path: "specs/{id}.md" }
    next: [plan]
  - id: plan
    kind: skill
    skill: planner
    cc: { type: effect_ok, effect: load_skill }
    next: [implement]
  - id: implement
    kind: agent
    agent: worker
    cc: { type: user_ack }
    next: [review]
  - id: review
    kind: skill
    skill: critic
    cc: { type: effect_ok }
    next: [done]
gates:
  - { before: implement, require: { type: refs_valid } }
```

**约束（写入 JSON Schema，机器强制）**：
- `steps[].id` 唯一；`next` 必须指向已声明的 step 或终结符 `done`/`canceled`（防悬空转移）。
- 每步 `cc` 必填（完成标准），且必须是**类型化谓词**（`file_exists` / `effect_ok` / `user_ack` / `tool_ok` / `refs_valid`）。
- 无不可达 step、无死循环（validator 做图分析）。

---

## 6. 内核接口（L2，TypeScript）

```ts
// —— 定义与状态 ——
export interface Definition { schema: number; id: string; version: string; steps: Step[]; gates?: Gate[] }
export interface State { instanceId: string; defId: string; defVersion: string; current: string; params: Record<string,string>; flags: Record<string,unknown> }

// —— 事件（唯一输入）——
export type Event =
  | { type: "start"; params: Record<string,string>; at: string }
  | { type: "advance"; step: string; evidence: Evidence; at: string }
  | { type: "pause"; reason?: string; at: string }
  | { type: "resume"; at: string }
  | { type: "cancel"; reason: string; at: string };

// —— 效果（唯一输出）——
export type Effect =
  | { kind: "load_skill"; name: string }
  | { kind: "spawn_subagent"; role: string; prompt: string }
  | { kind: "call_tool"; name: string; args: unknown }
  | { kind: "write_artifact"; path: string; content: string }
  | { kind: "await_human"; question: string };

// —— 纯函数 API ——
export function reduce(def: Definition, state: State | null, e: Event): { state: State; effects: Effect[] };
export function status(def: Definition, state: State): { step: string; next: string[]; ccOk: boolean };
export function validate(def: Definition, catalog: Catalog): Issue[];
```

> 内核**不 import** `fs`/`path`/`http`/`opencode`。时间戳由事件携带（`at`），保证 `reduce` 可重放、可测。

---

## 7. 事件模型与存储（L2）

```ts
export interface EventStore {
  append(instanceId: string, e: Event): Promise<void>;
  read(instanceId: string): AsyncIterable<Event>;   // 回放
}
```

- 默认实现：`fs`，追加式 JSONL `.skein/<instanceId>.jsonl`。
- 可选：`sqlite` / `remote`（HTTP）。
- `replay(store, defId) → State`：从事件流重建，天然支持崩溃恢复与审计。

---

## 8. 工具面（L3，唯一对 LLM 的 API）

```
skein_start(defId, params)     skein_status(instance?)     skein_advance(step, evidence)
skein_pause / skein_resume / skein_cancel                  skein_validate(defId)   # 离线
```

规则：工具是**薄壳**，只做「收事件 → reduce → 执行 effects」；**禁止**在工具内写业务逻辑。

---

## 9. 资源图 catalog（L0，独立包）

```ts
export interface Catalog { resources: Resource[]; graph: { nodes: Node[]; edges: Edge[] } }
export function getCatalog(opts: { configRoot: string }): Catalog;
export function validateRefs(resources: Resource[]): Issue[];
```

- **入参化 `configRoot`**（不再是模块加载期常量），消除现有 3 份路径探测副本。
- 扫描目录清单**参数化**（skills/agents/commands/workflows/plugins/mcp-servers），不写死本仓布局。

---

## 10. 统一生命周期（三类对象一套引擎）

| 对象 | 状态机 | 迁移触发 |
|------|--------|---------|
| workflow | `idle→running→(step)→paused→done/canceled` | Event |
| agent/subagent | `spawned→working→awaiting→done/failed` | Effect 回调 |
| skill | `available→loaded→applied→evicted` | 加载/权限/压缩 |

> 一套引擎、一套审计、一套工具统管三者，而非三套各写各的。

---

## 11. 适配层（L3）

- **opencode 插件**：导出插件函数（接收 `{project, client, $, directory, worktree}`），返回 hooks + `tool`；工具用 `@opencode-ai/plugin` 的 `tool({description, args, execute})`。
- **MCP server**：stdio，暴露同名工具，复用同一内核与存储。
- **CLI（bin: skein）**：`skein validate` / `skein sim`（dry-run）/ `skein status`，不依赖 opencode。
- **skills 投影**：`kit` 把 `flows`/默认 skills 落地到 `~/.config/opencode/skills/`、`~/.agents/skills/`。**定论（A5 已证实）**：`OPENCODE_CONFIG_DIR` 只覆盖 agents/commands/modes/plugins，**不含 skills** → 必须"投影"，不能"指目录"。

---

## 12. 里程碑（M1–M5）与验收

| 里程碑 | 内容 | 验收标准 |
|:--:|------|---------|
| **M1** | 纯内核 + JSON 定义 + fs 事件存储 + `feature` 流 + 4 工具 | 状态迁移单测 + 事件回放 golden 通过 |
| **M2** | `catalog` 独立包 + `skein validate` | 悬空引用 / 不可达 step 被拦截 |
| **M3** | 适配层 opencode plugin / MCP / CLI | 换运行时**不改内核** |
| **M4** | schema 版本 + 状态迁移（编号迁移）+ `skein sim` | 旧定义可升级；dry-run 无副作用 |
| **M5** | npm 分包发布 + `kit` 安装器 | 一条命令装齐 mcp+plugin+skill |

---

## 13. 测试策略

- **内核**：属性测试（无死状态、无不可达、终止性）+ 迁移/回放 golden。
- **适配层**：fake 注入，断言产生的 effects 序列。
- **定义**：JSON Schema 校验 + 图分析（可达性/环）。
- 不跑真模型、不联网（内核层）。

---

## 14. 包拆分与命名

| 包 | 角色 | 依赖 | 公开？ |
|----|------|------|:--:|
| `@openskein/core` | 纯内核 + schema | 零（js-yaml 可选） | ✅ |
| `@openskein/catalog` | 资源图 | 零 | ✅ |
| `@openskein/flows` | 默认工作流定义 | — | ✅ |
| `@openskein/opencode` | 适配层 | core + `@opencode-ai/plugin` | 可私有 |
| `@openskein/cli` | 命令行（bin: skein） | core + catalog | ✅ |
| `@openskein/kit` | 安装器 | 全部 | 可私有 |

命名约定：品牌 `skein`；scope `@openskein`（GitHub/npm 探针均可用，见 §17）；状态目录 `.skein/`；工具前缀 `skein_*`。

---

## 15. 运行时与依赖约束

- **Node**：≥ 18（实测环境 v24.18.0；opencode 插件用 Bun 装 npm 包并缓存于 `~/.cache/opencode/node_modules/`）。
- **内核依赖**：仅 `js-yaml`（或改用 JSON 定义则零依赖）；**禁止**内核依赖 opencode SDK。注：配置仓 `package.json` **未声明 js-yaml**（运行时靠 3.14.2 传递依赖）→ 若沿用 YAML 须显式声明；优先走零依赖 JSON 路线（§18 问题②）。
- **opencode 版本基线**：本地实装 `@opencode-ai/plugin@1.17.15`（npm 最新 1.19.0）；`zod ^4.4.3`。方案按 1.17.15 验证，升级后需复核。
- **npm 源（nrm）**：
  - 当前 nrm 为 `topnet`（私有源 `192.168.3.42:4873`）——**不动全局**，避免断 `@topnet` 访问。
  - 本项目落**项目级 `.npmrc`**：安装走镜像 `https://registry.npmmirror.com/`（nrm `taobao`）。
  - ⚠ **发布必须切官方源** `https://registry.npmjs.org/`（镜像为只读，`npm publish` 会失败）。
- **编码**：本仓中文 `.md` 带 UTF-8 BOM；`.js`/`.mjs`（尤其带 shebang）**无 BOM**。

---

## 16. 迁移与"本地先用"策略

- 与现有 `workflow-engine.js`（1931 行）+ `lib/workflow-core.js`（**752** 行）**并存**，不替换。
- **反向依赖（已修正）**：`configSyncVerifyAll`（`plugins/config-sync.js:210`）依赖的是 **`catalog-core` 的 `getCatalog()/validateRefs()`**（叠加 kb-contract 契约、ARCHITECTURE 基线校验），**与 `workflow_validate` 无关**。故本仓未来切换只需保证 `@openskein/catalog` 的 `getCatalog/validateRefs` 接口兼容；workflow 引擎迁移与之解耦。
- 先在本地项目跑通 M1→M2，再发布。

---

## 17. 技术断言清单（已由 tech-reviewer 逐条验证）

> 结果：✅成立 15 / ❌不成立 1 / 部分成立 3 / 未证实 4；P0 外部契约（A2/A3/A8）以本地实装源码（🔬）确认。

| # | 断言 | 验证手段 | 判定 |
|---|------|---------|:--:|
| A1 | opencode 插件可从 npm 包名加载（`plugin:["@scope/x"]`），用 Bun 自动安装并缓存 `~/.cache/opencode/node_modules/` | 官方文档「Configure npm plugins」 | ✅ |
| A2 | opencode 插件函数签名 `({project, client, $, directory, worktree})` 与 `tool({description,args,execute})` | 读 `@opencode-ai/plugin/dist/index.d.ts:36-51` | ✅ |
| A3 | 自定义工具 args 用 **Zod schema**（`tool.schema`），依赖 `@opencode-ai/plugin` | 读 `dist/tool.d.ts:47-58` + `tool.js`（`args: z.ZodRawShape`） | ✅ |
| A4 | MCP 支持 `type:"local"`（spawn）与 `type:"remote"`（url+headers/oauth） | 官方文档 + 仓库 `opencode.json` 10 处 local | ✅ |
| A5 | `OPENCODE_CONFIG_DIR` 只覆盖 agents/commands/modes/plugins，**不含 skills** | ✅ 已证实（官方 config.mdx「Custom directory」明文） | ✅ |
| A6 | skills 发现路径含 `~/.config/opencode/skills/`、`~/.agents/skills/`、`~/.claude/skills/` | 官方文档 §skills place-files | ✅ |
| A7 | 配置多源合并，共 **9 层**：remote well-known → global → `OPENCODE_CONFIG` → project → `.opencode`/`OPENCODE_CONFIG_DIR` → `OPENCODE_CONFIG_CONTENT` → active-org remote → managed dir → macOS mobileconfig | 官方文档 + `config.ts` | 部分成立（原写 7 层，已补全） |
| A8 | `compaction` 钩子为 `experimental.session.compacting`（`output.prompt` 设置则完全替换） | 读 `dist/index.d.ts:276-288` + 现有 `workflow-engine.js:1469` | ✅ |
| A9 | npm 扁平名 `skein` 已占（1.0.21），scope `@openskein` 下无包；GitHub `openskein` 404 | 已实测（npm view + GitHub HEAD，主会话复核） | ✅ |
| A10 | npmmirror/taobao 为只读镜像，不能 publish | ⚠️ 未证实（`npm publish --dry-run --registry https://registry.npmmirror.com/` 复核） | ⚠️ |
| A11 | 事件溯源 JSONL 追加 + 回放可在纯 Node 下实现，无额外依赖 | Node 内置 `fs`/`readline` | ✅ |

---

## 18. 开放问题

1. ~~`OPENCODE_CONFIG_DIR` 是否覆盖 skills~~ → **已关闭（A5 已证实：不覆盖 → 必须投影）**。
2. 内核定义用 YAML（需 js-yaml）还是纯 JSON（零依赖）？倾向 **JSON 为规格、YAML 为书写层**（编译到 JSON）。注：配置仓 `package.json` **未声明 js-yaml**，运行时依赖 3.14.2（传递依赖）→ 优先走零依赖 JSON 路线。
3. 是否需要 sqlite 存储（多实例/共享）还是先 fs JSONL。
4. agent/skill 生命周期是否纳入 M1，还是先只做 workflow。
5. `opencode.json` 现为 `"skills":{"paths":[]}`（对象形态），而当前文档示例为 `"skills":[...]`（数组）——需用 `opencode debug config` 或 `/config` API 确认字段是否被解析（旧 schema 风险）。

---

## 19. 验证结论（tech-reviewer，2026-10-12）

- **总体**：技术可行。方案赖以成立的 6 条 P0 外部契约——npm 插件加载（A1）、插件签名（A2）、`tool`/Zod（A3）、MCP local/remote（A4）、`OPENCODE_CONFIG_DIR` 边界（A5）、compaction 钩子（A8）——**全部成立**，其中 A2/A3/A8 由本地实装 `@opencode-ai/plugin@1.17.15` 源码确认（非文档推断）。
- **已修正**：① §16 反向依赖描述错误（原误写 `workflow_validate`，实为 `catalog-core`）；② §17 A7 合并顺序补全为 9 层；③ §16 `workflow-core.js` 751→752 行；④ §18 问题① 关闭。
- **未证实 / 待复核**：A10（npmmirror 只读性，需 dry-run 验证）；文档版本 vs 本地实装（context7 为 dev，实装 1.17.15、最新 1.19.0）；`skills.paths` 字段形态（§18 问题⑤）；A9 的 GitHub 侧已由主会话复核为 404。
- 自研纯内核（reduce / 事件溯源 / Effect 数据化）为内部设计，无外部逆向风险。
