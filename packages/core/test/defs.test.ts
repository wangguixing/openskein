import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDefinitions, loadDefinitionsFrom } from "../src/defs.ts";

test("loadDefinitions 缺目录返回空", () => {
  assert.deepEqual(loadDefinitions(join(tmpdir(), `nope-${Date.now()}`)), []);
});

test("loadDefinitions 读取 JSON 定义", () => {
  const dir = mkdtempSync(join(tmpdir(), "skein-def-"));
  writeFileSync(join(dir, "x.json"), JSON.stringify({ schema: 1, id: "x", version: "1", steps: [] }));
  const defs = loadDefinitions(dir);
  assert.equal(defs.length, 1);
  assert.equal(defs[0]!.id, "x");
});

test("loadDefinitions 跳过非定义 JSON（事件数组等旁挂文件）", () => {
  const dir = mkdtempSync(join(tmpdir(), "skein-def-skip-"));
  writeFileSync(join(dir, "x.json"), JSON.stringify({ schema: 2, id: "x", version: "1", steps: [] }));
  writeFileSync(join(dir, "x.events.json"), JSON.stringify([{ type: "start", instanceId: "i" }]));
  writeFileSync(join(dir, "notes.json"), JSON.stringify({ note: "无 id" }));
  const defs = loadDefinitions(dir);
  assert.equal(defs.length, 1);
  assert.equal(defs[0]!.id, "x");
});

test("loadDefinitionsFrom 合并多目录，同 id 后者覆盖前者", () => {
  const base = mkdtempSync(join(tmpdir(), "skein-defs-"));
  const g = join(base, "global", "flows");
  const p = join(base, "project", "flows");
  mkdirSync(g, { recursive: true });
  mkdirSync(p, { recursive: true });
  writeFileSync(join(g, "a.json"), JSON.stringify({ schema: 1, id: "a", version: "g", steps: [] }));
  writeFileSync(join(g, "b.json"), JSON.stringify({ schema: 1, id: "b", version: "g", steps: [] }));
  writeFileSync(join(p, "b.json"), JSON.stringify({ schema: 1, id: "b", version: "p", steps: [] }));
  const defs = loadDefinitionsFrom([g, p]);
  assert.equal(defs.length, 2);
  assert.equal(defs.find((d) => d.id === "b")!.version, "p");
});
