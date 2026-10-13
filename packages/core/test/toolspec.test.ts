import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsStore } from "../src/store.ts";
import { createTools } from "../src/tools.ts";
import { featureFlow } from "../src/flows.ts";
import { buildToolSpecs } from "../src/toolspec.ts";
import type { Definition } from "../src/types.ts";

function impl() {
  const store = createFsStore({ dir: mkdtempSync(join(tmpdir(), "skein-ts-")) });
  return createTools({ defs: { feature: featureFlow }, store, now: () => "t" });
}

test("buildToolSpecs 暴露 8 个工具", () => {
  assert.deepEqual(Object.keys(buildToolSpecs(impl())).sort(), [
    "skein_advance",
    "skein_await",
    "skein_cancel",
    "skein_pause",
    "skein_resume",
    "skein_start",
    "skein_status",
    "skein_validate",
  ]);
});

test("skein_start → skein_status 经 spec.execute 生效", async () => {
  const specs = buildToolSpecs(impl());
  await specs.skein_start!.execute({ defId: "feature", params: '{"instanceId":"z1"}' });
  const st = (await specs.skein_status!.execute({ instanceId: "z1" })) as { step: string };
  assert.equal(st.step, "spec");
});

const awaitFlow: Definition = {
  schema: 2,
  id: "gw",
  version: "1",
  state: { decision: { reducer: "replace" } },
  steps: [
    { id: "work", kind: "skill", skill: "x", cc: { type: "user_ack" }, next: ["approve"] },
    {
      id: "approve",
      kind: "human",
      await: { kind: "human", question: "确认？", schema: { type: "boolean" } },
      cc: { type: "user_ack" },
      branch: { yes: "done", no: "work" },
    },
  ],
};

test("skein_advance → skein_await → skein_resume(patch) 端到端", async () => {
  const store = createFsStore({ dir: mkdtempSync(join(tmpdir(), "skein-aw-")) });
  const specs = buildToolSpecs(createTools({ defs: { gw: awaitFlow }, store, now: () => "t" }));
  await specs.skein_start!.execute({ defId: "gw", params: '{"instanceId":"g1"}' });
  await specs.skein_advance!.execute({ instanceId: "g1", step: "work", evidence: '{"ok":true}' });
  const advanced = (await specs.skein_advance!.execute({
    instanceId: "g1",
    step: "approve",
    evidence: '{"ok":true}',
  })) as { state: { status: string } };
  assert.equal(advanced.state.status, "awaiting");
  const pending = (await specs.skein_await!.execute({ instanceId: "g1" })) as {
    awaiting: { step: string; question?: string } | null;
  };
  assert.equal(pending.awaiting?.step, "approve");
  assert.equal(pending.awaiting?.question, "确认？");
  const resumed = (await specs.skein_resume!.execute({
    instanceId: "g1",
    evidence: '{"ok":true}',
    patch: '{"decision":"yes"}',
    branch: "yes",
  })) as { state: { status: string; data: Record<string, unknown> } };
  assert.equal(resumed.state.status, "done");
  assert.deepEqual(resumed.state.data, { decision: "yes" });
});

test("advance 可携 patch；未传 patch 时不改动 data", async () => {
  const store = createFsStore({ dir: mkdtempSync(join(tmpdir(), "skein-pt-")) });
  const specs = buildToolSpecs(createTools({ defs: { gw: awaitFlow }, store, now: () => "t" }));
  await specs.skein_start!.execute({ defId: "gw", params: '{"instanceId":"g2"}' });
  const noPatch = (await specs.skein_advance!.execute({
    instanceId: "g2",
    step: "work",
    evidence: '{"ok":true}',
  })) as { state: { data: Record<string, unknown> } };
  assert.deepEqual(noPatch.state.data, {});
  const withPatch = (await specs.skein_advance!.execute({
    instanceId: "g2",
    step: "approve",
    evidence: '{"ok":true}',
    patch: '{"decision":"pending"}',
  })) as { state: { data: Record<string, unknown> } };
  assert.deepEqual(withPatch.state.data, { decision: "pending" });
});
