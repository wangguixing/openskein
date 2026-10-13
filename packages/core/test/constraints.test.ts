import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSTRAINT_CONTRACT,
  checkContract,
  constraintKinds,
  isEnforceableKind,
  planConstraints,
} from "../src/constraints.ts";
import { validate } from "../src/validate.ts";
import type { Constraint, Definition } from "../src/types.ts";

test("契约自检通过（phase/blocking/capability 三表覆盖一致）", () => {
  assert.deepEqual(checkContract(), []);
});

test("契约分类：7 类义务 + 3 类注解", () => {
  assert.deepEqual([...CONSTRAINT_CONTRACT.enforceable], ["pre", "guard", "write", "timeout", "dispatch", "effect", "fallback"]);
  assert.deepEqual([...CONSTRAINT_CONTRACT.annotation], ["note", "output", "skip"]);
  assert.equal(constraintKinds().length, 10);
  assert.ok(isEnforceableKind("pre"));
  assert.ok(!isEnforceableKind("note"));
});

const def = (constraints: Constraint[]): Definition => ({
  schema: 2,
  id: "cx",
  version: "1",
  constraints,
  steps: [{ id: "a", kind: "skill", skill: "s", cc: { type: "user_ack" }, next: ["done"] }],
});

test("planConstraints：义务/注解分类与时机分组", () => {
  const plan = planConstraints(
    def([
      { kind: "pre", target: "flow", text: "tracker.yaml 必须存在" },
      { kind: "write", target: "a", text: "allowWrite：src/*" },
      { kind: "note", target: "a", text: "随便一条说明" },
      { kind: "output", target: "a", text: "报告写入 reports/" },
    ]),
  );
  assert.equal(plan.enforceableCount, 2);
  assert.equal(plan.annotationCount, 2);
  assert.equal(plan.byPhase["before-start"]!.length, 1);
  assert.equal(plan.byPhase["during-step"]!.length, 1);
  assert.equal(plan.byPhase["on-complete"]!.length, 1);
});

test("planConstraints：未声明能力时约束性义务全部计入 uncovered", () => {
  const plan = planConstraints(
    def([
      { kind: "pre", target: "flow", text: "x" },
      { kind: "dispatch", target: "a", text: "y" },
      { kind: "note", target: "a", text: "z" },
    ]),
  );
  assert.equal(plan.uncovered.length, 2);
  assert.deepEqual(plan.uncovered.map((o) => o.capability).sort(), ["env-check", "subagent-dispatch"]);
});

test("planConstraints：声明能力后对应义务被覆盖，注解不影响覆盖判定", () => {
  const plan = planConstraints(
    def([
      { kind: "pre", target: "flow", text: "x" },
      { kind: "dispatch", target: "a", text: "y" },
      { kind: "note", target: "a", text: "z" },
    ]),
    { capabilities: ["env-check"] },
  );
  assert.equal(plan.uncovered.length, 1);
  assert.equal(plan.uncovered[0]!.kind, "dispatch");
  assert.ok(plan.obligations.find((o) => o.kind === "pre")!.covered);
  assert.ok(plan.obligations.find((o) => o.kind === "note")!.covered);
});

test("planConstraints：blocking 取契约值（pre/guard/write/timeout 阻断，其余不阻断）", () => {
  const plan = planConstraints(
    def([
      { kind: "pre", target: "flow", text: "a" },
      { kind: "guard", target: "a", text: "b" },
      { kind: "fallback", target: "a", text: "c" },
      { kind: "note", target: "a", text: "d" },
    ]),
  );
  const by = Object.fromEntries(plan.obligations.map((o) => [o.kind, o.blocking]));
  assert.deepEqual(by, { pre: true, guard: true, fallback: false, note: false });
});

test("无 constraints 的定义得到空计划", () => {
  const plan = planConstraints(def([]));
  assert.equal(plan.obligations.length, 0);
  assert.equal(plan.uncovered.length, 0);
  assert.deepEqual(plan.byPhase, {});
});

test("validate：constraints 的 kind/target/text 三类错误被检出", () => {
  const bad: Definition = {
    schema: 2,
    id: "bad",
    version: "1",
    constraints: [
      { kind: "nope", target: "flow", text: "x" } as unknown as Constraint,
      { kind: "pre", target: "no-such-step", text: "x" },
      { kind: "note", target: "flow", text: "   " },
    ],
    steps: [{ id: "a", kind: "skill", skill: "s", cc: { type: "user_ack" }, next: ["done"] }],
  };
  const codes = validate(bad).map((i) => i.code);
  assert.ok(codes.includes("E_CONSTRAINT_KIND"));
  assert.equal(codes.filter((c) => c === "E_CONSTRAINT_TARGET").length, 1);
  assert.ok(codes.includes("E_CONSTRAINT_TEXT"));
});

test("validate：合法 constraints 不产生问题", () => {
  const ok = def([
    { kind: "pre", target: "flow", text: "a" },
    { kind: "write", target: "a", text: "b" },
    { kind: "note", target: "flow", text: "c" },
  ]);
  assert.deepEqual(validate(ok).filter((i) => i.code.startsWith("E_")), []);
});

test("validate：constraints 非数组被检出", () => {
  const bad = { schema: 2, id: "b2", version: "1", constraints: {}, steps: [] } as unknown as Definition;
  assert.ok(validate(bad).some((i) => i.code === "E_CONSTRAINTS"));
});
