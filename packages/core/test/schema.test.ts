import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, CURRENT_SCHEMA } from "../src/schema.ts";
import { featureFlow } from "../src/flows.ts";
import type { Definition } from "../src/types.ts";

test("当前版本定义无需迁移", () => {
  const r = migrate(featureFlow);
  assert.equal(r.changed, false);
  assert.deepEqual(r.applied, []);
  assert.equal(r.def.schema, CURRENT_SCHEMA);
});

test("v1 定义迁移到 v2：补空 state 并留痕", () => {
  const v1 = { schema: 1, id: "old", version: "1", steps: [] } as unknown as Definition;
  const r = migrate(v1);
  assert.equal(r.changed, true);
  assert.deepEqual(r.applied, ["state-context"]);
  assert.equal(r.def.schema, 2);
  assert.deepEqual(r.def.state, {});
  // 迁移不可变：原定义不被改写
  assert.equal((v1 as unknown as Record<string, unknown>).schema, 1);
});

test("v1 定义已有的 state 声明在迁移中保留", () => {
  const v1 = {
    schema: 1,
    id: "old2",
    version: "1",
    state: { findings: { reducer: "append" } },
    steps: [],
  } as unknown as Definition;
  const r = migrate(v1);
  assert.deepEqual(r.def.state, { findings: { reducer: "append" } });
});

test("迁移幂等：已是 v2 再迁移结果不变", () => {
  const once = migrate({ schema: 1, id: "old3", version: "1", steps: [] } as unknown as Definition).def;
  const twice = migrate(once);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.def, once);
});

test("缺少迁移路径时抛错", () => {
  const old = structuredClone(featureFlow) as Definition;
  old.schema = 0;
  assert.throws(() => migrate(old), /缺少 schema 0 → 1 的迁移/);
});
