// handlers.ts — ToolSpec ↔ MCP 工具描述（纯函数，可测）
import type { ToolSpec } from "@openskein/core";

export interface McpProperty {
  type: string;
  description?: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, McpProperty>;
    required: string[];
  };
}

export function toMcpTools(specs: Record<string, ToolSpec>): McpTool[] {
  return Object.entries(specs).map(([name, spec]) => {
    const properties: Record<string, McpProperty> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(spec.args)) {
      properties[k] = v.description ? { type: v.type, description: v.description } : { type: v.type };
      if (v.required) required.push(k);
    }
    return { name, description: spec.description, inputSchema: { type: "object", properties, required } };
  });
}

export async function callTool(
  specs: Record<string, ToolSpec>,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const spec = specs[name];
  if (!spec) throw new Error(`未知工具: ${name}`);
  const r = await spec.execute(args ?? {});
  return typeof r === "string" ? r : JSON.stringify(r);
}
