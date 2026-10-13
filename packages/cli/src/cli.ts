// cli.ts — 命令行入口（runCli 可注入/可测；bin 只做 argv/输出）
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { validate, simulate, migrate, createFsStore, createTools, loadDefinitions, isDefinition, planConstraints, checkContract } from "@openskein/core";
import type { Definition, Issue, WorkflowEvent } from "@openskein/core";
import { installKit, verifyKit, uninstallKit } from "./kit.ts";
import { getCatalog, validateCatalog, validateRefs, loadTargets } from "@openskein/catalog";

export interface CliResult {
  code: number;
  lines: string[];
}

const USAGE = [
  "skein <command>",
  "  validate <path...>                              静态校验工作流定义（可多路径，按 id 合并）",
  "  obligations <path...> [--caps a,b,c] [--verbose]  输出适配层义务计划（constraints 编译为可执行义务）",
  "  list <dir...>                                   列出工作流定义（可多路径）",
  "  sim <file> --events '<json>'                    干跑（重放事件，打印迁移与副作用；`@file` 读事件数组文件）",
  "  status <instanceId> --def <file> --state <dir>  查看实例状态",
  "  check <configRoot> [--config <file>]            校验配置仓资源图与引用",
  "  install <kitDir> --target <dir>                 安装 kit（skills/agents/commands/flows）",
  "  doctor --target <dir>                           校验已安装 kit（哈希）",
  "  uninstall --target <dir>                        按 lockfile 卸载 kit",
].join("\n");

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** 位置参数（排除 --flag 及其取值，避免把 flag 的值当成路径） */
function positional(args: string[], valueFlags: string[] = []): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (valueFlags.includes(a)) i++; // 跳过该 flag 的取值
      continue;
    }
    out.push(a);
  }
  return out;
}

/** 单文件按「定义」判定（缺 id 视为非定义，避免把事件数组等旁挂 JSON 当定义） */
function loadDefFile(file: string): Definition | null {
  const v = JSON.parse(readFileSync(file, "utf8")) as unknown;
  return isDefinition(v) ? v : null;
}

function loadDefs(p: string): Definition[] {
  const abs = resolve(p);
  if (!existsSync(abs)) throw new Error(`路径不存在: ${p}`);
  if (statSync(abs).isDirectory()) return loadDefinitions(abs);
  const def = loadDefFile(abs);
  if (!def) throw new Error(`不是工作流定义（缺少 id）: ${p}`);
  return [def];
}

export function runCli(argv: string[]): CliResult {
  const [cmd, ...rest] = argv;
  const lines: string[] = [];
  try {
    switch (cmd) {
      case "validate": {
        const targets = positional(rest, ["--caps", "--config"]);
        if (targets.length === 0) return { code: 2, lines: [USAGE] };
        let bad = 0;
        const seen = new Set<string>();
        for (const target of targets) {
          for (const raw of loadDefs(target)) {
            const { def } = migrate(raw);
            if (seen.has(def.id)) continue;
            seen.add(def.id);
            const issues: Issue[] = validate(def);
            const errors = issues.filter((i) => i.code.startsWith("E_"));
            const warns = issues.filter((i) => i.code.startsWith("W_"));
            if (errors.length === 0) {
              lines.push(`✔ ${def.id} 无错误${warns.length ? `（${warns.length} 条告警）` : ""}`);
              for (const w of warns) lines.push(`   ! [${w.code}] ${w.message}`);
            } else {
              bad++;
              lines.push(`✖ ${def.id} ${errors.length} 个问题${warns.length ? `（另 ${warns.length} 条告警）` : ""}`);
              for (const i of errors) lines.push(`   - [${i.code}] ${i.message}`);
              for (const w of warns) lines.push(`   ! [${w.code}] ${w.message}`);
            }
          }
        }
        return { code: bad > 0 ? 1 : 0, lines };
      }

      case "obligations": {
        const targets = positional(rest, ["--caps", "--config"]);
        if (targets.length === 0) return { code: 2, lines: [USAGE] };
        const capsArg = flag(rest, "--caps");
        const capabilities = capsArg ? capsArg.split(",").map((s) => s.trim()).filter(Boolean) : [];
        const verbose = rest.includes("--verbose");
        const contractProblems = checkContract();
        if (contractProblems.length > 0) {
          lines.push("✖ 约束契约自检失败：");
          for (const p of contractProblems) lines.push(`   - ${p}`);
          return { code: 1, lines };
        }
        lines.push(`能力声明：${capabilities.length ? capabilities.join(", ") : "(未声明，全部约束性义务计为未覆盖)"}`);
        const seen = new Set<string>();
        let totalOblig = 0;
        let totalEnforceable = 0;
        let totalUncovered = 0;
        const phaseTotals: Record<string, number> = {};
        const capTotals: Record<string, number> = {};
        for (const target of targets) {
          for (const raw of loadDefs(target)) {
            const { def } = migrate(raw);
            if (seen.has(def.id)) continue;
            seen.add(def.id);
            const plan = planConstraints(def, { capabilities });
            totalOblig += plan.obligations.length;
            totalEnforceable += plan.enforceableCount;
            totalUncovered += plan.uncovered.length;
            for (const o of plan.obligations) {
              phaseTotals[o.phase] = (phaseTotals[o.phase] ?? 0) + 1;
              capTotals[o.capability] = (capTotals[o.capability] ?? 0) + 1;
            }
            const flag = plan.uncovered.length > 0 ? "✖" : "✔";
            lines.push(
              `${flag} ${def.id}  义务 ${plan.enforceableCount} · 注解 ${plan.annotationCount} · 未覆盖 ${plan.uncovered.length}`,
            );
            if (verbose) {
              for (const o of plan.obligations) {
                const mark = o.covered ? " " : "!";
                lines.push(`   ${mark} [${o.phase}] ${o.kind}/${o.target}${o.blocking ? " (blocking)" : ""} cap=${o.capability}`);
              }
            }
            for (const o of plan.uncovered)
              lines.push(`   ! 未覆盖：[${o.phase}] ${o.kind}/${o.target} 需能力 ${o.capability}`);
          }
        }
        lines.push("");
        lines.push(`合计：义务 ${totalEnforceable} / 注解 ${totalOblig - totalEnforceable} / 未覆盖 ${totalUncovered}`);
        lines.push(`按时机：${Object.entries(phaseTotals).sort().map(([k, v]) => `${k}=${v}`).join("  ")}`);
        lines.push(`按能力：${Object.entries(capTotals).sort().map(([k, v]) => `${k}=${v}`).join("  ")}`);
        return { code: totalUncovered > 0 ? 1 : 0, lines };
      }

      case "list": {
        const targets = positional(rest, ["--caps", "--config"]);
        if (targets.length === 0) return { code: 2, lines: [USAGE] };
        const seen = new Set<string>();
        for (const target of targets) {
          for (const d of loadDefs(target)) {
            if (seen.has(d.id)) continue;
            seen.add(d.id);
            lines.push(`${d.id}@${d.version}${d.summary ? `  ${d.summary}` : ""}`);
          }
        }
        return { code: 0, lines };
      }

      case "sim": {
        const file = positional(rest, ["--events"])[0];
        const evArg = flag(rest, "--events");
        if (!file || !evArg) return { code: 2, lines: [USAGE] };
        const raw = evArg.startsWith("@") ? readFileSync(evArg.slice(1), "utf8") : evArg;
        const events = JSON.parse(raw) as WorkflowEvent[];
        const def = migrate(loadDefs(file)[0] as Definition).def;
        const sim = simulate(def, events);
        for (const s of sim.steps) {
          const step = "step" in s.event ? `:${(s.event as { step?: string }).step}` : "";
          const wait = s.state.status === "awaiting" ? " await=human" : "";
          lines.push(
            `→ ${s.event.type}${step}  step=${s.state.current} status=${s.state.status}${wait} data=${JSON.stringify(s.state.data ?? {})} effects=${s.effects.length}`,
          );
        }
        lines.push(`final: ${sim.final ? `${sim.final.current}/${sim.final.status}` : "(none)"}`);
        return { code: 0, lines };
      }

      case "status": {
        const instanceId = rest[0];
        const defFile = flag(rest, "--def");
        const stateDir = flag(rest, "--state");
        if (!instanceId || !defFile || !stateDir) return { code: 2, lines: [USAGE] };
        const def = migrate(loadDefs(defFile)[0] as Definition).def;
        const store = createFsStore({ dir: stateDir });
        const tools = createTools({ defs: { [def.id]: def }, store });
        lines.push(JSON.stringify(tools.skein_status({ instanceId })));
        return { code: 0, lines };
      }

      case "check": {
        const root = rest[0];
        if (!root) return { code: 2, lines: [USAGE] };
        const abs = resolve(root);
        const cfg = flag(rest, "--config") ?? join(abs, ".skein", "catalog.json");
        const targets = existsSync(cfg) ? loadTargets(cfg) : undefined;
        const cat = getCatalog({ configRoot: abs, targets });
        const dup = validateCatalog(cat.resources);
        const dangling = validateRefs(cat.resources, cat.graph.edges);
        lines.push(
          `资源 ${cat.resources.length} | 引用 ${cat.graph.edges.length} | 重复 ${dup.length} | 悬空 ${dangling.length}`,
        );
        for (const d of dup) lines.push(`  dup  ${d.message}`);
        for (const d of dangling) lines.push(`  ref  ${d.message}`);
        return { code: dup.length + dangling.length > 0 ? 1 : 0, lines };
      }

      case "install": {
        const kitDir = rest[0];
        const target = resolve(flag(rest, "--target") ?? process.cwd());
        if (!kitDir) return { code: 2, lines: [USAGE] };
        const r = installKit(resolve(kitDir), target);
        lines.push(`✔ 已安装 ${r.copied} 个文件 → ${r.target}`);
        return { code: 0, lines };
      }

      case "doctor": {
        const target = resolve(flag(rest, "--target") ?? process.cwd());
        const v = verifyKit(target);
        if (v.ok) {
          lines.push("✔ kit 校验通过");
          return { code: 0, lines };
        }
        lines.push(`✖ kit 校验失败：缺失 ${v.missing.length}，改动 ${v.changed.length}`);
        for (const m of v.missing) lines.push(`   missing ${m}`);
        for (const c of v.changed) lines.push(`   changed ${c}`);
        return { code: 1, lines };
      }

      case "uninstall": {
        const target = resolve(flag(rest, "--target") ?? process.cwd());
        lines.push(`✔ 已卸载 ${uninstallKit(target)} 个文件`);
        return { code: 0, lines };
      }

      case undefined:
      case "help":
      case "--help":
      case "-h":
        return { code: 0, lines: [USAGE] };

      default:
        return { code: 2, lines: [`未知命令: ${cmd}`, USAGE] };
    }
  } catch (e) {
    return { code: 1, lines: [`✖ ${(e as Error).message}`] };
  }
}
