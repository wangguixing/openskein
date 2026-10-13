export type StepKind = "artifact" | "skill" | "agent" | "tool" | "human";
export interface CC {
    type: string;
    [k: string]: unknown;
}
export interface Step {
    id: string;
    kind: StepKind;
    cc: CC;
    next?: string | string[];
    produces?: string;
    skill?: string;
    agent?: string;
    tool?: string;
    args?: Record<string, unknown>;
    prompt?: string;
    question?: string;
}
export interface Gate {
    before: string;
    require: CC;
}
export interface Definition {
    schema: number;
    id: string;
    version: string;
    summary?: string;
    params?: Array<{
        name: string;
        required?: boolean;
    }>;
    steps: Step[];
    gates?: Gate[];
}
export type InstanceStatus = "running" | "paused" | "done" | "canceled";
export interface State {
    instanceId: string;
    defId: string;
    defVersion: string;
    current: string;
    params: Record<string, string>;
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
export type WorkflowEvent = ({
    type: "start";
    instanceId: string;
    params?: Record<string, string>;
} & EventBase) | ({
    type: "advance";
    step: string;
    evidence?: Evidence;
} & EventBase) | ({
    type: "pause";
    reason?: string;
} & EventBase) | ({
    type: "resume";
} & EventBase) | ({
    type: "cancel";
    reason: string;
} & EventBase);
export type Effect = {
    kind: "load_skill";
    name: string;
} | {
    kind: "spawn_subagent";
    role: string;
    prompt: string;
} | {
    kind: "call_tool";
    name: string;
    args: Record<string, unknown>;
} | {
    kind: "write_artifact";
    path: string;
    content: string;
} | {
    kind: "await_human";
    question: string;
};
export interface Issue {
    code: string;
    message: string;
    step?: string;
}
export interface StatusView {
    instanceId: string;
    step: string;
    next: string[];
    status: InstanceStatus;
}
export {};
