import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildToolSpecs, createFsStore, createTools, featureFlow } from "@openskein/core";
import { toMcpTools, callTool } from "../src/handlers.ts";
import type { ToolSpec } from "@openskein/core";

function specs(): Record<string, ToolSpec> {
  const store = createFsStore({ dir: mkdtempSync(join(tmpdir(), "skein-mcp-")) });
  return buildToolSpecs(createTools({ defs: { feature: featureFlow }, store, now: () => "t" }));
}

test("toMcpTools 生成 8 个工具与 inputSchema", () => {
  const tools = toMcpTools(specs());
  assert.equal(tools.length, 8);
  const start = tools.find((t) => t.name === "skein_start");
  assert.ok(start);
  assert.ok(start.inputSchema.required.includes("defId"));
  assert.equal(start.inputSchema.properties.defId?.type, "string");
  assert.ok(tools.some((t) => t.name === "skein_await"));
});

test("callTool 执行并返回字符串；未知工具抛错", async () => {
  const s = specs();
  const out = await callTool(s, "skein_start", { defId: "feature", params: '{"instanceId":"m1"}' });
  assert.ok(out.includes("spec"));
  await assert.rejects(() => callTool(s, "nope", {}), /未知工具/);
});
