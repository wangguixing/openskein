import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/validate.ts";
import { simulate } from "../src/simulate.ts";
import { featureFlow, bugFlow, reviewFlow, builtinFlows } from "../src/flows.ts";
import type { Issue } from "../src/types.ts";

const errors = (issues: Issue[]): Issue[] => issues.filter((i) => i.code.startsWith("E_"));

test("所有内置流程静态校验无错误", () => {
  for (const def of builtinFlows) {
    assert.deepEqual(errors(validate(def)), [], `${def.id} 应有 0 个错误`);
  }
});

test("review 流程：await 中断 → resume 注入结论", () => {
  const at = "2026-10-12T00:00:00Z";
  const sim = simulate(reviewFlow, [
    { type: "start", instanceId: "r1", at },
    { type: "advance", step: "review", evidence: { ok: true }, at },
    { type: "advance", step: "approve", evidence: { ok: true }, at },
    { type: "resume", evidence: { ok: true }, patch: { decision: "approve" }, branch: "approve", at },
  ]);
  assert.equal(sim.steps[2]!.state.status, "awaiting");
  assert.deepEqual(sim.steps[2]!.effects, [
    { kind: "await_human", question: "确认审查结论？", schema: { type: "boolean" } },
  ]);
  assert.equal(sim.final?.status, "done");
  assert.deepEqual(sim.final?.data, { decision: "approve" });
});

test("review 流程：返工回环被报告为告警而非错误", () => {
  const issues = validate(reviewFlow);
  assert.deepEqual(errors(issues), []);
  assert.ok(issues.some((i) => i.code === "W_CYCLE"));
});

test("bug 流程可推进到提交步骤", () => {
  const at = "2026-10-12T00:00:00Z";
  const sim = simulate(bugFlow, [
    { type: "start", instanceId: "b1", at },
    { type: "advance", step: "report", evidence: { ok: true }, at },
    { type: "advance", step: "diagnose", evidence: { ok: true }, at },
  ]);
  assert.equal(sim.final?.current, "reproduce");
});

test("feature 仍是内置之一", () => {
  assert.ok(builtinFlows.some((d) => d.id === featureFlow.id));
});
