// tools.ts — 对 LLM 暴露的工具（薄壳：收事件 → reduce → 存储 → 返回 effects）
// 不含任何 opencode 依赖；opencode/MCP 适配层仅需把 createTools 的结果接到各自工具面。
import { reduce, status } from "./machine.ts";
import { validate } from "./validate.ts";
import type { EventStore } from "./store.ts";
import type { Definition, Effect, Evidence, Issue, State, StatusView, WorkflowEvent } from "./types.ts";

export interface Tools {
  skein_start(input: { defId: string; params?: Record<string, string>; data?: Record<string, unknown> }): { state: State; effects: Effect[] };
  skein_status(input: { instanceId: string }): StatusView;
  skein_advance(input: { instanceId: string; step: string; evidence?: Evidence; branch?: string; patch?: Record<string, unknown> }): { state: State; effects: Effect[] };
  /** 只读：查看当前实例等待的外部输入（status !== "awaiting" 时 awaiting 为 null） */
  skein_await(input: { instanceId: string }): StatusView;
  skein_pause(input: { instanceId: string; reason?: string }): { state: State; effects: Effect[] };
  skein_resume(input: { instanceId: string; evidence?: Evidence; patch?: Record<string, unknown>; branch?: string }): { state: State; effects: Effect[] };
  skein_cancel(input: { instanceId: string; reason?: string }): { state: State; effects: Effect[] };
  skein_validate(input: { defId: string }): Issue[];
}

export interface CreateToolsOptions {
  defs: Record<string, Definition>;
  store: EventStore;
  now?: () => string;
}

export function createTools({ defs, store, now = () => new Date().toISOString() }: CreateToolsOptions): Tools {
  const get = (id: string): Definition => {
    const d = defs[id];
    if (!d) throw new Error(`未找到工作流定义: ${id}`);
    return d;
  };

  const replay = (instanceId: string): State | null => {
    let s: State | null = null;
    for (const raw of store.readAll(instanceId)) {
      const e = (raw.defId ? raw : s ? { ...raw, defId: s.defId } : raw) as WorkflowEvent;
      s = reduce(get(e.defId as string), s, e).state;
    }
    return s;
  };

  const requireState = (instanceId: string): State => {
    const s = replay(instanceId);
    if (!s) throw new Error(`实例不存在: ${instanceId}`);
    return s;
  };

  const apply = (instanceId: string, defId: string, event: WorkflowEvent): { state: State; effects: Effect[] } => {
    const def = get(defId);
    const state = replay(instanceId);
    const { state: nextState, effects } = reduce(def, state, event);
    store.append(instanceId, { ...event, defId });
    return { state: nextState, effects };
  };

  return {
    skein_start({ defId, params = {}, data }) {
      const instanceId = params.instanceId ?? `${defId}-${Date.now()}`;
      return apply(instanceId, defId, { type: "start", instanceId, params, data, at: now() });
    },
    skein_status({ instanceId }) {
      const state = requireState(instanceId);
      return status(get(state.defId), state);
    },
    skein_await({ instanceId }) {
      const state = requireState(instanceId);
      return status(get(state.defId), state);
    },
    skein_advance({ instanceId, step, evidence, branch, patch }) {
      const state = requireState(instanceId);
      return apply(instanceId, state.defId, { type: "advance", step, evidence, branch, patch, at: now() });
    },
    skein_pause({ instanceId, reason }) {
      const state = requireState(instanceId);
      return apply(instanceId, state.defId, { type: "pause", reason, at: now() });
    },
    skein_resume({ instanceId, evidence, patch, branch }) {
      const state = requireState(instanceId);
      return apply(instanceId, state.defId, { type: "resume", evidence, patch, branch, at: now() });
    },
    skein_cancel({ instanceId, reason = "canceled" }) {
      const state = requireState(instanceId);
      return apply(instanceId, state.defId, { type: "cancel", reason, at: now() });
    },
    skein_validate({ defId }) {
      return validate(get(defId));
    },
  };
}
