// flows.ts — 内置工作流定义（数据；与用户 JSON 定义同构）
import type { Definition } from "./types.ts";

export const featureFlow: Definition = {
  schema: 2,
  id: "feature",
  version: "1.0.0",
  summary: "需求 → 规格 → 实现 → 审查",
  params: [{ name: "requirement", required: true }],
  state: { notes: { reducer: "append" } },
  steps: [
    {
      id: "spec",
      kind: "artifact",
      produces: "specs/{instanceId}.md",
      cc: { type: "file_exists", path: "specs/{instanceId}.md" },
      next: ["plan"],
    },
    {
      id: "plan",
      kind: "skill",
      skill: "planner",
      cc: { type: "effect_ok", effect: "load_skill" },
      next: ["implement"],
    },
    {
      id: "implement",
      kind: "agent",
      agent: "worker",
      cc: { type: "user_ack" },
      next: ["review"],
    },
    {
      id: "review",
      kind: "skill",
      skill: "critic",
      cc: { type: "effect_ok", effect: "load_skill" },
      next: ["done"],
    },
  ],
  gates: [{ before: "implement", require: { type: "refs_valid" } }],
};

/** 首个真实工作流移植：对齐配置仓 workflows/bug.md（报告→诊断→复现→TDD→审查→提交→提交信息） */
export const bugFlow: Definition = {
  schema: 2,
  id: "bug",
  version: "1.0.0",
  summary: "报告 → 诊断 → 最小复现 → TDD 修复 → 审查 → 提交 → 生成提交信息",
  params: [{ name: "bug", required: true }],
  state: { findings: { reducer: "append" }, tier: { reducer: "replace" } },
  steps: [
    { id: "report", kind: "skill", skill: "triage", cc: { type: "user_ack" }, next: ["diagnose"] },
    { id: "diagnose", kind: "skill", skill: "diagnosing-bugs", cc: { type: "user_ack" }, next: ["reproduce"] },
    { id: "reproduce", kind: "skill", skill: "prototype", cc: { type: "user_ack" }, next: ["fix"] },
    { id: "fix", kind: "skill", skill: "tdd", cc: { type: "effect_ok", effect: "load_skill" }, next: ["review"] },
    { id: "review", kind: "skill", skill: "review", cc: { type: "user_ack" }, next: ["submit"] },
    { id: "submit", kind: "skill", skill: "pre-check", cc: { type: "effect_ok", effect: "load_skill" }, next: ["commit"] },
    { id: "commit", kind: "tool", tool: "gen-commit", cc: { type: "user_ack" }, next: ["done"] },
  ],
};

/**
 * 审查流程（v2 原语样板）：以 await 中断表达人工确认点，branch 表达结论分叉。
 * - approve：`await{kind:"human"}` → 命中后实例停在 awaiting，由 resume(evidence+patch) 注入结论并推进
 * - revise 回环至 review，供 validate 的环检测/人工返工路径验证
 */
export const reviewFlow: Definition = {
  schema: 2,
  id: "review",
  version: "1.0.0",
  summary: "审查 → 人工确认（await 中断）→ 通过 / 返工",
  state: { decision: { reducer: "replace" }, comments: { reducer: "append" } },
  steps: [
    {
      id: "review",
      kind: "skill",
      skill: "critic",
      cc: { type: "effect_ok", effect: "load_skill" },
      next: ["approve"],
    },
    {
      id: "approve",
      kind: "human",
      await: { kind: "human", question: "确认审查结论？", schema: { type: "boolean" } },
      cc: { type: "user_ack" },
      branch: { approve: "done", revise: "revise" },
    },
    {
      id: "revise",
      kind: "skill",
      skill: "tdd",
      cc: { type: "user_ack" },
      next: ["review"],
    },
  ],
};

export const builtinFlows: ReadonlyArray<Definition> = [featureFlow, bugFlow, reviewFlow];
