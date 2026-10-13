import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { featureFlow } from "@openskein/core";
import { runCli } from "../src/cli.ts";

function flowFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "skein-cli-"));
  const f = join(dir, "feature.json");
  writeFileSync(f, JSON.stringify(featureFlow));
  return f;
}

test("validate 合法定义 → code 0", () => {
  const r = runCli(["validate", flowFile()]);
  assert.equal(r.code, 0);
  assert.ok(r.lines.some((l) => l.includes("✔ feature")));
});

test("validate 非法定义 → code 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "skein-cli-"));
  const bad = structuredClone(featureFlow);
  bad.steps[0]!.next = ["nope"];
  const f = join(dir, "bad.json");
  writeFileSync(f, JSON.stringify(bad));
  const r = runCli(["validate", f]);
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => l.includes("E_DANGLING")));
});

test("sim 干跑 → final 到 plan", () => {
  const events = JSON.stringify([
    { type: "start", instanceId: "t", at: "t" },
    { type: "advance", step: "spec", evidence: { ok: true }, at: "t" },
  ]);
  const r = runCli(["sim", flowFile(), "--events", events]);
  assert.equal(r.code, 0);
  assert.ok(r.lines.some((l) => l.startsWith("final: plan/")));
});

test("obligations：--caps 的取值不会被当成路径（positional 解析）", () => {
  const dir = mkdtempSync(join(tmpdir(), "skein-obl-"));
  const def = structuredClone(featureFlow);
  def.constraints = [
    { kind: "pre", target: "flow", text: "tracker.yaml 必须存在" },
    { kind: "write", target: "spec", text: "allowWrite：specs/*" },
    { kind: "note", target: "flow", text: "说明" },
  ];
  writeFileSync(join(dir, "cx.json"), JSON.stringify(def));
  // 未声明能力 → 2 条约束性义务未覆盖 → code 1
  const a = runCli(["obligations", dir]);
  assert.equal(a.code, 1);
  assert.ok(a.lines.some((l) => l.includes("义务 2")));
  assert.ok(a.lines.some((l) => l.includes("未覆盖 2")));
  // 声明能力后全部覆盖 → code 0，且不报「路径不存在」
  const b = runCli(["obligations", dir, "--caps", "env-check,fs-scope"]);
  assert.equal(b.code, 0);
  assert.ok(!b.lines.some((l) => l.includes("路径不存在")));
  assert.ok(b.lines.some((l) => l.includes("未覆盖 0")));
});

test("obligations：注解类不计入未覆盖", () => {
  const dir = mkdtempSync(join(tmpdir(), "skein-obl2-"));
  const def = structuredClone(featureFlow);
  def.constraints = [{ kind: "note", target: "flow", text: "仅注解" }];
  writeFileSync(join(dir, "n.json"), JSON.stringify(def));
  const r = runCli(["obligations", dir]);
  assert.equal(r.code, 0);
  assert.ok(r.lines.some((l) => l.includes("义务 0") && l.includes("注解 1")));
});

test("list 目录 → 列出 id", () => {
  const f = flowFile();
  const r = runCli(["list", join(f, "..")]);
  assert.equal(r.code, 0);
  assert.ok(r.lines.some((l) => l.startsWith("feature@")));
});

test("install → doctor → uninstall", () => {
  const kit = mkdtempSync(join(tmpdir(), "skein-kit-"));
  mkdirSync(join(kit, "skills", "beta"), { recursive: true });
  writeFileSync(join(kit, "skills", "beta", "SKILL.md"), "---\nname: beta\n---\n");
  mkdirSync(join(kit, "flows"), { recursive: true });
  writeFileSync(join(kit, "flows", "feature.json"), JSON.stringify(featureFlow));

  const target = mkdtempSync(join(tmpdir(), "skein-target-"));
  assert.equal(runCli(["install", kit, "--target", target]).code, 0);
  assert.ok(existsSync(join(target, "skills", "beta", "SKILL.md")));
  assert.ok(existsSync(join(target, ".skein", "flows", "feature.json")));
  assert.ok(existsSync(join(target, ".skein", "kit.lock.json")));

  assert.equal(runCli(["doctor", "--target", target]).code, 0);

  writeFileSync(join(target, "skills", "beta", "SKILL.md"), "tampered");
  assert.equal(runCli(["doctor", "--target", target]).code, 1);

  assert.equal(runCli(["uninstall", "--target", target]).code, 0);
  assert.ok(!existsSync(join(target, "skills", "beta", "SKILL.md")));
});

test("check 配置仓 → 检出悬空引用 code 1", () => {
  const root = mkdtempSync(join(tmpdir(), "skein-check-"));
  mkdirSync(join(root, "skills", "alpha"), { recursive: true });
  writeFileSync(join(root, "skills", "alpha", "SKILL.md"), "---\nname: alpha\n---\n**调用**：missing\n");
  const r = runCli(["check", root]);
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => l.includes("悬空 1")));
});

test("check --config 使用自定义 targets", () => {
  const root = mkdtempSync(join(tmpdir(), "skein-check2-"));
  mkdirSync(join(root, "custom", "delta"), { recursive: true });
  writeFileSync(join(root, "custom", "delta", "SKILL.md"), "---\nname: delta\n---\n");
  const cfg = join(root, "catalog.json");
  writeFileSync(cfg, JSON.stringify({ targets: [{ kind: "skill", dir: "custom", layout: "skill-dir" }] }));
  const r = runCli(["check", root, "--config", cfg]);
  assert.equal(r.code, 0);
  assert.ok(r.lines.some((l) => l.includes("资源 1")));
});

test("install 支持 kit.json 自定义 map", () => {
  const kit = mkdtempSync(join(tmpdir(), "skein-kit2-"));
  mkdirSync(join(kit, "flowz"), { recursive: true });
  writeFileSync(join(kit, "flowz", "f.json"), JSON.stringify(featureFlow));
  writeFileSync(join(kit, "kit.json"), JSON.stringify({ map: [["flowz", ".skein/flows"]] }));

  const target = mkdtempSync(join(tmpdir(), "skein-target2-"));
  assert.equal(runCli(["install", kit, "--target", target]).code, 0);
  assert.ok(existsSync(join(target, ".skein", "flows", "f.json")));
  assert.equal(runCli(["doctor", "--target", target]).code, 0);
});

test("未知命令 → code 2", () => {
  assert.equal(runCli(["bogus"]).code, 2);
});
