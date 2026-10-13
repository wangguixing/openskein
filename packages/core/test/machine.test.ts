import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce, status } from "../src/machine.ts";
import { featureFlow as def } from "../src/flows.ts";
import type { Definition } from "../src/types.ts";

const at = "2026-10-12T00:00:00Z";

test("start → 首步骤 spec + write_artifact 副作用", () => {
  const { state, effects } = reduce(def, null, {
    type: "start",
    instanceId: "i1",
    params: { requirement: "r" },
    at,
  });
  assert.equal(state.current, "spec");
  assert.equal(state.status, "running");
  assert.deepEqual(effects, [{ kind: "write_artifact", path: "specs/i1.md", content: "" }]);
});

test("advance 全流程到 done", () => {
  let s = reduce(def, null, { type: "start", instanceId: "i2", params: {}, at }).state;
  for (const step of ["spec", "plan", "implement", "review"]) {
    s = reduce(def, s, { type: "advance", step, evidence: { ok: true }, at }).state;
  }
  assert.equal(s.current, "done");
  assert.equal(s.status, "done");
  assert.deepEqual(status(def, s).next, []);
});

test("CC 不满足则 advance 抛错", () => {
  const s = reduce(def, null, { type: "start", instanceId: "i3", params: {}, at }).state;
  assert.throws(
    () => reduce(def, s, { type: "advance", step: "spec", evidence: { ok: false }, at }),
    /完成标准未满足/,
  );
});

test("步骤不匹配则抛错", () => {
  const s = reduce(def, null, { type: "start", instanceId: "i4", params: {}, at }).state;
  assert.throws(
    () => reduce(def, s, { type: "advance", step: "review", evidence: { ok: true }, at }),
    /步骤不匹配/,
  );
});

test("pause / resume / cancel", () => {
  let s = reduce(def, null, { type: "start", instanceId: "i5", params: {}, at }).state;
  s = reduce(def, s, { type: "pause", at }).state;
  assert.equal(s.status, "paused");
  s = reduce(def, s, { type: "resume", at }).state;
  assert.equal(s.status, "running");
  s = reduce(def, s, { type: "cancel", reason: "x", at }).state;
  assert.equal(s.status, "canceled");
});

const branchDef: Definition = {
  schema: 2,
  id: "br",
  version: "1",
  steps: [
    { id: "a", kind: "skill", skill: "x", cc: { type: "user_ack" }, branch: { hot: "c", default: "b" } },
    { id: "b", kind: "skill", skill: "x", cc: { type: "user_ack" }, next: ["done"] },
    { id: "c", kind: "skill", skill: "x", cc: { type: "user_ack" }, next: ["done"] },
  ],
};

test("branch 命中标签跳转对应目标", () => {
  const s = reduce(branchDef, null, { type: "start", instanceId: "b1", params: {}, at }).state;
  const r = reduce(branchDef, s, { type: "advance", step: "a", evidence: { ok: true }, branch: "hot", at });
  assert.equal(r.state.current, "c");
});

test("branch 未提供且无 next 抛无后继；未命中标签抛 E_BRANCH", () => {
  const s = reduce(branchDef, null, { type: "start", instanceId: "b2", params: {}, at }).state;
  assert.throws(
    () => reduce(branchDef, s, { type: "advance", step: "a", evidence: { ok: true }, at }),
    /无后继/,
  );
  assert.throws(
    () => reduce(branchDef, s, { type: "advance", step: "a", evidence: { ok: true }, branch: "nope", at }),
    /E_BRANCH/,
  );
});

test("status().branches 返回分支表且 next 契约不变", () => {
  const s = reduce(branchDef, null, { type: "start", instanceId: "b3", params: {}, at }).state;
  const v = status(branchDef, s);
  assert.deepEqual(v.branches, { hot: "c", default: "b" });
  assert.deepEqual(v.next, []);
});

test("workflow 步骤产出 launch_workflow Effect", () => {
  const wdef: Definition = {
    schema: 2,
    id: "w",
    version: "1",
    steps: [
      { id: "s1", kind: "workflow", workflow: "review", cc: { type: "effect_ok", effect: "launch_workflow" }, next: ["done"] },
    ],
  };
  const { effects } = reduce(wdef, null, { type: "start", instanceId: "w1", params: {}, at });
  assert.deepEqual(effects, [{ kind: "launch_workflow", name: "review" }]);
});

const awaitDef: Definition = {
  schema: 2,
  id: "aw",
  version: "1",
  state: { decision: { reducer: "replace" } },
  steps: [
    {
      id: "work",
      kind: "skill",
      skill: "x",
      effects: [{ kind: "call_tool", name: "prettier_format", args: {} }],
      cc: { type: "user_ack" },
      next: ["approve"],
    },
    {
      id: "approve",
      kind: "human",
      await: { kind: "human", question: "确认范围？", schema: { type: "boolean" } },
      cc: { type: "user_ack" },
      effects: [{ kind: "load_skill", name: "pre-check" }],
      branch: { yes: "done", no: "work" },
    },
  ],
};

test("run_command 原语：kind=tool 且 args.command 时产出 run_command", () => {
  const cdef: Definition = {
    schema: 2,
    id: "cmd",
    version: "1",
    steps: [
      {
        id: "gen",
        kind: "tool",
        tool: "gen-commit",
        args: { command: "/gen-commit" },
        cc: { type: "user_ack" },
        next: ["done"],
      },
    ],
  };
  const { effects } = reduce(cdef, null, { type: "start", instanceId: "c1", params: {}, at });
  assert.deepEqual(effects, [{ kind: "run_command", name: "/gen-commit", args: { command: "/gen-commit" } }]);
});

test("step.effects 追加在 kind 派生 Effect 之后", () => {
  const { effects } = reduce(awaitDef, null, { type: "start", instanceId: "a1", params: {}, at });
  assert.deepEqual(effects, [
    { kind: "load_skill", name: "x" },
    { kind: "call_tool", name: "prettier_format", args: {} },
  ]);
});

test("命中 await：停在当前步转入 awaiting 并产出 await_human（含 schema）", () => {
  let s = reduce(awaitDef, null, { type: "start", instanceId: "a2", params: {}, at }).state;
  s = reduce(awaitDef, s, { type: "advance", step: "work", evidence: { ok: true }, at }).state;
  assert.equal(s.status, "running");
  const r = reduce(awaitDef, s, { type: "advance", step: "approve", evidence: { ok: true }, at });
  assert.equal(r.state.status, "awaiting");
  assert.equal(r.state.current, "approve");
  assert.deepEqual(r.effects, [
    { kind: "await_human", question: "确认范围？", schema: { type: "boolean" } },
    { kind: "load_skill", name: "pre-check" },
  ]);
  assert.throws(
    () => reduce(awaitDef, r.state, { type: "advance", step: "approve", evidence: { ok: true }, at }),
    /不可 advance/,
  );
});

test("awaiting 下 resume：注入答复（evidence+patch）并按 branch 推进", () => {
  let s = reduce(awaitDef, null, { type: "start", instanceId: "a3", params: {}, at }).state;
  s = reduce(awaitDef, s, { type: "advance", step: "work", evidence: { ok: true }, at }).state;
  s = reduce(awaitDef, s, { type: "advance", step: "approve", evidence: { ok: true }, at }).state;
  const r = reduce(awaitDef, s, {
    type: "resume",
    evidence: { ok: true },
    patch: { decision: "yes" },
    branch: "yes",
    at,
  });
  assert.equal(r.state.status, "done");
  assert.deepEqual(r.state.data, { decision: "yes" });
});

test("awaiting 下 resume 可按 branch 退回上游（返工回环）", () => {
  let s = reduce(awaitDef, null, { type: "start", instanceId: "a7", params: {}, at }).state;
  s = reduce(awaitDef, s, { type: "advance", step: "work", evidence: { ok: true }, at }).state;
  s = reduce(awaitDef, s, { type: "advance", step: "approve", evidence: { ok: true }, at }).state;
  const r = reduce(awaitDef, s, {
    type: "resume",
    evidence: { ok: true },
    branch: "no",
    at,
  });
  assert.equal(r.state.current, "work");
  assert.equal(r.state.status, "running");
  assert.deepEqual(r.effects, [
    { kind: "load_skill", name: "x" },
    { kind: "call_tool", name: "prettier_format", args: {} },
  ]);
});

test("awaiting 下 resume 的 CC 未满足则抛错且状态不变", () => {
  let s = reduce(awaitDef, null, { type: "start", instanceId: "a4", params: {}, at }).state;
  s = reduce(awaitDef, s, { type: "advance", step: "work", evidence: { ok: true }, at }).state;
  s = reduce(awaitDef, s, { type: "advance", step: "approve", evidence: { ok: true }, at }).state;
  assert.throws(
    () => reduce(awaitDef, s, { type: "resume", evidence: { ok: false }, branch: "yes", at }),
    /完成标准未满足/,
  );
});

test("awaiting 可 pause；pause 后 resume 仅回到 running（不推进）", () => {
  let s = reduce(awaitDef, null, { type: "start", instanceId: "a5", params: {}, at }).state;
  s = reduce(awaitDef, s, { type: "advance", step: "work", evidence: { ok: true }, at }).state;
  s = reduce(awaitDef, s, { type: "advance", step: "approve", evidence: { ok: true }, at }).state;
  s = reduce(awaitDef, s, { type: "pause", at }).state;
  assert.equal(s.status, "paused");
  const r = reduce(awaitDef, s, { type: "resume", at });
  assert.equal(r.state.status, "running");
  assert.equal(r.state.current, "approve");
  assert.deepEqual(r.effects, []);
});

test("await.kind=signal 在 Phase 1 不构成停步等待（由 validate 拦截）", () => {
  const sdef: Definition = {
    schema: 2,
    id: "sg",
    version: "1",
    steps: [
      {
        id: "gather",
        kind: "skill",
        skill: "x",
        await: { kind: "signal" },
        cc: { type: "user_ack" },
        next: ["done"],
      },
    ],
  };
  const r0 = reduce(sdef, null, { type: "start", instanceId: "s1", params: {}, at });
  assert.deepEqual(r0.effects, [{ kind: "load_skill", name: "x" }]);
  const r1 = reduce(sdef, r0.state, { type: "advance", step: "gather", evidence: { ok: true }, at });
  assert.equal(r1.state.status, "done");
  assert.equal(r1.state.current, "done");
});

test("未声明 await 的步骤不可由 resume 推进", () => {
  const r0 = reduce(awaitDef, null, { type: "start", instanceId: "a8", params: {}, at });
  const r1 = reduce(awaitDef, r0.state, { type: "advance", step: "work", evidence: { ok: true }, at });
  assert.throws(() => reduce(awaitDef, r1.state, { type: "resume", evidence: { ok: true }, at }), /不可 resume/);
});

test("status() 暴露 data 与 awaiting（非 awaiting 时为 null）", () => {
  let s = reduce(awaitDef, null, { type: "start", instanceId: "a6", data: { decision: "x" }, at }).state;
  assert.deepEqual(status(awaitDef, s).data, { decision: "x" });
  assert.equal(status(awaitDef, s).awaiting, null);
  s = reduce(awaitDef, s, { type: "advance", step: "work", evidence: { ok: true }, at }).state;
  s = reduce(awaitDef, s, { type: "advance", step: "approve", evidence: { ok: true }, at }).state;
  const v = status(awaitDef, s);
  assert.deepEqual(v.awaiting, {
    step: "approve",
    kind: "human",
    question: "确认范围？",
    schema: { type: "boolean" },
  });
  assert.deepEqual(v.branches, { yes: "done", no: "work" });
});
