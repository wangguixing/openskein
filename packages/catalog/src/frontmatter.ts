// frontmatter.ts — 极简 YAML frontmatter 解析（仅取 name/description 等标量与数组）
export type Frontmatter = Record<string, string | string[]>;

/** 取字符串值（数组/缺失返回 undefined） */
export function asString(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function parseFrontmatter(content: string): Frontmatter {
  const text = content.replace(/^\uFEFF/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const body = m[1] ?? "";
  const fm: Frontmatter = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const mm = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine);
    if (!mm) continue;
    const key = mm[1] as string;
    const val = (mm[2] ?? "").trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0);
    } else {
      fm[key] = val.replace(/^["']|["']$/g, "");
    }
  }
  return fm;
}
