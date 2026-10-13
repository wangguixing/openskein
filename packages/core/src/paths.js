// paths.ts — openskein 在项目下的路径布局（baseDir 可配置）
import { join } from "node:path";
export const DEFAULT_BASE_DIR = ".skein";
/** 计算某项目下的 openskein 路径（baseDir 默认 .skein，可用 SKEIN_BASE_DIR/参数覆盖） */
export function skeinPaths(projectDir, baseDir = DEFAULT_BASE_DIR) {
    const base = join(projectDir, baseDir);
    return {
        base,
        flowsDir: join(base, "flows"),
        eventsDir: join(base, "events"),
        lockPath: join(base, "kit.lock.json"),
        catalogConfig: join(base, "catalog.json"),
    };
}
