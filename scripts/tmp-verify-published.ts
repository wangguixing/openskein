// 临时：核对线上 @openskein/mcp@0.1.2 的产物真实内容（用后删除）
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const distPath = process.argv[2];
const js = readFileSync(distPath, "utf8");

// 1) 找出所有 version 字面量
const found = [...js.matchAll(/version:\s*"([^"]*)"/g)].map((m) => m[1]);
console.log("version 字面量:", JSON.stringify(found));

// 2) Server 构造上下文
const i = js.indexOf("capabilities");
console.log("Server 构造处:", JSON.stringify(js.slice(Math.max(0, i - 130), i + 30)));

// 3) 真实加载并调用导出
const mod = await import(pathToFileURL(distPath).href);
console.log("导出符号:", Object.keys(mod).join(", "));
try {
  const specs = mod.buildSpecs(process.cwd());
  console.log("工具数:", Object.keys(specs).length);
  console.log("工具名:", Object.keys(specs).sort().join(","));
} catch (e) {
  console.log("buildSpecs 调用失败:", e.message);
}
