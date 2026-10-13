export const TERMINALS = Object.freeze(["done", "canceled"]);
function isTerminal(id) {
    return TERMINALS.includes(id);
}
/** 步骤 id → step 定义 */
export function findStep(def, id) {
    return def.steps.find((s) => s.id === id);
}
/** 把 {param} 占位符替换为实例参数 */
function fill(template, ctx) {
    return template.replace(/\{(\w+)\}/g, (_, k) => ctx[k] != null ? String(ctx[k]) : `{${k}}`);
}
/** 步骤 → 副作用（数据，不执行） */
export function effectsFor(step, ctx) {
    switch (step.kind) {
        case "skill":
            return [{ kind: "load_skill", name: step.skill ?? "" }];
        case "agent":
            return [{ kind: "spawn_subagent", role: step.agent ?? "", prompt: step.prompt ?? `执行步骤 ${step.id}` }];
        case "tool":
            return [{ kind: "call_tool", name: step.tool ?? "", args: step.args ?? {} }];
        case "human":
            return [{ kind: "await_human", question: step.question ?? "请确认" }];
        case "artifact":
            return [{ kind: "write_artifact", path: fill(step.produces ?? "", ctx), content: "" }];
        default:
            return [];
    }
}
/** 完成标准（CC）纯判定：适配层负责把 IO 型证据折算为 evidence.ok */
export function checkCC(step, evidence) {
    if (!step.cc)
        throw new Error(`步骤 ${step.id} 缺少完成标准 cc`);
    return Boolean(evidence && evidence.ok === true);
}
function onStart(def, state, event) {
    if (state)
        throw new Error("实例已存在，不能重复 start");
    const first = def.steps[0];
    if (!first)
        throw new Error("定义缺少步骤");
    const next = {
        instanceId: event.instanceId,
        defId: def.id,
        defVersion: def.version,
        current: first.id,
        params: event.params ?? {},
        status: "running",
        at: event.at,
    };
    return { state: next, effects: effectsFor(first, { ...next.params, instanceId: next.instanceId }) };
}
function onAdvance(def, state, event) {
    if (!state)
        throw new Error("实例不存在，不能 advance");
    if (state.status !== "running")
        throw new Error(`当前状态 ${state.status} 不可 advance`);
    if (event.step !== state.current)
        throw new Error(`advance 步骤不匹配：期望 ${state.current}，收到 ${event.step}`);
    const step = findStep(def, state.current);
    if (!step)
        throw new Error(`未找到步骤 ${state.current}`);
    if (!checkCC(step, event.evidence))
        throw new Error(`步骤 ${step.id} 完成标准未满足`);
    const nextId = Array.isArray(step.next) ? step.next[0] : step.next;
    if (!nextId)
        throw new Error(`步骤 ${step.id} 无后继`);
    const nextState = {
        ...state,
        current: nextId,
        status: isTerminal(nextId) ? nextId : "running",
        at: event.at,
    };
    const nextStep = findStep(def, nextId);
    const ctx = { ...state.params, instanceId: state.instanceId };
    return { state: nextState, effects: nextStep ? effectsFor(nextStep, ctx) : [] };
}
function onPause(state, event) {
    if (!state)
        throw new Error("实例不存在");
    if (state.status !== "running")
        throw new Error(`当前状态 ${state.status} 不可 pause`);
    return { state: { ...state, status: "paused", at: event.at }, effects: [] };
}
function onResume(state, event) {
    if (!state)
        throw new Error("实例不存在");
    if (state.status !== "paused")
        throw new Error(`当前状态 ${state.status} 不可 resume`);
    return { state: { ...state, status: "running", at: event.at }, effects: [] };
}
function onCancel(state, event) {
    if (!state)
        throw new Error("实例不存在");
    if (isTerminal(state.status))
        throw new Error("已终结，不可 cancel");
    return { state: { ...state, status: "canceled", at: event.at }, effects: [] };
}
/** 纯归约：唯一入口 */
export function reduce(def, state, event) {
    switch (event.type) {
        case "start":
            return onStart(def, state, event);
        case "advance":
            return onAdvance(def, state, event);
        case "pause":
            return onPause(state, event);
        case "resume":
            return onResume(state, event);
        case "cancel":
            return onCancel(state, event);
        default: {
            const never = event;
            throw new Error(`未知事件类型: ${JSON.stringify(never)}`);
        }
    }
}
/** 只读视图 */
export function status(def, state) {
    const step = findStep(def, state.current);
    return {
        instanceId: state.instanceId,
        step: state.current,
        next: step?.next ? (Array.isArray(step.next) ? step.next : [step.next]) : [],
        status: state.status,
    };
}
