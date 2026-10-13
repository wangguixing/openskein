import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCatalog, validateCatalog, loadTargets } from "../src/catalog.ts";
import { validateRefs, parseSkillRefs, parseWorkflowRefs } from "../src/refs.ts";
import { parseFrontmatter } from "../src/frontmatter.ts";
import type { Resource } from "../src/types.ts";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "skein-cat-"));
  mkdirSync(join(root, "skills", "alpha"), { recursive: true });
  writeFileSync(
    join(root, "skills", "alpha", "SKILL.md"),
    "---\nname: alpha\ndescription: 甲\n---\n**调用**：beta\n**调用**：missing\n",
  );
  mkdirSync(join(root, "skills", "beta"), { recursive: true });
  writeFileSync(join(root, "skills", "beta", "SKILL.md"), "---\nname: beta\n---\n");
  return root;
}

test("frontmatter 解析（标量 + 数组）", () => {
  const fm = parseFrontmatter("---\nname: x\ntags: [a, b]\n---\nbody");
  assert.equal(fm.name, "x");
  assert.deepEqual(fm.tags, ["a", "b"]);
});

test("getCatalog 扫描 skill 目录", () => {
  const cat = getCatalog({ configRoot: fixture() });
  assert.deepEqual(cat.resources.map((r) => `${r.kind}:${r.name}`).sort(), ["skill:alpha", "skill:beta"]);
});

test("parseSkillRefs 识别 **调用** / 路由 / 加载 / ../", () => {
  const refs = parseSkillRefs("**调用**：a-skill\n路由 `b-skill`\n加载 `c-skill` Skill\n见 ../d-skill/references\n");
  assert.deepEqual(refs.map((r) => r.name).sort(), ["a-skill", "b-skill", "c-skill", "d-skill"]);
});

test("parseWorkflowRefs 识别 include / hooks / executor", () => {
  const refs = parseWorkflowRefs("- include: base\n- skill: pre-check\n- cmd: /foo\nexecutor: subagent:worker\n");
  const got = refs.map((r) => `${r.kind}:${r.name}`).sort();
  assert.deepEqual(got, ["agent:worker", "command:foo", "skill:pre-check", "workflow:base"]);
});

test("validateRefs 检出悬空引用，忽略 model/tool", () => {
  const cat = getCatalog({ configRoot: fixture() });
  const issues = validateRefs(cat.resources, cat.graph.edges);
  assert.deepEqual(issues.map((i) => i.refName), ["missing"]);
});

test("validateCatalog 检出同 id 重复资源（跨类型同名合法）", () => {
  const dupSameKind: Resource[] = [
    { id: "skill:a", kind: "skill", name: "a", path: "x" },
    { id: "skill:a", kind: "skill", name: "a", path: "y" },
  ];
  assert.ok(validateCatalog(dupSameKind).some((i) => i.code === "E_DUP_RESOURCE"));
  const crossKind: Resource[] = [
    { id: "skill:a", kind: "skill", name: "a", path: "x" },
    { id: "command:a", kind: "command", name: "a", path: "y" },
  ];
  assert.deepEqual(validateCatalog(crossKind), []);
});

test("loadTargets 从配置读取 targets", () => {
  const dir = mkdtempSync(join(tmpdir(), "skein-tt-"));
  const cfg = join(dir, "catalog.json");
  writeFileSync(cfg, JSON.stringify({ targets: [{ kind: "skill", dir: "custom", layout: "skill-dir" }] }));
  assert.deepEqual(loadTargets(cfg), [{ kind: "skill", dir: "custom", layout: "skill-dir" }]);
});

test("getCatalog 用显式 targets 扫描非默认目录", () => {
  const root = mkdtempSync(join(tmpdir(), "skein-tt-"));
  mkdirSync(join(root, "custom", "delta"), { recursive: true });
  writeFileSync(join(root, "custom", "delta", "SKILL.md"), "---\nname: delta\n---\n");
  const cat = getCatalog({ configRoot: root, targets: [{ kind: "skill", dir: "custom", layout: "skill-dir" }] });
  assert.deepEqual(cat.resources.map((r) => r.name), ["delta"]);
  assert.equal(getCatalog({ configRoot: root }).resources.length, 0);
});
