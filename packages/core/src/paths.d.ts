export declare const DEFAULT_BASE_DIR = ".skein";
export interface SkeinPaths {
    base: string;
    flowsDir: string;
    eventsDir: string;
    lockPath: string;
    catalogConfig: string;
}
/** 计算某项目下的 openskein 路径（baseDir 默认 .skein，可用 SKEIN_BASE_DIR/参数覆盖） */
export declare function skeinPaths(projectDir: string, baseDir?: string): SkeinPaths;
