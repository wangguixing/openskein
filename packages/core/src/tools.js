// tools.ts — 对 LLM 暴露的工具（薄壳：收事件 → reduce → 存储 → 返回 effects）
// 不含任何 opencode 依赖；opencode/MCP 适配层仅需把 createTools 的结果接到各自工具面。
import { reduce, status } from "./machine.js";
import { validate } from "./validate.js";
export function createTools({ defs, store, now = () => new Date().toISOString() }) {
    const get = (id) => {
        const d = defs[id];
        if (!d)
            throw new Error(`未找到工作流定义: ${id}`);
        return d;
    };
    const replay = (instanceId) => {
        let s = null;
        for (const e of store.readAll(instanceId))
            s = reduce(get(e.defId), s, e).state;
        return s;
    };
    const requireState = (instanceId) => {
        const s = replay(instanceId);
        if (!s)
            throw new Error(`实例不存在: ${instanceId}`);
        return s;
    };
    const apply = (instanceId, defId, event) => {
        const def = get(defId);
        const state = replay(instanceId);
        const { state: nextState, effects } = reduce(def, state, event);
        store.append(instanceId, { ...event, defId });
        return { state: nextState, effects };
    };
    return {
        skein_start({ defId, params = {} }) {
            const instanceId = params.instanceId ?? `${defId}-${Date.now()}`;
            return apply(instanceId, defId, { type: "start", instanceId, params, at: now() });
        },
        skein_status({ instanceId }) {
            const state = requireState(instanceId);
            return status(get(state.defId), state);
        },
        skein_advance({ instanceId, step, evidence }) {
            const state = requireState(instanceId);
            return apply(instanceId, state.defId, { type: "advance", step, evidence, at: now() });
        },
        skein_pause({ instanceId, reason }) {
            const state = requireState(instanceId);
            return apply(instanceId, state.defId, { type: "pause", reason, at: now() });
        },
        skein_resume({ instanceId }) {
            const state = requireState(instanceId);
            return apply(instanceId, state.defId, { type: "resume", at: now() });
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
