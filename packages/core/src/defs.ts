// defs.ts — 从目录加载 JSON 工作流定义（IO 边界）
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Definition } from "./types.ts";

/** 目录内 .json 的「定义」判定：对象且带字符串 id（排除事件数组等旁挂 JSON） */
export function isDefinition(v: unknown): v is Definition {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as { id?: unknown }).id === "string" &&
    (v as { id: string }).id.length > 0
  );
}

export function loadDefinitions(dir: string): Definition[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown)
    .filter(isDefinition);
}

/** 多目录合并（按 id 去重，**后者覆盖前者**）——用于 global + project 双作用域 */
export function loadDefinitionsFrom(dirs: ReadonlyArray<string>): Definition[] {
  const byId = new Map<string, Definition>();
  for (const dir of dirs) for (const d of loadDefinitions(dir)) byId.set(d.id, d);
  return [...byId.values()];
}
