import type { Tools } from "./tools.ts";
export interface ArgSpec {
    type: "string";
    required?: boolean;
    description?: string;
}
export interface ToolSpec {
    description: string;
    args: Record<string, ArgSpec>;
    execute: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}
/** 把内核工具包装成运行时无关的 ToolSpec */
export declare function buildToolSpecs(impl: Tools): Record<string, ToolSpec>;
