// defs.ts — 从目录加载 JSON 工作流定义（IO 边界）
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
export function loadDefinitions(dir) {
    if (!existsSync(dir))
        return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}
