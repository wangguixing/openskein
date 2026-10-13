import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch, reduce } from "../src/machine.ts";
import type { Definition } from "../src/types.ts";

const at = "2026-10-12T00:00:00Z";

const spec: Definition["state"] = {
  tier: { reducer: "replace" },
  findings: { reducer: "append" },
  meta: { reducer: "merge" },
};

test("replace：默认策略覆盖旧值（含 null）", () => {
  assert.deepEqual(applyPatch({ tier: "a" }, { tier: "b" }, spec), { tier: "b" });
  assert.deepEqual(applyPatch({ tier: "a" }, { tier: null }, spec), { tier: null });
});

test("replace：值为 undefined 时删除该键", () => {
  assert.deepEqual(applyPatch({ tier: "a", keep: 1 }, { tier: undefined }, spec), { keep: 1 });
});

test("未声明 reducer 的键按 replace 处理", () => {
  assert.deepEqual(applyPatch({ x: 1 }, { x: 2, y: 3 }, undefined), { x: 2, y: 3 });
});

test("append：数组拼接；空数组不清空且保持原引用", () => {
  const base = { findings: ["f1"] };
  assert.deepEqual(applyPatch(base, { findings: ["f2"] }, spec), { findings: ["f1", "f2"] });
  const kept = applyPatch(base, { findings: [] }, spec);
  assert.equal(kept.findings, base.findings);
  assert.deepEqual(kept.findings, ["f1"]);
});

test("append：非数组值退化为覆盖", () => {
  assert.deepEqual(applyPatch({ findings: ["f1"] }, { findings: "x" }, spec), { findings: "x" });
});

test("merge：对象浅合并；null/非对象跳过且不清空", () => {
  assert.deepEqual(applyPatch({ meta: { a: 1 } }, { meta: { b: 2 } }, spec), { meta: { a: 1, b: 2 } });
  assert.deepEqual(applyPatch({ meta: { a: 1 } }, { meta: null }, spec), { meta: { a: 1 } });
  assert.deepEqual(applyPatch({ meta: { a: 1 } }, { meta: ["x"] }, spec), { meta: { a: 1 } });
});

test("applyPatch 不可变：不修改入参", () => {
  const base = { findings: ["f1"], meta: { a: 1 } };
  const out = applyPatch(base, { findings: ["f2"], meta: { b: 2 } }, spec);
  assert.deepEqual(base, { findings: ["f1"], meta: { a: 1 } });
  assert.notEqual(out, base);
});

test("无 patch 时返回等值新对象", () => {
  const base = { a: 1 };
  const out = applyPatch(base, undefined, spec);
  assert.deepEqual(out, base);
  assert.notEqual(out, base);
});

const def: Definition = {
  schema: 2,
  id: "ctx",
  version: "1",
  state: { findings: { reducer: "append" }, tier: { reducer: "replace" } },
  steps: [
    {
      id: "s1",
      kind: "skill",
      skill: "x",
      cc: { type: "user_ack" },
      effects: [{ kind: "call_tool", name: "t", args: {} }],
      next: ["s2"],
    },
    { id: "s2", kind: "skill", skill: "y", cc: { type: "user_ack" }, next: ["done"] },
  ],
};

test("start 携带 data 时按 reducer 初始化上下文", () => {
  const { state } = reduce(def, null, {
    type: "start",
    instanceId: "c1",
    data: { findings: ["a"], tier: "hot" },
    at,
  });
  assert.deepEqual(state.data, { findings: ["a"], tier: "hot" });
});

test("advance 的 patch 按 per-key reducer 合并进 data 并随状态留存", () => {
  let s = reduce(def, null, { type: "start", instanceId: "c2", data: { findings: ["a"] }, at }).state;
  const r = reduce(def, s, {
    type: "advance",
    step: "s1",
    evidence: { ok: true },
    patch: { findings: ["b"], tier: "hot" },
    at,
  });
  assert.deepEqual(r.state.data, { findings: ["a", "b"], tier: "hot" });
  s = reduce(def, r.state, { type: "advance", step: "s2", evidence: { ok: true }, patch: { tier: "cold" }, at }).state;
  assert.deepEqual(s.data, { findings: ["a", "b"], tier: "cold" });
});
