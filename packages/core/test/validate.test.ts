import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/validate.ts";
import { featureFlow as def } from "../src/flows.ts";
import type { Definition, Issue } from "../src/types.ts";

const has = (issues: Issue[], code: string): boolean => issues.some((i) => i.code === code);
const errors = (issues: Issue[]): Issue[] => issues.filter((i) => i.code.startsWith("E_"));

test("feature 定义无问题", () => {
  assert.deepEqual(errors(validate(def)), []);
});

test("悬空 next 被检出", () => {
  const d = structuredClone(def) as Definition;
  d.steps[0]!.next = ["nope"];
  assert.ok(has(validate(d), "E_DANGLING"));
});

test("重复 id 被检出", () => {
  const d = structuredClone(def) as Definition;
  d.steps[1]!.id = d.steps[0]!.id;
  assert.ok(has(validate(d), "E_DUP"));
});

test("不可达步骤被检出", () => {
  const d = structuredClone(def) as Definition;
  d.steps.push({ id: "orphan", kind: "skill", skill: "x", cc: { type: "user_ack" }, next: ["done"] });
  assert.ok(has(validate(d), "E_UNREACHABLE"));
});

test("环被检出（返工回环为告警 W_CYCLE，非阻断错误）", () => {
  const d = structuredClone(def) as Definition;
  d.steps[0]!.next = ["plan"];
  d.steps[1]!.next = ["spec"];
  assert.ok(has(validate(d), "W_CYCLE"));
  assert.ok(!has(validate(d), "E_CYCLE"));
});

test("branch 悬空目标被检出；branch-only 步骤不误报 E_NEXT", () => {
  const d: Definition = {
    schema: 2,
    id: "b",
    version: "1",
    steps: [{ id: "a", kind: "skill", skill: "s", cc: { type: "user_ack" }, branch: { go: "nope" } }],
  };
  assert.ok(has(validate(d), "E_DANGLING"));
  assert.ok(!has(validate(d), "E_NEXT"));
});

test("branch 边纳入环检测（告警）", () => {
  const d: Definition = {
    schema: 2,
    id: "c",
    version: "1",
    steps: [
      { id: "a", kind: "skill", skill: "s", cc: { type: "user_ack" }, branch: { loop: "b", out: "done" } },
      { id: "b", kind: "skill", skill: "s", cc: { type: "user_ack" }, branch: { back: "a", out: "done" } },
    ],
  };
  assert.ok(has(validate(d), "W_CYCLE"));
});

test("workflow 类型缺 workflow 字段被检出", () => {
  const d: Definition = {
    schema: 2,
    id: "w",
    version: "1",
    steps: [{ id: "a", kind: "workflow", cc: { type: "effect_ok" }, next: ["done"] }],
  };
  assert.ok(has(validate(d), "E_WORKFLOW"));
});

test("v1 定义仍可校验（旧版本仅告警）", () => {
  const d = structuredClone(def) as Definition;
  d.schema = 1;
  const issues = validate(d);
  assert.ok(has(issues, "W_SCHEMA_OLD"));
  assert.ok(!has(issues, "E_SCHEMA"));
});

test("未知 schema 被检出", () => {
  const d = structuredClone(def) as Definition;
  d.schema = 3;
  assert.ok(has(validate(d), "E_SCHEMA"));
});

test("state reducer 非法被检出", () => {
  const d = structuredClone(def) as Definition;
  d.state = { findings: { reducer: "nope" as unknown as "append" } };
  assert.ok(has(validate(d), "E_STATE_REDUCER"));
});

test("await.kind 非法被检出", () => {
  const d = structuredClone(def) as Definition;
  d.steps[0]!.await = { kind: "x" as unknown as "human" };
  assert.ok(has(validate(d), "E_AWAIT_KIND"));
});

test("await.kind=signal 在 Phase 1 被检出为不支持", () => {
  const d = structuredClone(def) as Definition;
  d.steps[0]!.await = { kind: "signal" };
  assert.ok(has(validate(d), "E_AWAIT_SIGNAL"));
});

test("step.effects 的 Effect kind 非法被检出", () => {
  const d = structuredClone(def) as Definition;
  d.steps[0]!.effects = [{ kind: "nope" } as never];
  assert.ok(has(validate(d), "E_EFFECT_KIND"));
});

test("合法 step.effects 与 await.human 不产生问题", () => {
  const d = structuredClone(def) as Definition;
  d.steps[0]!.effects = [
    { kind: "call_tool", name: "t", args: {} },
    { kind: "run_command", name: "/gen-commit" },
  ];
  d.steps[0]!.await = { kind: "human", question: "q", schema: { type: "boolean" } };
  assert.deepEqual(errors(validate(d)), []);
});