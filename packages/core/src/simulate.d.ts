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
export declare function simulate(def: Definition, events: WorkflowEvent[]): SimResult;
