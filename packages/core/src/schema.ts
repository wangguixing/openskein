// schema.ts — 定义规范版本与迁移框架
import type { Definition } from "./types.ts";

export const CURRENT_SCHEMA = 2;

/** 校验器接受的 schema 集合（历史版本可加载，迁移后判定） */
export const SUPPORTED_SCHEMAS: readonly number[] = [1, 2];

interface Migration {
  from: number;
  to: number;
  name: string;
  run: (def: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * 历史迁移表：未来破坏性变更逐条追加。
 * 1 → 2：v2 引入 state/await/effects 原语；v1 定义补空 state（无条件补空，幂等）。
 * 注：v1 不存在 checkpoint 字段，"checkpoint → await" 属前瞻迁移，不在此实现。
 */
const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    from: 1,
    to: 2,
    name: "state-context",
    run: (def) => ({ ...def, state: def.state ?? {} }),
  },
];

export interface MigrationResult {
  def: Definition;
  changed: boolean;
  applied: string[];
}

/** 把任意版本的 Definition 升级到 CURRENT_SCHEMA */
export function migrate(input: Definition): MigrationResult {
  let def = input as unknown as Record<string, unknown>;
  const applied: string[] = [];
  let cur = typeof def.schema === "number" ? (def.schema as number) : 0;
  while (cur < CURRENT_SCHEMA) {
    const step = MIGRATIONS.find((m) => m.from === cur);
    if (!step) throw new Error(`缺少 schema ${cur} → ${cur + 1} 的迁移`);
    def = step.run(def);
    def.schema = step.to;
    applied.push(step.name);
    cur = step.to;
  }
  return { def: def as unknown as Definition, changed: applied.length > 0, applied };
}
