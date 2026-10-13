// index.ts — @openskein/opencode 适配层：opencode 插件（注册 skein_* 工具；global + project 双作用域）
import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
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

type ZodString = ReturnType<typeof tool.schema.string>;
type OpenCodeTool = ReturnType<typeof tool>;

/** ToolSpec → opencode 工具（args 均为 string，调用方传 JSON 字符串） */
function toOpenCodeTool(spec: ToolSpec): OpenCodeTool {
  const args: Record<string, ZodString> = {};
  for (const [k, v] of Object.entries(spec.args)) {
    const s = tool.schema.string();
    args[k] = (v.required ? s : s.optional()) as unknown as ZodString;
  }
  return tool({
    description: spec.description,
    args,
    async execute(a: Record<string, unknown>) {
      const r = await spec.execute(a);
      return typeof r === "string" ? r : JSON.stringify(r);
    },
  });
}

/** 全局根：SKEIN_HOME → OPENCODE_CONFIG_DIR → ~/.config/opencode（适配层解析，core 不硬编码） */
export function resolveGlobalRoot(explicit?: string): string {
  return (
    explicit ||
    process.env.SKEIN_HOME ||
    process.env.OPENCODE_CONFIG_DIR ||
    join(homedir(), ".config", "opencode")
  );
}

export interface SkeinPluginOptions {
  /** 状态/定义根目录名（默认取 SKEIN_BASE_DIR 或 .skein） */
  baseDir?: string;
  /** 全局根目录（默认由 resolveGlobalRoot 解析） */
  globalRoot?: string;
  /** 是否加载全局定义（默认 true） */
  global?: boolean;
}

/** 构造 opencode 插件；定义按 global → project 合并（同 id 项目覆盖全局） */
export function createSkeinPlugin(options: SkeinPluginOptions = {}): Plugin {
  return async ({ directory }) => {
    const baseDir = options.baseDir ?? process.env.SKEIN_BASE_DIR ?? DEFAULT_BASE_DIR;
    const project = skeinPathsFor(join(directory, baseDir));

    const flowDirs: string[] = [];
    if (options.global !== false) {
      const global = skeinPathsFor(join(resolveGlobalRoot(options.globalRoot), baseDir));
      flowDirs.push(global.flowsDir);
    }
    flowDirs.push(project.flowsDir);

    const defs: Record<string, Definition> = {};
    for (const d of builtinFlows) defs[d.id] = d;
    for (const d of loadDefinitionsFrom(flowDirs)) defs[d.id] = d;

    const store = createFsStore({ dir: project.eventsDir });
    const impl = createTools({ defs, store });

    const toolset: Record<string, OpenCodeTool> = {};
    for (const [name, spec] of Object.entries(buildToolSpecs(impl))) {
      toolset[name] = toOpenCodeTool(spec);
    }
    return { tool: toolset };
  };
}

export const SkeinPlugin: Plugin = createSkeinPlugin();
export default SkeinPlugin;
