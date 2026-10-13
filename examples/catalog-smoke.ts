// catalog-smoke.ts — 对真实配置仓跑一次资源图冒烟
// 用法：node examples/catalog-smoke.ts [configRoot] [configFile]
import { getCatalog, validateRefs, validateCatalog, loadTargets } from "../packages/catalog/src/index.ts";

const root = process.argv[2] ?? "C:/Users/wangguixing/.config/opencode";
const configFile = process.argv[3];
const targets = configFile ? loadTargets(configFile) : undefined;

const cat = getCatalog({ configRoot: root, targets });

const byKind: Record<string, number> = {};
for (const r of cat.resources) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

const dup = validateCatalog(cat.resources);
const dangling = validateRefs(cat.resources, cat.graph.edges);

console.log("configRoot :", root);
console.log("targets    :", targets ? `${targets.length}（来自 ${configFile}）` : "通用默认");
console.log("resources  :", cat.resources.length, JSON.stringify(byKind));
console.log("edges      :", cat.graph.edges.length);
console.log("dupResources:", dup.length);
for (const i of dup.slice(0, 10)) console.log("  dup -", i.message);
console.log("dangling   :", dangling.length);
for (const i of dangling.slice(0, 8)) console.log("  -", i.message);
