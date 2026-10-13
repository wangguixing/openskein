// index.ts — @openskein/mcp：stdio MCP server，暴露 skein_* 工具（global + project 双作用域）
import { homedir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  DEFAULT_BASE_DIR,
  buildToolSpecs,
  createFsStore,
  createTools,
  builtinFlows,
  loadDefinitionsFrom,
  skeinPathsFor,
} from "@openskein/core";
import type { Definition, ToolSpec } from "@openskein/core";
import { callTool, toMcpTools } from "./handlers.ts";

/** 全局根：SKEIN_HOME → OPENCODE_CONFIG_DIR → ~/.config/opencode */
export function resolveGlobalRoot(explicit?: string): string {
  return (
    explicit ||
    process.env.SKEIN_HOME ||
    process.env.OPENCODE_CONFIG_DIR ||
    join(homedir(), ".config", "opencode")
  );
}

/** 在 project + global 两个作用域构建工具实现（同 id 项目覆盖全局） */
export function buildSpecs(directory: string, baseDir?: string, globalRoot?: string): Record<string, ToolSpec> {
  const base = baseDir ?? process.env.SKEIN_BASE_DIR ?? DEFAULT_BASE_DIR;
  const project = skeinPathsFor(join(directory, base));
  const global = skeinPathsFor(join(resolveGlobalRoot(globalRoot), base));

  const defs: Record<string, Definition> = {};
  for (const d of builtinFlows) defs[d.id] = d;
  for (const d of loadDefinitionsFrom([global.flowsDir, project.flowsDir])) defs[d.id] = d;

  const store = createFsStore({ dir: project.eventsDir });
  return buildToolSpecs(createTools({ defs, store }));
}

/** 构建期注入（见 scripts/build.mjs 的 define）：单一版本源 = 本包 package.json.version */
declare const __SKEIN_VERSION__: string;

export async function startServer(directory: string, baseDir?: string, globalRoot?: string): Promise<void> {
  const specs = buildSpecs(directory, baseDir, globalRoot);
  const server = new Server(
    { name: "openskein", version: __SKEIN_VERSION__ },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toMcpTools(specs) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const text = await callTool(specs, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
    return { content: [{ type: "text", text }] };
  });
  await server.connect(new StdioServerTransport());
}
