// kit.ts — 安装器：把 kit 目录投影到目标配置根，并落 lockfile 供校验
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { createHash } from "node:crypto";
import { skeinPaths } from "@openskein/core";

/** 默认映射：kit 子目录 → 目标子目录（可被 kitDir/kit.json 覆盖） */
const DEFAULT_MAP: ReadonlyArray<[string, string]> = [
  ["skills", "skills"],
  ["agents", "agents"],
  ["commands", "commands"],
  ["flows", ".skein/flows"],
];

export interface KitConfig {
  map?: Array<[string, string]>;
}

/** 读取 kit 的映射配置（kitDir/kit.json 的 map 字段，缺失则用默认） */
export function kitMap(kitDir: string): ReadonlyArray<[string, string]> {
  const cfg = join(kitDir, "kit.json");
  if (!existsSync(cfg)) return DEFAULT_MAP;
  const raw = JSON.parse(readFileSync(cfg, "utf8")) as KitConfig;
  return raw.map && raw.map.length > 0 ? raw.map : DEFAULT_MAP;
}

function hash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function walk(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

export interface KitLock {
  kit: string;
  installedAt: string;
  files: Record<string, string>;
}

export interface InstallResult {
  target: string;
  copied: number;
  lockPath: string;
}

const lockPathFor = (targetDir: string): string => skeinPaths(targetDir).lockPath;

export function installKit(kitDir: string, targetDir: string): InstallResult {
  const files: Record<string, string> = {};
  let copied = 0;
  for (const [src, dst] of kitMap(kitDir)) {
    const srcAbs = join(kitDir, src);
    if (!existsSync(srcAbs)) continue;
    for (const rel of walk(srcAbs)) {
      const buf = readFileSync(join(srcAbs, rel));
      const destRel = `${dst}/${rel}`.replace(/\\/g, "/");
      const to = join(targetDir, destRel);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, buf);
      files[destRel] = hash(buf);
      copied++;
    }
  }
  const lockPath = lockPathFor(targetDir);
  mkdirSync(dirname(lockPath), { recursive: true });
  const lock: KitLock = { kit: kitDir, installedAt: new Date().toISOString(), files };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");
  return { target: targetDir, copied, lockPath };
}

export interface VerifyResult {
  ok: boolean;
  missing: string[];
  changed: string[];
  extra: string[];
}

export function verifyKit(targetDir: string): VerifyResult {
  const lockPath = lockPathFor(targetDir);
  if (!existsSync(lockPath)) return { ok: false, missing: ["kit.lock.json"], changed: [], extra: [] };
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as KitLock;
  const missing: string[] = [];
  const changed: string[] = [];
  const expected = new Set<string>();
  for (const [rel, h] of Object.entries(lock.files)) {
    expected.add(rel);
    const p = join(targetDir, rel);
    if (!existsSync(p)) {
      missing.push(rel);
      continue;
    }
    if (hash(readFileSync(p)) !== h) changed.push(rel);
  }
  // 多余文件：以 lock 记录的目标根目录为准扫描（不再依赖固定 MAP）
  const extra: string[] = [];
  const roots = [...new Set(Object.keys(lock.files).map((r) => r.split("/")[0] as string))];
  for (const root of roots) {
    const rootAbs = join(targetDir, root);
    if (!existsSync(rootAbs)) continue;
    for (const rel of walk(rootAbs)) {
      const destRel = `${root}/${rel}`.replace(/\\/g, "/");
      if (!expected.has(destRel)) extra.push(destRel);
    }
  }
  return { ok: missing.length === 0 && changed.length === 0, missing, changed, extra };
}

/** 卸载：按 lockfile 删除已投影文件（仅限 lock 记录项） */
export function uninstallKit(targetDir: string): number {
  const lockPath = lockPathFor(targetDir);
  if (!existsSync(lockPath)) return 0;
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as KitLock;
  let removed = 0;
  for (const rel of Object.keys(lock.files)) {
    const p = join(targetDir, rel);
    if (existsSync(p)) {
      rmSync(p, { force: true });
      removed++;
    }
  }
  rmSync(lockPath, { force: true });
  return removed;
}
