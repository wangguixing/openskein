// machine.ts — openskein 纯内核（零依赖 / 零 IO）
// 唯一输入：Definition + State + Event；唯一输出：{ state, effects }
// 时间戳由事件携带（at），保证 reduce 可重放、可测试。
import type {
  AwaitSpec,
  Definition,
  Effect,
  Evidence,
  ReducerKind,
  State,
  StatusView,
  Step,
  WorkflowEvent,
} from "./types.ts";

export const TERMINALS: readonly string[] = Object.freeze(["done", "canceled"]);

function isTerminal(id: string): boolean {
  return TERMINALS.includes(id);
}

/** 步骤 id → step 定义 */
export function findStep(def: Definition, id: string): Step | undefined {
  return def.steps.find((s) => s.id === id);
}

/** 把 {param} 占位符替换为实例参数 */
function fill(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    ctx[k] != null ? String(ctx[k]) : `{${k}}`,
  );
}

/** 步骤 → 副作用（数据，不执行）；step.effects 追加在 kind 派生 Effect 之后 */
export function effectsFor(step: Step, ctx: Record<string, unknown>): Effect[] {
  const declared = step.effects ?? [];
  switch (step.kind) {
    case "skill":
      return [{ kind: "load_skill", name: step.skill ?? "" }, ...declared];
    case "agent":
      return [
        { kind: "spawn_subagent", role: step.agent ?? "", prompt: step.prompt ?? `执行步骤 ${step.id}` },
        ...declared,
      ];
    case "workflow":
      return [{ kind: "launch_workflow", name: step.workflow ?? "" }, ...declared];
    case "tool":
      // args.command 存在时视为快捷命令调用（Command，非 Skill/工具），产出 run_command
      return step.args?.command !== undefined
        ? [{ kind: "run_command", name: String(step.args.command), args: step.args }, ...declared]
        : [{ kind: "call_tool", name: step.tool ?? "", args: step.args ?? {} }, ...declared];
    case "human": {
      const wait = humanAwait(step);
      const effect: Effect = wait
        ? {
            kind: "await_human",
            question: wait.question ?? step.question ?? "请确认",
            ...(wait.schema ? { schema: wait.schema } : {}),
          }
        : { kind: "await_human", question: step.question ?? "请确认" };
      return [effect, ...declared];
    }
    case "artifact":
      return [{ kind: "write_artifact", path: fill(step.produces ?? "", ctx), content: "" }, ...declared];
    default:
      return [...declared];
  }
}

/** 完成标准（CC）纯判定：适配层负责把 IO 型证据折算为 evidence.ok */
export function checkCC(step: Step, evidence?: Evidence): boolean {
  if (!step.cc) throw new Error(`步骤 ${step.id} 缺少完成标准 cc`);
  return Boolean(evidence && evidence.ok === true);
}

/**
 * 取"人工中断"声明：仅 await.kind === "human" 构成 Phase 1 的停步等待。
 * kind === "signal" 是 Phase 2 原语，Phase 1 不构成等待（由 validate 的 E_AWAIT_SIGNAL 拦截），
 * 以免留下无法被 resume 满足的死分支。
 */
function humanAwait(step: Step): AwaitSpec | null {
  const wait = step.await;
  return wait && wait.kind === "human" ? wait : null;
}

/** 命中断步等待时的 Effect 列表（不推进） */
function awaitingEffects(step: Step, wait: AwaitSpec, ctx: Record<string, unknown>): Effect[] {
  const question = wait.question ?? step.question ?? "请确认";
  return [
    { kind: "await_human", question, ...(wait.schema ? { schema: wait.schema } : {}) },
    ...(step.effects ?? []),
  ];
}

/**
 * per-key reducer 合并（纯函数，不可变）：
 * - replace（默认）：覆盖（含 null）；值为 undefined 时删除该键
 * - append：双方皆数组时拼接；**空数组不清空**（不覆盖旧值）
 * - merge：双方皆为普通对象时浅合并；值为 null/非对象时跳过（不误清空）
 */
export function applyPatch(
  data: Record<string, unknown>,
  patch: Record<string, unknown> | undefined,
  spec: Definition["state"],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data };
  if (!patch) return next;
  for (const [key, value] of Object.entries(patch)) {
    const reducer: ReducerKind = spec?.[key]?.reducer ?? "replace";
    const prev = next[key];
    switch (reducer) {
      case "append": {
        // 空数组不清空（保持原引用，保证纯内核可重放的引用稳定）
        if (Array.isArray(value) && value.length === 0 && Array.isArray(prev)) break;
        next[key] = Array.isArray(prev) && Array.isArray(value) ? prev.concat(value) : value;
        break;
      }
      case "merge": {
        if (isPlainObject(prev) && isPlainObject(value)) next[key] = { ...prev, ...value };
        else if (isPlainObject(value)) next[key] = { ...value };
        break;
      }
      default: {
        if (value === undefined) delete next[key];
        else next[key] = value;
        break;
      }
    }
  }
  return next;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 由当前步的出边计算后继（branch 优先于 next） */
function resolveNext(step: Step, branch?: string): string {
  let nextId: string | undefined;
  if (branch !== undefined) {
    nextId = step.branch?.[branch];
    if (!nextId) throw new Error(`步骤 ${step.id} 无分支 "${branch}"（E_BRANCH）`);
  } else {
    nextId = Array.isArray(step.next) ? step.next[0] : step.next;
  }
  if (!nextId) throw new Error(`步骤 ${step.id} 无后继`);
  return nextId;
}

function onStart(
  def: Definition,
  state: State | null,
  event: Extract<WorkflowEvent, { type: "start" }>,
): { state: State; effects: Effect[] } {
  if (state) throw new Error("实例已存在，不能重复 start");
  const first = def.steps[0];
  if (!first) throw new Error("定义缺少步骤");
  const next: State = {
    instanceId: event.instanceId,
    defId: def.id,
    defVersion: def.version,
    current: first.id,
    params: event.params ?? {},
    data: applyPatch({}, event.data, def.state),
    status: "running",
    at: event.at,
  };
  return { state: next, effects: effectsFor(first, { ...next.params, instanceId: next.instanceId }) };
}

function onAdvance(
  def: Definition,
  state: State | null,
  event: Extract<WorkflowEvent, { type: "advance" }>,
): { state: State; effects: Effect[] } {
  if (!state) throw new Error("实例不存在，不能 advance");
  if (state.status !== "running") throw new Error(`当前状态 ${state.status} 不可 advance`);
  if (event.step !== state.current)
    throw new Error(`advance 步骤不匹配：期望 ${state.current}，收到 ${event.step}`);
  const step = findStep(def, state.current);
  if (!step) throw new Error(`未找到步骤 ${state.current}`);
  if (!checkCC(step, event.evidence)) throw new Error(`步骤 ${step.id} 完成标准未满足`);
  const data = applyPatch(state.data, event.patch, def.state);
  const ctx = { ...state.params, instanceId: state.instanceId };
  // 中断：CC 通过但停在当前步等外部输入（不推进）
  const wait = humanAwait(step);
  if (wait) {
    return {
      state: { ...state, data, status: "awaiting", at: event.at },
      effects: awaitingEffects(step, wait, ctx),
    };
  }
  return advanceTo(def, state, step, data, event.at, event.branch, ctx);
}

/** 推进到后继步骤（advance 直进 / resume 恢复皆复用） */
function advanceTo(
  def: Definition,
  state: State,
  step: Step,
  data: Record<string, unknown>,
  at: string,
  branch: string | undefined,
  ctx: Record<string, unknown>,
): { state: State; effects: Effect[] } {
  const nextId = resolveNext(step, branch);
  if (!def.steps.some((s) => s.id === nextId) && !isTerminal(nextId))
    throw new Error(`步骤 ${step.id} 的后继 "${nextId}" 不存在（E_DANGLING）`);
  const nextState: State = {
    ...state,
    current: nextId,
    data,
    status: isTerminal(nextId) ? (nextId as State["status"]) : "running",
    at,
  };
  const nextStep = findStep(def, nextId);
  return { state: nextState, effects: nextStep ? effectsFor(nextStep, ctx) : [] };
}

function onPause(
  state: State | null,
  event: Extract<WorkflowEvent, { type: "pause" }>,
): { state: State; effects: Effect[] } {
  if (!state) throw new Error("实例不存在");
  if (state.status !== "running" && state.status !== "awaiting")
    throw new Error(`当前状态 ${state.status} 不可 pause`);
  return { state: { ...state, status: "paused", at: event.at }, effects: [] };
}

/**
 * resume 两种语义（按 status 分流，二者不互通）：
 * - paused（v1 原语义，保持不变）→ 仅回到 running，不推进
 * - awaiting → 注入人工答复（evidence 判 CC + patch 合并入 data）并推进到后继
 */
function onResume(
  def: Definition,
  state: State | null,
  event: Extract<WorkflowEvent, { type: "resume" }>,
): { state: State; effects: Effect[] } {
  if (!state) throw new Error("实例不存在");
  if (state.status === "paused")
    return { state: { ...state, status: "running", at: event.at }, effects: [] };
  if (state.status !== "awaiting") throw new Error(`当前状态 ${state.status} 不可 resume`);
  const step = findStep(def, state.current);
  if (!step) throw new Error(`未找到步骤 ${state.current}`);
  const wait = humanAwait(step);
  if (!wait) throw new Error(`步骤 ${step.id} 未声明 await，不可由 resume 推进`);
  if (!checkCC(step, event.evidence)) throw new Error(`步骤 ${step.id} 完成标准未满足`);
  const data = applyPatch(state.data, event.patch, def.state);
  const ctx = { ...state.params, instanceId: state.instanceId };
  return advanceTo(def, state, step, data, event.at, event.branch, ctx);
}

function onCancel(
  state: State | null,
  event: Extract<WorkflowEvent, { type: "cancel" }>,
): { state: State; effects: Effect[] } {
  if (!state) throw new Error("实例不存在");
  if (isTerminal(state.status)) throw new Error("已终结，不可 cancel");
  return { state: { ...state, status: "canceled", at: event.at }, effects: [] };
}

/** 纯归约：唯一入口 */
export function reduce(
  def: Definition,
  state: State | null,
  event: WorkflowEvent,
): { state: State; effects: Effect[] } {
  switch (event.type) {
    case "start":
      return onStart(def, state, event);
    case "advance":
      return onAdvance(def, state, event);
    case "pause":
      return onPause(state, event);
    case "resume":
      return onResume(def, state, event);
    case "cancel":
      return onCancel(state, event);
    default: {
      const never: never = event;
      throw new Error(`未知事件类型: ${JSON.stringify(never)}`);
    }
  }
}

/** 只读视图 */
export function status(def: Definition, state: State): StatusView {
  const step = findStep(def, state.current);
  const wait = step?.await;
  return {
    instanceId: state.instanceId,
    step: state.current,
    next: step?.next ? (Array.isArray(step.next) ? step.next : [step.next]) : [],
    branches: step?.branch ?? {},
    status: state.status,
    data: state.data ?? {},
    awaiting:
      state.status === "awaiting" && wait
        ? {
            step: state.current,
            kind: wait.kind,
            ...(wait.question ?? step?.question ? { question: wait.question ?? step?.question } : {}),
            ...(wait.schema ? { schema: wait.schema } : {}),
          }
        : null,
  };
}
