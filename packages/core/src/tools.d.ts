import type { EventStore } from "./store.ts";
import type { Definition, Effect, Evidence, Issue, State, StatusView } from "./types.ts";
export interface Tools {
    skein_start(input: {
        defId: string;
        params?: Record<string, string>;
    }): {
        state: State;
        effects: Effect[];
    };
    skein_status(input: {
        instanceId: string;
    }): StatusView;
    skein_advance(input: {
        instanceId: string;
        step: string;
        evidence?: Evidence;
    }): {
        state: State;
        effects: Effect[];
    };
    skein_pause(input: {
        instanceId: string;
        reason?: string;
    }): {
        state: State;
        effects: Effect[];
    };
    skein_resume(input: {
        instanceId: string;
    }): {
        state: State;
        effects: Effect[];
    };
    skein_cancel(input: {
        instanceId: string;
        reason?: string;
    }): {
        state: State;
        effects: Effect[];
    };
    skein_validate(input: {
        defId: string;
    }): Issue[];
}
export interface CreateToolsOptions {
    defs: Record<string, Definition>;
    store: EventStore;
    now?: () => string;
}
export declare function createTools({ defs, store, now }: CreateToolsOptions): Tools;
