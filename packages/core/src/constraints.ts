// constraints.ts — 定义级约束（constraints）的契约与适配层义务计划
// 背景：v1 的 R6 语义（checkpoint/brief/hooks/timeout/allowWrite/派发）已被否决，改为「原语组合 + 定义级约束」。
//       `constraints` 记录**适配层义务**——但"已声明未落地"等于没约束，故本模块把义务脚本化：
//       ① 契约：哪些 kind 是「约束性义务」（适配层必须处理，漏处理可被检出），哪些只是注解
//       ② 计划：按触发时机（phase）把义务分组，适配层照此调度
//       ③ 覆盖：用适配层声明的能力集核对，暴露"无人执行的义务"（杜绝静默漏处理）
import type { Definition } from "./types.ts";

/** 注解类：不要求适配层动作（LLM/人类阅读用，或纯声明） */
export const ANNOTATION_CONSTRAINT_KINDS: readonly string[] = ["note", "output", "skip"];

/** 适配制服的触发时机（适配层按这些钩子调度义务） */
export const CONSTRAINT_PHASES: readonly string[] = [
  "before-start", // start 事件之前
  "on-step-enter", // 进入某步时
  "during-step", // 步执行期间（派发/写入/调用）
  "before-advance", // advance/resume 之前（验证闸）
  "on-complete", // 实例到达 done/canceled
  "on-failure", // 任一义务失败/降级触发
  "reactive", // 由适配层自行决定时机（如 gitleaks 扫描）
];

export interface ConstraintContract {
  /** 约束性义务（适配层必须处理） */
  enforceable: readonly string[];
  /** 注解类（不要求适配层动作） */
  annotation: readonly string[];
  /** kind → 触发时机 */
  phase: Readonly<Record<string, string>>;
  /** kind → 失败是否阻断推进 */
  blocking: Readonly<Record<string, boolean>>;
  /** kind → 适配层需具备的能力标签 */
  capability: Readonly<Record<string, string>>;
}

/** 约束契约的 SSOT：新增 kind 必须同时登记契约（否则被 E_CONSTRAINT_KIND 拦下） */
export const CONSTRAINT_CONTRACT: ConstraintContract = Object.freeze({
  enforceable: Object.freeze(["pre", "guard", "write", "timeout", "dispatch", "effect", "fallback"]),
  annotation: Object.freeze([...ANNOTATION_CONSTRAINT_KINDS]),
  phase: Object.freeze({
    pre: "before-start",
    guard: "before-advance",
    write: "during-step",
    timeout: "during-step",
    dispatch: "during-step",
    effect: "reactive",
    fallback: "on-failure",
    note: "reactive",
    output: "on-complete",
    skip: "reactive",
  }),
  blocking: Object.freeze({
    pre: true,
    guard: true,
    write: true,
    timeout: true,
    dispatch: false,
    effect: false,
    fallback: false,
    note: false,
    output: false,
    skip: false,
  }),
  capability: Object.freeze({
    pre: "env-check",
    guard: "step-gate",
    write: "fs-scope",
    timeout: "timer",
    dispatch: "subagent-dispatch",
    effect: "tool-invoke",
    fallback: "degrade-log",
    note: "none",
    output: "none",
    skip: "none",
  }),
});

export function constraintKinds(): string[] {
  return [...CONSTRAINT_CONTRACT.enforceable, ...CONSTRAINT_CONTRACT.annotation];
}

export function isEnforceableKind(kind: string): boolean {
  return CONSTRAINT_CONTRACT.enforceable.includes(kind);
}

/** 一条待执行的义务（适配层消费） */
export interface Obligation {
  /** 定义 id */
  defId: string;
  /** 约束类别 */
  kind: string;
  /** 作用位置：flow 或 stepId */
  target: string;
  /** 义务原文（供执行/上报） */
  text: string;
  /** 触发时机 */
  phase: string;
  /** 失败是否阻断 */
  blocking: boolean;
  /** 所需能力标签 */
  capability: string;
  /** 是否已被适配层声明的能力覆盖 */
  covered: boolean;
}

export interface ConstraintPlan {
  defId: string;
  /** 全部义务（含注解类，便于审计） */
  obligations: Obligation[];
  /** 约束性义务条数 */
  enforceableCount: number;
  /** 注解类条数 */
  annotationCount: number;
  /** 无适配层能力覆盖的约束性义务（应被适配层视为缺口） */
  uncovered: Obligation[];
  /** 按触发时机分组 */
  byPhase: Record<string, Obligation[]>;
}

export interface PlanOptions {
  /** 适配层声明的能力集；缺省 = 无能力（全部约束性义务都算未覆盖） */
  capabilities?: readonly string[];
}

/** 把定义中的 constraints 编译为适配层义务计划 */
export function planConstraints(def: Definition, options: PlanOptions = {}): ConstraintPlan {
  const declared = new Set(options.capabilities ?? []);
  const all = (def.constraints ?? []) as ReadonlyArray<{ kind: string; target?: string; text: string }>;
  const obligations: Obligation[] = all.map((c) => {
    const kind = String(c.kind);
    const enforceable = isEnforceableKind(kind);
    const capability = CONSTRAINT_CONTRACT.capability[kind] ?? "none";
    return {
      defId: def.id,
      kind,
      target: c.target ?? "flow",
      text: c.text,
      phase: CONSTRAINT_CONTRACT.phase[kind] ?? "reactive",
      blocking: CONSTRAINT_CONTRACT.blocking[kind] ?? false,
      capability,
      // 注解类无需能力覆盖；约束性义务要求适配层声明对应能力
      covered: !enforceable || capability === "none" || declared.has(capability),
    };
  });

  const byPhase: Record<string, Obligation[]> = {};
  for (const o of obligations) (byPhase[o.phase] ??= []).push(o);

  const enforceableObligations = obligations.filter((o) => isEnforceableKind(o.kind));
  return {
    defId: def.id,
    obligations,
    enforceableCount: enforceableObligations.length,
    annotationCount: obligations.length - enforceableObligations.length,
    uncovered: enforceableObligations.filter((o) => !o.covered),
    byPhase,
  };
}

/** 契约自检：契约表本身的完整性（kind 三张表须一致覆盖） */
export function checkContract(): string[] {
  const problems: string[] = [];
  const c = CONSTRAINT_CONTRACT;
  const all = [...c.enforceable, ...c.annotation];
  const dup = all.filter((k, i) => all.indexOf(k) !== i);
  if (dup.length) problems.push(`契约 kind 重复：${[...new Set(dup)].join(", ")}`);
  for (const k of all) {
    if (!c.phase[k]) problems.push(`契约缺少 phase：${k}`);
    if (c.blocking[k] === undefined) problems.push(`契约缺少 blocking：${k}`);
    if (!c.capability[k]) problems.push(`契约缺少 capability：${k}`);
  }
  for (const k of Object.keys(c.phase)) if (!all.includes(k)) problems.push(`phase 表含未登记 kind：${k}`);
  for (const k of Object.keys(c.blocking)) if (!all.includes(k)) problems.push(`blocking 表含未登记 kind：${k}`);
  for (const k of Object.keys(c.capability)) if (!all.includes(k)) problems.push(`capability 表含未登记 kind：${k}`);
  return problems;
}
