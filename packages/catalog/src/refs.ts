// refs.ts — 引用提取与校验
// 忠实移植配置仓 catalog-core.js 的四类解析器：
//   workflow(include/调用/hooks/executor) · command(hooks) · agent(model/tools/skills) · skill(11 种模式)
import { parseFrontmatter, asString } from "./frontmatter.ts";
import type { Ref, RefIssue, Resource, ResourceKind } from "./types.ts";

/** 解析器内部产物（未绑定 from） */
export interface RawRef {
  kind: string;
  name: string;
  usage: string;
}

/** 可在配置仓内被索引、从而可校验的引用目标类型 */
const INDEXED_KINDS: ReadonlySet<string> = new Set(["skill", "command", "agent", "workflow"]);

const SKILL_NAME_BLOCKLIST: ReadonlySet<string> = new Set([
  "question", "todowrite", "read", "write", "edit", "bash", "grep", "glob",
  "task", "webfetch", "skill", "true", "false", "null", "include", "return", "diff",
]);
const SKILL_FILE_BLOCKLIST: ReadonlySet<string> = new Set([
  "references", "scripts", "src", "docs", "dist", "test", "tests", "node_modules",
]);
const CMD_BLOCKLIST: ReadonlySet<string> = new Set([
  "tmp", "temp", "dev", "etc", "home", "root", "bin", "sbin", "usr", "var", "opt", "proc", "sys",
]);

function validSkillName(n: string): boolean {
  return n.length >= 3 && /^[a-zA-Z]/.test(n) && !n.startsWith("--") && !n.includes("_") && !SKILL_NAME_BLOCKLIST.has(n);
}

// ---------- workflow ----------
export function parseWorkflowRefs(content: string): RawRef[] {
  const refs: RawRef[] = [];
  for (const m of content.matchAll(/^[\s>]*[-*]\s*\**include\**\s*[：:]\s*([a-zA-Z0-9_./-]+)/gm))
    refs.push({ kind: "workflow", name: (m[1] as string).trim(), usage: "include" });
  for (const m of content.matchAll(/\*\*调用\*\*\s*[：:]\s*`?([a-zA-Z0-9_-]+)`?/g))
    refs.push({ kind: "skill", name: m[1] as string, usage: "call" });
  for (const m of content.matchAll(/[-*]\s*(skill|cmd|tool)\s*[：:]\s*\/?([a-zA-Z0-9_./-]+)/g)) {
    const kind = m[1] === "cmd" ? "command" : m[1] === "tool" ? "tool" : "skill";
    refs.push({ kind, name: (m[2] as string).trim(), usage: "hook" });
  }
  for (const m of content.matchAll(/[-*]\s*调用\s*[：:]\s*`?([a-zA-Z0-9_-]+)`?/g))
    refs.push({ kind: "skill", name: m[1] as string, usage: "call" });
  for (const m of content.matchAll(/executor\s*[：:]\s*subagent\s*:\s*([a-zA-Z0-9_-]+)/g))
    refs.push({ kind: "agent", name: m[1] as string, usage: "executor" });
  return refs;
}

// ---------- command ----------
export function parseCommandRefs(content: string): RawRef[] {
  const refs: RawRef[] = [];
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content.replace(/^\uFEFF/, ""));
  if (!fmMatch) return refs;
  const block = fmMatch[1] ?? "";
  if (!/^hooks:/m.test(block)) return refs;
  for (const m of block.matchAll(/skill:\s*([a-zA-Z0-9_-]+)/g))
    refs.push({ kind: "skill", name: m[1] as string, usage: "hook" });
  for (const m of block.matchAll(/cmd:\s*\/?([a-zA-Z0-9_-]+)/g))
    refs.push({ kind: "command", name: m[1] as string, usage: "hook" });
  return refs;
}

// ---------- agent ----------
export function parseAgentRefs(content: string): RawRef[] {
  const refs: RawRef[] = [];
  const fm = parseFrontmatter(content);
  const model = asString(fm.model);
  if (model) refs.push({ kind: "model", name: model, usage: "model" });
  const tools = fm.tools;
  if (Array.isArray(tools)) for (const t of tools) if (typeof t === "string") refs.push({ kind: "tool", name: t, usage: "tools" });
  const skills = fm.skills;
  if (Array.isArray(skills)) for (const s of skills) if (typeof s === "string") refs.push({ kind: "skill", name: s, usage: "skills" });
  return refs;
}

// ---------- skill ----------
export function parseSkillRefs(content: string): RawRef[] {
  const refs: RawRef[] = [];
  const add = (kind: string, name: string, usage: string): void => {
    refs.push({ kind, name, usage });
  };
  for (const m of content.matchAll(/\*\*调用\*\*\s*[：:]\s*`?([a-zA-Z0-9_-]+)`?/g)) add("skill", m[1] as string, "call");
  for (const m of content.matchAll(/[-*]\s*调用\s*[：:]\s*`?([a-zA-Z0-9_-]+)`?/g)) add("skill", m[1] as string, "call");
  for (const m of content.matchAll(/路由\s*`([a-zA-Z0-9_-]+)`/g)) add("skill", m[1] as string, "route");
  for (const m of content.matchAll(/加载\s*`?([a-zA-Z0-9_-]+)`?\s*Skill/g)) add("skill", m[1] as string, "load");
  for (const m of content.matchAll(/\.\.\/([a-zA-Z0-9_-]+)\//g)) {
    const n = m[1] as string;
    if (!SKILL_FILE_BLOCKLIST.has(n)) add("skill", n, "file-ref");
  }
  for (const m of content.matchAll(/`?\/workflow\s+([a-zA-Z0-9_-]+)`?/g)) add("workflow", m[1] as string, "workflow-ref");
  for (const m of content.matchAll(/`\/([a-z][a-z0-9-]*)`/g)) {
    const n = m[1] as string;
    if (n !== "workflow" && !CMD_BLOCKLIST.has(n)) add("command", n, "command-ref");
  }
  for (const m of content.matchAll(/(?:运行|使用|交给|移交给|参见|重新?跑)\s*`([a-zA-Z0-9_-]+)`/g)) {
    const n = m[1] as string;
    if (validSkillName(n)) add("skill", n, "action");
  }
  for (const m of content.matchAll(/`([a-zA-Z0-9_-]+)`\s*负责/g)) {
    const n = m[1] as string;
    if (validSkillName(n)) add("skill", n, "responsibility");
  }
  for (const m of content.matchAll(/(?:via|using|invoke)\s+the\s+`([a-zA-Z0-9_-]+)`(?!\s*(?:npm\s+)?package\b)/gi)) {
    const n = m[1] as string;
    if (validSkillName(n)) add("skill", n, "action");
  }
  for (const m of content.matchAll(/(?:Run\s+a|spin\s+up\s+a)\s+`([a-zA-Z0-9_-]+)`/gi)) {
    const n = m[1] as string;
    if (validSkillName(n)) add("skill", n, "action");
  }
  return refs;
}

export function parseRefsByKind(kind: ResourceKind, content: string): RawRef[] {
  switch (kind) {
    case "workflow":
      return parseWorkflowRefs(content);
    case "command":
      return parseCommandRefs(content);
    case "agent":
      return parseAgentRefs(content);
    case "skill":
      return parseSkillRefs(content);
    default:
      return [];
  }
}

/** 资源 → 引用（带上 from） */
export function extractRefs(resource: Resource, content: string): Ref[] {
  return parseRefsByKind(resource.kind, content).map((r) => ({
    from: resource.id,
    refKind: r.kind,
    refName: r.name,
    usage: r.usage,
  }));
}

export function validateRefs(resources: Resource[], refs: Ref[]): RefIssue[] {
  const allNames = new Set(resources.map((r) => r.name));
  const byKind = new Map<string, Set<string>>();
  for (const r of resources) {
    const set = byKind.get(r.kind) ?? new Set<string>();
    set.add(r.name);
    byKind.set(r.kind, set);
  }
  const issues: RefIssue[] = [];
  for (const ref of refs) {
    // model/tool 等未被索引的目标类型不参与校验（无法判定）
    if (!INDEXED_KINDS.has(ref.refKind) && ref.refKind !== "wikilink" && ref.refKind !== "any") continue;
    const ok =
      ref.refKind === "wikilink" || ref.refKind === "any"
        ? allNames.has(ref.refName)
        : (byKind.get(ref.refKind)?.has(ref.refName) ?? false);
    if (!ok) {
      issues.push({
        ...ref,
        code: "E_REF_DANGLING",
        message: `悬空引用：${ref.from} → ${ref.refKind}:${ref.refName}`,
      });
    }
  }
  return issues;
}
