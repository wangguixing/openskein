import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { skeinPaths, skeinPathsFor, DEFAULT_BASE_DIR } from "../src/paths.ts";

test("skeinPaths 默认 .skein 布局", () => {
  const p = skeinPaths("/proj");
  assert.equal(p.base, join("/proj", ".skein"));
  assert.equal(p.flowsDir, join("/proj", ".skein", "flows"));
  assert.equal(p.eventsDir, join("/proj", ".skein", "events"));
  assert.equal(p.lockPath, join("/proj", ".skein", "kit.lock.json"));
  assert.equal(p.catalogConfig, join("/proj", ".skein", "catalog.json"));
  assert.equal(DEFAULT_BASE_DIR, ".skein");
});

test("skeinPaths 支持自定义 baseDir", () => {
  const p = skeinPaths("/proj", ".openskein");
  assert.equal(p.base, join("/proj", ".openskein"));
  assert.equal(p.eventsDir, join("/proj", ".openskein", "events"));
});

test("skeinPathsFor 由显式 base 计算布局（全局或项目）", () => {
  const p = skeinPathsFor("/root/.config/opencode/.skein");
  assert.equal(p.flowsDir, join("/root/.config/opencode/.skein", "flows"));
  assert.equal(p.eventsDir, join("/root/.config/opencode/.skein", "events"));
  assert.equal(p.lockPath, join("/root/.config/opencode/.skein", "kit.lock.json"));
});
