// validate.ts — 定义静态校验（纯函数）：唯一 id / 悬空 next / 可达性 / 环 / cc 存在性
import { TERMINALS } from "./machine.js";
function nextsOf(step) {
    if (Array.isArray(step.next))
        return step.next;
    return step.next ? [step.next] : [];
}
export function validate(def) {
    const issues = [];
    const push = (code, message, step) => {
        issues.push({ code, message, step });
    };
    if (!def || typeof def !== "object") {
        push("E_DEF", "定义为空");
        return issues;
    }
    if (def.schema !== 1)
        push("E_SCHEMA", `schema 必须为 1，实际 ${def.schema}`);
    if (!def.id)
        push("E_ID", "缺少 id");
    if (!Array.isArray(def.steps) || def.steps.length === 0) {
        push("E_STEPS", "缺少 steps");
        return issues;
    }
    const ids = new Set();
    for (const s of def.steps) {
        if (!s.id) {
            push("E_STEP_ID", "步骤缺少 id");
            continue;
        }
        if (ids.has(s.id))
            push("E_DUP", `重复步骤 id: ${s.id}`, s.id);
        ids.add(s.id);
        if (!s.cc)
            push("E_CC", `步骤 ${s.id} 缺少完成标准 cc`, s.id);
    }
    for (const s of def.steps) {
        const nexts = nextsOf(s);
        if (nexts.length === 0)
            push("E_NEXT", `步骤 ${s.id} 无 next`, s.id);
        for (const n of nexts) {
            if (!ids.has(n) && !TERMINALS.includes(n))
                push("E_DANGLING", `步骤 ${s.id} 的 next「${n}」不存在且非终结符`, s.id);
        }
    }
    // 可达性（从首个步骤 BFS）
    const first = def.steps[0].id;
    const seen = new Set();
    const queue = [first];
    while (queue.length) {
        const cur = queue.shift();
        if (seen.has(cur))
            continue;
        seen.add(cur);
        const step = def.steps.find((s) => s.id === cur);
        if (!step)
            continue;
        for (const n of nextsOf(step))
            if (ids.has(n))
                queue.push(n);
    }
    for (const s of def.steps)
        if (!seen.has(s.id))
            push("E_UNREACHABLE", `步骤 ${s.id} 从起点不可达`, s.id);
    // 环检测（DFS 三色）
    const color = new Map();
    const dfs = (id) => {
        color.set(id, 1);
        const step = def.steps.find((s) => s.id === id);
        for (const n of step ? nextsOf(step) : []) {
            if (!ids.has(n))
                continue;
            if (color.get(n) === 1)
                push("E_CYCLE", `检测到环：${id} → ${n}`, id);
            else if (!color.get(n))
                dfs(n);
        }
        color.set(id, 2);
    };
    for (const s of def.steps)
        if (!color.get(s.id))
            dfs(s.id);
    return issues;
}
