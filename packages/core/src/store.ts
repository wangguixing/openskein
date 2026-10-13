// store.ts — 事件存储（IO 边界；JSONL 追加式）
import { mkdirSync, appendFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowEvent } from "./types.ts";

export interface EventStore {
  append(instanceId: string, event: WorkflowEvent): void;
  readAll(instanceId: string): WorkflowEvent[];
  instances(): string[];
}

export function createFsStore({ dir }: { dir: string }): EventStore {
  const fileFor = (instanceId: string): string => join(dir, `${instanceId}.jsonl`);
  return {
    append(instanceId, event) {
      mkdirSync(dir, { recursive: true });
      appendFileSync(fileFor(instanceId), `${JSON.stringify(event)}\n`, "utf8");
    },
    readAll(instanceId) {
      const f = fileFor(instanceId);
      if (!existsSync(f)) return [];
      return readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as WorkflowEvent);
    },
    instances() {
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((n) => n.endsWith(".jsonl"))
        .map((n) => n.slice(0, -".jsonl".length));
    },
  };
}
