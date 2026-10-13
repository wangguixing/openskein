import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/simulate.ts";
import { featureFlow } from "../src/flows.ts";
import type { Definition } from "../src/types.ts";

test("simulate 重放 start → advance 两步", () => {
  const at = "2026-10-12T00:00:00Z";
  const sim = simulate(featureFlow, [
    { type: "start", instanceId: "s1", at },
    { type: "advance", step: "spec", evidence: { ok: true }, at },
  ]);
  assert.equal(sim.steps.length, 2);
  assert.equal(sim.steps[0]!.state.current, "spec");
  assert.equal(sim.steps[1]!.state.current, "plan");
  assert.equal(sim.final?.current, "plan");
});

test("simulate 遇非法事件抛错（CC 不满足）", () => {
  assert.throws(
    () =>
      simulate(featureFlow, [
        { type: "start", instanceId: "s2", at: "t" },
        { type: "advance", step: "spec", evidence: { ok: false }, at: "t" },
      ]),
    /完成标准未满足/,
  );
});

const awaitFlow: Definition = {
  schema: 2,
  id: "sim-aw",
  version: "1",
  state: { decision: { reducer: "replace" }, findings: { reducer: "append" } },
  steps: [
    { id: "work", kind: "skill", skill: "x", cc: { type: "user_ack" }, next: ["approve"] },
    {
      id: "approve",
      kind: "human",
      await: { kind: "human", question: "确认？" },
      cc: { type: "user_ack" },
      next: ["done"],
    },
  ],
};

test("simulate 重放 await → resume 的完整序列（含 patch 累积）", () => {
  const at = "2026-10-12T00:00:00Z";
  const sim = simulate(awaitFlow, [
    { type: "start", instanceId: "s3", data: { findings: ["a"] }, at },
    { type: "advance", step: "work", evidence: { ok: true }, patch: { findings: ["b"] }, at },
    { type: "advance", step: "approve", evidence: { ok: true }, at },
    { type: "resume", evidence: { ok: true }, patch: { decision: "yes" }, at },
  ]);
  assert.equal(sim.steps.length, 4);
  assert.equal(sim.steps[2]!.state.status, "awaiting");
  assert.equal(sim.steps[2]!.state.current, "approve");
  assert.deepEqual(sim.steps[2]!.effects, [{ kind: "await_human", question: "确认？" }]);
  assert.deepEqual(sim.final?.data, { findings: ["a", "b"], decision: "yes" });
  assert.equal(sim.final?.status, "done");
});
