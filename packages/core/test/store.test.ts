import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsStore } from "../src/store.ts";
import { createTools } from "../src/tools.ts";
import { featureFlow as def } from "../src/flows.ts";

const newDir = (): string => mkdtempSync(join(tmpdir(), "skein-"));

test("store append + readAll 往返", () => {
  const store = createFsStore({ dir: newDir() });
  store.append("a", { type: "start", instanceId: "a", at: "t" });
  assert.deepEqual(store.readAll("a"), [{ type: "start", instanceId: "a", at: "t" }]);
});

test("tools 端到端：start → advance → status", () => {
  const store = createFsStore({ dir: newDir() });
  const tools = createTools({ defs: { feature: def }, store, now: () => "2026-10-12T00:00:00Z" });

  const r = tools.skein_start({ defId: "feature", params: { instanceId: "i9" } });
  assert.equal(r.state.current, "spec");

  tools.skein_advance({ instanceId: "i9", step: "spec", evidence: { ok: true } });
  const st = tools.skein_status({ instanceId: "i9" });
  assert.equal(st.step, "plan");

  assert.deepEqual(tools.skein_validate({ defId: "feature" }), []);
});
