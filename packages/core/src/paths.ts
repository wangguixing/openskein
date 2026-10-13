// paths.ts — openskein 在某个作用域（全局 / 项目）下的路径布局（baseDir 可配置）
import { join } from "node:path";

export const DEFAULT_BASE_DIR = ".skein";

export interface SkeinPaths {
  base: string;
  flowsDir: string;
  eventsDir: string;
  lockPath: string;
  catalogConfig: string;
}

/** 由显式 base 目录计算布局（base 可为全局根或项目根下的 .skein） */
export function skeinPathsFor(base: string): SkeinPaths {
  return {
    base,
    flowsDir: join(base, "flows"),
    eventsDir: join(base, "events"),
    lockPath: join(base, "kit.lock.json"),
    catalogConfig: join(base, "catalog.json"),
  };
}

/** 项目作用域：<projectDir>/<baseDir>（baseDir 默认 .skein，可用 SKEIN_BASE_DIR/参数覆盖） */
export function skeinPaths(projectDir: string, baseDir: string = DEFAULT_BASE_DIR): SkeinPaths {
  return skeinPathsFor(join(projectDir, baseDir));
}
