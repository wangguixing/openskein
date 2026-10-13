// toolspec.ts — 运行时无关的工具描述（各适配层映射到自身工具面）
import type { Tools } from "./tools.ts";

export interface ArgSpec {
  type: "string";
  required?: boolean;
  description?: string;
}

export interface ToolSpec {
  description: string;
  args: Record<string, ArgSpec>;
  execute: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

function parseJson(v: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof v !== "string" || v.trim() === "") return fallback;
  return JSON.parse(v) as Record<string, unknown>;
}

/** 把内核工具包装成运行时无关的 ToolSpec */
export function buildToolSpecs(impl: Tools): Record<string, ToolSpec> {
  return {
    skein_start: {
      description: "启动一个 openskein 工作流实例",
      args: {
        defId: { type: "string", required: true },
        params: { type: "string", description: "实例参数 JSON（可选，含 instanceId 可指定实例号）" },
        data: { type: "string", description: "初始上下文 JSON（可选，按定义 state 的 reducer 合并）" },
      },
      execute: (a) =>
        impl.skein_start({
          defId: String(a.defId),
          params: parseJson(a.params) as Record<string, string>,
          data: a.data === undefined ? undefined : parseJson(a.data),
        }),
    },
    skein_status: {
      description: "查看工作流实例当前状态",
      args: { instanceId: { type: "string", required: true } },
      execute: (a) => impl.skein_status({ instanceId: String(a.instanceId) }),
    },
    skein_advance: {
      description: "推进工作流到下一步（须满足当前步完成标准 CC）",
      args: {
        instanceId: { type: "string", required: true },
        step: { type: "string", required: true },
        evidence: { type: "string", description: "完成证据 JSON（可选，如 {\"ok\":true}）" },
        branch: { type: "string", description: "分支标签（可选，命中该步 branch 时跳转对应目标）" },
        patch: { type: "string", description: "上下文增量 JSON（可选，按定义 state 的 reducer 合并）" },
      },
      execute: (a) =>
        impl.skein_advance({
          instanceId: String(a.instanceId),
          step: String(a.step),
          evidence: parseJson(a.evidence),
          branch: a.branch as string | undefined,
          patch: a.patch === undefined ? undefined : parseJson(a.patch),
        }),
    },
    skein_await: {
      description: "查看实例当前等待的外部输入（awaiting 中断点与提问）",
      args: { instanceId: { type: "string", required: true } },
      execute: (a) => impl.skein_await({ instanceId: String(a.instanceId) }),
    },
    skein_pause: {
      description: "暂停工作流实例",
      args: { instanceId: { type: "string", required: true }, reason: { type: "string" } },
      execute: (a) =>
        impl.skein_pause({ instanceId: String(a.instanceId), reason: a.reason as string | undefined }),
    },
    skein_resume: {
      description: "恢复实例：paused → 继续运行；awaiting → 注入答复（evidence/patch/branch）并推进",
      args: {
        instanceId: { type: "string", required: true },
        evidence: { type: "string", description: "答复证据 JSON（可选，awaiting 时用于完成判定，如 {\"ok\":true}）" },
        patch: { type: "string", description: "答复带来的上下文增量 JSON（可选，按 reducer 合并）" },
        branch: { type: "string", description: "分支标签（可选，停步步骤有 branch 表时指定去向）" },
      },
      execute: (a) =>
        impl.skein_resume({
          instanceId: String(a.instanceId),
          evidence: parseJson(a.evidence),
          patch: a.patch === undefined ? undefined : parseJson(a.patch),
          branch: a.branch as string | undefined,
        }),
    },
    skein_cancel: {
      description: "取消工作流实例",
      args: { instanceId: { type: "string", required: true }, reason: { type: "string" } },
      execute: (a) =>
        impl.skein_cancel({ instanceId: String(a.instanceId), reason: a.reason as string | undefined }),
    },
    skein_validate: {
      description: "静态校验工作流定义（悬空/不可达/环等）",
      args: { defId: { type: "string", required: true } },
      execute: (a) => impl.skein_validate({ defId: String(a.defId) }),
    },
  };
}
