export const featureFlow = {
    schema: 1,
    id: "feature",
    version: "1.0.0",
    summary: "需求 → 规格 → 实现 → 审查",
    params: [{ name: "requirement", required: true }],
    steps: [
        {
            id: "spec",
            kind: "artifact",
            produces: "specs/{instanceId}.md",
            cc: { type: "file_exists", path: "specs/{instanceId}.md" },
            next: ["plan"],
        },
        {
            id: "plan",
            kind: "skill",
            skill: "planner",
            cc: { type: "effect_ok", effect: "load_skill" },
            next: ["implement"],
        },
        {
            id: "implement",
            kind: "agent",
            agent: "worker",
            cc: { type: "user_ack" },
            next: ["review"],
        },
        {
            id: "review",
            kind: "skill",
            skill: "critic",
            cc: { type: "effect_ok", effect: "load_skill" },
            next: ["done"],
        },
    ],
    gates: [{ before: "implement", require: { type: "refs_valid" } }],
};
/** 首个真实工作流移植：对齐配置仓 workflows/bug.md（报告→诊断→复现→TDD→审查→提交→提交信息） */
export const bugFlow = {
    schema: 1,
    id: "bug",
    version: "1.0.0",
    summary: "报告 → 诊断 → 最小复现 → TDD 修复 → 审查 → 提交 → 生成提交信息",
    params: [{ name: "bug", required: true }],
    steps: [
        { id: "report", kind: "skill", skill: "triage", cc: { type: "user_ack" }, next: ["diagnose"] },
        { id: "diagnose", kind: "skill", skill: "diagnosing-bugs", cc: { type: "user_ack" }, next: ["reproduce"] },
        { id: "reproduce", kind: "skill", skill: "prototype", cc: { type: "user_ack" }, next: ["fix"] },
        { id: "fix", kind: "skill", skill: "tdd", cc: { type: "effect_ok", effect: "load_skill" }, next: ["review"] },
        { id: "review", kind: "skill", skill: "review", cc: { type: "user_ack" }, next: ["submit"] },
        { id: "submit", kind: "skill", skill: "pre-check", cc: { type: "effect_ok", effect: "load_skill" }, next: ["commit"] },
        { id: "commit", kind: "tool", tool: "gen-commit", cc: { type: "user_ack" }, next: ["done"] },
    ],
};
export const builtinFlows = [featureFlow, bugFlow];
