// validate.ts — 定义静态校验（纯函数）：唯一 id / 悬空出边 / 可达性 / 环 / cc 存在性 / workflow 字段 / v2 原语
// 出边 = next ∪ branch 值（分支边一并纳入悬空/可达/环分析）
import { TERMINALS } from "./machine.ts";
import { SUPPORTED_SCHEMAS } from "./schema.ts";
import { constraintKinds, isEnforceableKind } from "./constraints.ts";
import type { Definition, Issue, Step } from "./types.ts";

const REDUCERS: readonly string[] = ["replace", "append", "merge"];
const AWAIT_KINDS: readonly string[] = ["human", "signal"];
const EFFECT_KINDS: readonly string[] = [
  "load_skill",
  "spawn_subagent",
  "call_tool",
  "write_artifact",
  "await_human",
  "launch_workflow",
  "run_command",
];

function nextsOf(step: Step): string[] {
  if (Array.isArray(step.next)) return step.next;
  return step.next ? [step.next] : [];
}

/** 全部出边：next ∪ branch（label → target） */
function outgoingOf(step: Step): string[] {
  const out = nextsOf(step);
  if (step.branch) out.push(...Object.values(step.branch));
  return out;
}

/** state 与 constraints 的结构校验（在 steps 存在性之前调用，避免被提前 return 掩盖） */
function validateStateAndConstraints(def: Definition, push: (code: string, message: string, step?: string) => void): void {
  // 上下文声明：每个键的 reducer 必须在白名单内
  if (def.state !== undefined) {
    if (typeof def.state !== "object" || def.state === null) push("E_STATE", "state 必须为对象");
    else
      for (const [key, spec] of Object.entries(def.state)) {
        const r = (spec as { reducer?: unknown } | null)?.reducer;
        if (r !== undefined && (typeof r !== "string" || !REDUCERS.includes(r)))
          push("E_STATE_REDUCER", `state["${key}"].reducer 非法：${String(r)}（应为 ${REDUCERS.join(" | ")}）`);
      }
  }

  // 定义级约束（适配层义务）：kind 必须已登记契约，target 必须存在，text 非空
  if (def.constraints !== undefined) {
    if (!Array.isArray(def.constraints)) {
      push("E_CONSTRAINTS", "constraints 必须为数组");
      return;
    }
    const stepIds = new Set((Array.isArray(def.steps) ? def.steps : []).filter((s) => s?.id).map((s) => s.id));
    const kinds = constraintKinds();
    for (const [i, c] of def.constraints.entries()) {
      const kind = (c as { kind?: unknown } | null)?.kind;
      if (typeof kind !== "string" || !kinds.includes(kind))
        push("E_CONSTRAINT_KIND", `constraints[${i}].kind 非法：${String(kind)}（应为 ${kinds.join(" | ")}）`);
      const target = (c as { target?: unknown } | null)?.target;
      if (typeof target !== "string" || target.length === 0)
        push("E_CONSTRAINT_TARGET", `constraints[${i}] 缺少 target（应为 flow 或步骤 id）`);
      else if (target !== "flow" && !stepIds.has(target))
        push("E_CONSTRAINT_TARGET", `constraints[${i}].target「${target}」不是 flow 也不存在的步骤 id`);
      const text = (c as { text?: unknown } | null)?.text;
      if (typeof text !== "string" || text.trim().length === 0)
        push("E_CONSTRAINT_TEXT", `constraints[${i}] 缺少 text（义务原文）`);
    }
  }
}

export function validate(def: Definition): Issue[] {
  const issues: Issue[] = [];
  const push = (code: string, message: string, step?: string): void => {
    issues.push({ code, message, step });
  };

  if (!def || typeof def !== "object") {
    push("E_DEF", "定义为空");
    return issues;
  }
  if (!SUPPORTED_SCHEMAS.includes(def.schema))
    push("E_SCHEMA", `schema 必须为 ${SUPPORTED_SCHEMAS.join(" | ")}，实际 ${def.schema}`);
  else if (def.schema !== SUPPORTED_SCHEMAS[SUPPORTED_SCHEMAS.length - 1])
    push("W_SCHEMA_OLD", `schema ${def.schema} 为旧版本，加载时会自动迁移`);
  if (!def.id) push("E_ID", "缺少 id");
  // 定义级元数据校验（state/constraints）在 steps 存在性之前完成——
  // 否则「steps 缺失」会提前 return，掩盖这两类结构性错误。
  validateStateAndConstraints(def, push);
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    push("E_STEPS", "缺少 steps");
    return issues;
  }

  // 上下文声明与定义级约束已在 validateStateAndConstraints 中校验

  const ids = new Set<string>();
  for (const s of def.steps) {
    if (!s.id) {
      push("E_STEP_ID", "步骤缺少 id");
      continue;
    }
    if (ids.has(s.id)) push("E_DUP", `重复步骤 id: ${s.id}`, s.id);
    ids.add(s.id);
    if (!s.cc) push("E_CC", `步骤 ${s.id} 缺少完成标准 cc`, s.id);
    if (s.kind === "workflow" && !s.workflow)
      push("E_WORKFLOW", `步骤 ${s.id} 为 workflow 类型但缺少 workflow 字段`, s.id);
    if (s.await !== undefined) {
      const kind = (s.await as { kind?: unknown } | null)?.kind;
      if (typeof kind !== "string" || !AWAIT_KINDS.includes(kind))
        push("E_AWAIT_KIND", `步骤 ${s.id} 的 await.kind 非法：${String(kind)}（应为 ${AWAIT_KINDS.join(" | ")}）`, s.id);
      else if (kind === "signal")
        push("E_AWAIT_SIGNAL", `步骤 ${s.id} 的 await.kind "signal" 在 Phase 1 不支持（Phase 2）`, s.id);
    }
    if (s.effects !== undefined) {
      if (!Array.isArray(s.effects)) push("E_EFFECTS", `步骤 ${s.id} 的 effects 必须为数组`, s.id);
      else
        for (const [i, e] of s.effects.entries()) {
          const kind = (e as { kind?: unknown } | null)?.kind;
          if (typeof kind !== "string" || !EFFECT_KINDS.includes(kind))
            push("E_EFFECT_KIND", `步骤 ${s.id} 的 effects[${i}].kind 非法：${String(kind)}`, s.id);
        }
    }
  }

  for (const s of def.steps) {
    const outs = outgoingOf(s);
    if (outs.length === 0) push("E_NEXT", `步骤 ${s.id} 无出边（next 与 branch 皆空）`, s.id);
    for (const n of outs) {
      if (!ids.has(n) && !TERMINALS.includes(n))
        push("E_DANGLING", `步骤 ${s.id} 的出边「${n}」不存在且非终结符`, s.id);
    }
  }

  // 可达性（从首个步骤 BFS，含 branch 边）
  const first = def.steps[0]!.id;
  const seen = new Set<string>();
  const queue: string[] = [first];
  while (queue.length) {
    const cur = queue.shift() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const step = def.steps.find((s) => s.id === cur);
    if (!step) continue;
    for (const n of outgoingOf(step)) if (ids.has(n)) queue.push(n);
  }
  for (const s of def.steps) if (!seen.has(s.id)) push("E_UNREACHABLE", `步骤 ${s.id} 从起点不可达`, s.id);

  // 环检测（DFS 三色，含 branch 边）：返工/迭代回环是合法原语用法（对齐业界默认允许成环），
  // 故报告为告警 W_CYCLE 而非错误；真正的"死循环风险"由运行时/适配层步数上限兜底。
  const color = new Map<string, 0 | 1 | 2>();
  const dfs = (id: string): void => {
    color.set(id, 1);
    const step = def.steps.find((s) => s.id === id);
    for (const n of step ? outgoingOf(step) : []) {
      if (!ids.has(n)) continue;
      if (color.get(n) === 1) push("W_CYCLE", `检测到回环：${id} → ${n}`, id);
      else if (!color.get(n)) dfs(n);
    }
    color.set(id, 2);
  };
  for (const s of def.steps) if (!color.get(s.id)) dfs(s.id);

  return issues;
}
