// simulate.ts — 干跑：纯重放事件序列，返回每步状态与副作用（无 IO）
import { reduce } from "./machine.js";
export function simulate(def, events) {
    let state = null;
    const steps = [];
    for (const event of events) {
        const r = reduce(def, state, event);
        state = r.state;
        steps.push({ event, state: r.state, effects: r.effects });
    }
    return { steps, final: state };
}
