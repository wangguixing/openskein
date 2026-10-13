import type { Definition } from "./types.ts";
export declare const CURRENT_SCHEMA = 1;
export interface MigrationResult {
    def: Definition;
    changed: boolean;
    applied: string[];
}
/** 把任意版本的 Definition 升级到 CURRENT_SCHEMA */
export declare function migrate(input: Definition): MigrationResult;
