// simulate.ts — 干跑：纯重放事件序列，返回每步状态与副作用（无 IO）
import { reduce } from "./machine.ts";
import type { Definition, Effect, State, WorkflowEvent } from "./types.ts";

export interface SimStep {
  event: WorkflowEvent;
  state: State;
  effects: Effect[];
}

export interface SimResult {
  steps: SimStep[];
  final: State | null;
}

export function simulate(def: Definition, events: WorkflowEvent[]): SimResult {
  let state: State | null = null;
  const steps: SimStep[] = [];
  for (const event of events) {
    const r = reduce(def, state, event);
    state = r.state;
    steps.push({ event, state: r.state, effects: r.effects });
  }
  return { steps, final: state };
}
