import type { WorkflowEvent } from "./types.ts";
export interface EventStore {
    append(instanceId: string, event: WorkflowEvent): void;
    readAll(instanceId: string): WorkflowEvent[];
    instances(): string[];
}
export declare function createFsStore({ dir }: {
    dir: string;
}): EventStore;
