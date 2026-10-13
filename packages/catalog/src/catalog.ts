// catalog.ts — 资源图：扫描目录 → 资源清单 + 引用边
// 布局（targets）为「配置项」：库内只提供通用默认，仓库专属布局由配置文件注入。
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, asString } from "./frontmatter.ts";
import { extractRefs } from "./refs.ts";
import type { Catalog, CatalogIssue, Ref, Resource, ResourceKind } from "./types.ts";

export interface Target {
  kind: ResourceKind;
  dir: string;
  layout: "skill-dir" | "flat-md";
}

/** 目录配置（可落在 <configRoot>/.skein/catalog.json 等文件里） */
export interface CatalogConfig {
  targets?: Target[];
}

/** 通用默认（标准 opencode 布局，不含任何仓库专属目录） */
export const OPENCODE_DEFAULT_TARGETS: ReadonlyArray<Target> = [
  { kind: "skill", dir: "skills", layout: "skill-dir" },
  { kind: "agent", dir: "agents", layout: "flat-md" },
  { kind: "command", dir: "commands", layout: "flat-md" },
  { kind: "workflow", dir: "workflows", layout: "flat-md" },
];

/** 从 JSON 配置文件加载 targets */
export function loadTargets(file: string): Target[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as CatalogConfig;
  return raw.targets ?? [];
}

export interface GetCatalogOptions {
  configRoot: string;
  targets?: ReadonlyArray<Target>;
}

export function getCatalog({ configRoot, targets = OPENCODE_DEFAULT_TARGETS }: GetCatalogOptions): Catalog {
  const resources: Resource[] = [];
  const edges: Ref[] = [];

  for (const t of targets) {
    const abs = join(configRoot, t.dir);
    if (!existsSync(abs)) continue;

    for (const entry of readdirSync(abs)) {
      let file: string;
      let fallbackName: string;
      if (t.layout === "skill-dir") {
        file = join(abs, entry, "SKILL.md");
        if (!existsSync(file)) continue;
        fallbackName = entry;
      } else {
        if (!entry.endsWith(".md")) continue;
        file = join(abs, entry);
        fallbackName = entry.replace(/\.md$/, "");
      }

      const content = readFileSync(file, "utf8");
      const fm = parseFrontmatter(content);
      const name = asString(fm.name) ?? fallbackName;
      const id = `${t.kind}:${name}`;
      const resource: Resource = { id, kind: t.kind, name, path: file };
      const desc = asString(fm.description);
      if (desc !== undefined) resource.description = desc;
      resources.push(resource);
      edges.push(...extractRefs(resource, content));
    }
  }

  return { resources, graph: { nodes: resources.map((r) => r.id), edges } };
}

/** 资源清单内部一致性：同 id（kind:name）重复检测（跨类型同名合法） */
export function validateCatalog(resources: Resource[]): CatalogIssue[] {
  const count = new Map<string, number>();
  for (const r of resources) count.set(r.id, (count.get(r.id) ?? 0) + 1);
  const issues: CatalogIssue[] = [];
  for (const [id, n] of count) {
    if (n > 1) issues.push({ code: "E_DUP_RESOURCE", message: `重复资源：${id}（${n} 处）`, id });
  }
  return issues;
}
