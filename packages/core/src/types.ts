// types.ts — openskein 核心类型（纯类型，无运行时）
export type StepKind = "artifact" | "skill" | "agent" | "tool" | "human" | "workflow";

export interface CC {
  type: string;
  [k: string]: unknown;
}

/** 上下文合并策略（per-key reducer）：replace=覆盖（默认）；append=数组拼接；merge=浅合并对象 */
export type ReducerKind = "replace" | "append" | "merge";

/** 上下文键声明：键名 → 合并策略 */
export interface StateSpec {
  [key: string]: { reducer?: ReducerKind };
}

/** 中断等待声明：命中后实例停在当前步等外部输入（由 resume 注入并推进） */
export interface AwaitSpec {
  /** human=人工确认（Phase 1 支持）；signal=外部信号注入（Phase 2，Phase 1 校验期报错） */
  kind: "human" | "signal";
  /** 提问文案（缺省回退 Step.question） */
  question?: string;
  /** 期望答复的形状（适配层可校验；内核仅透传） */
  schema?: Record<string, unknown>;
}

export interface Step {
  id: string;
  kind: StepKind;
  cc: CC;
  next?: string | string[];
  /** 命名分支：label → 目标 stepId | "done" | "canceled"（由 advance 事件的 branch 选定） */
  branch?: Record<string, string>;
  /** 进入/完成该步时额外声明的副作用（数据，不执行；追加在 kind 派生的 Effect 之后） */
  effects?: Effect[];
  /** 中断等待：advance 通过 CC 后不推进，转入 awaiting 等 resume */
  await?: AwaitSpec;
  produces?: string;
  skill?: string;
  agent?: string;
  tool?: string;
  /** kind === "workflow"：被引用工作流 id（复用/嵌套） */
  workflow?: string;
  args?: Record<string, unknown>;
  prompt?: string;
  question?: string;
}

export interface Gate {
  before: string;
  require: CC;
}

/**
 * 定义级约束 = **适配层义务**（不是内核字段，内核不读它）。
 * kind 取值与语义见 `constraints.ts` 的 CONSTRAINT_CONTRACT（SSOT）；新增 kind 必须同时登记契约。
 */
export interface Constraint {
  /** 约束类别：pre/guard/write/timeout/dispatch/effect/fallback（义务）+ note/output/skip（注解） */
  kind: string;
  /** 作用位置：`flow` 或步骤 id */
  target: string;
  /** 义务原文 */
  text: string;
}

export interface Definition {
  schema: number;
  id: string;
  version: string;
  summary?: string;
  params?: Array<{ name: string; required?: boolean }>;
  /** 实例上下文声明（键 → per-key reducer） */
  state?: StateSpec;
  steps: Step[];
  gates?: Gate[];
  /** 适配层义务清单（内核不执行；见 planConstraints） */
  constraints?: Constraint[];
}

export type InstanceStatus = "running" | "awaiting" | "paused" | "done" | "canceled";

export interface State {
  instanceId: string;
  defId: string;
  defVersion: string;
  current: string;
  params: Record<string, string>;
  /** 实例上下文（由 patch + reducer 合并演进） */
  data: Record<string, unknown>;
  status: InstanceStatus;
  at: string;
}

export interface Evidence {
  ok?: boolean;
  [k: string]: unknown;
}

interface EventBase {
  at: string;
  defId?: string;
}

export type WorkflowEvent =
  | ({
      type: "start";
      instanceId: string;
      params?: Record<string, string>;
      /** 初始上下文（可选，按 state 声明的 reducer 合并） */
      data?: Record<string, unknown>;
    } & EventBase)
  | ({ type: "advance"; step: string; evidence?: Evidence; branch?: string; patch?: Record<string, unknown> } & EventBase)
  | ({ type: "pause"; reason?: string } & EventBase)
  | ({ type: "resume"; evidence?: Evidence; patch?: Record<string, unknown>; branch?: string } & EventBase)
  | ({ type: "cancel"; reason: string } & EventBase);

export type Effect =
  | { kind: "load_skill"; name: string }
  | { kind: "spawn_subagent"; role: string; prompt: string }
  | { kind: "call_tool"; name: string; args: Record<string, unknown> }
  | { kind: "write_artifact"; path: string; content: string }
  | { kind: "await_human"; question: string; schema?: Record<string, unknown> }
  | { kind: "launch_workflow"; name: string }
  | { kind: "run_command"; name: string; args?: Record<string, unknown> };

export interface Issue {
  code: string;
  message: string;
  step?: string;
}

/** 待外部输入的中断（只读视图） */
export interface AwaitingView {
  step: string;
  kind: "human" | "signal";
  question?: string;
  schema?: Record<string, unknown>;
}

export interface StatusView {
  instanceId: string;
  step: string;
  next: string[];
  branches: Record<string, string>;
  status: InstanceStatus;
  data: Record<string, unknown>;
  /** 仅 status === "awaiting" 时非空 */
  awaiting: AwaitingView | null;
}
