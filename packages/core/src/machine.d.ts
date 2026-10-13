import type { Definition, Effect, Evidence, State, StatusView, Step, WorkflowEvent } from "./types.ts";
export declare const TERMINALS: readonly string[];
/** 步骤 id → step 定义 */
export declare function findStep(def: Definition, id: string): Step | undefined;
/** 步骤 → 副作用（数据，不执行） */
export declare function effectsFor(step: Step, ctx: Record<string, unknown>): Effect[];
/** 完成标准（CC）纯判定：适配层负责把 IO 型证据折算为 evidence.ok */
export declare function checkCC(step: Step, evidence?: Evidence): boolean;
/** 纯归约：唯一入口 */
export declare function reduce(def: Definition, state: State | null, event: WorkflowEvent): {
    state: State;
    effects: Effect[];
};
/** 只读视图 */
export declare function status(def: Definition, state: State): StatusView;
