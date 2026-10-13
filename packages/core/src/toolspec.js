function parseJson(v, fallback = {}) {
    if (typeof v !== "string" || v.trim() === "")
        return fallback;
    return JSON.parse(v);
}
/** 把内核工具包装成运行时无关的 ToolSpec */
export function buildToolSpecs(impl) {
    return {
        skein_start: {
            description: "启动一个 openskein 工作流实例",
            args: {
                defId: { type: "string", required: true },
                params: { type: "string", description: "实例参数 JSON（可选，含 instanceId 可指定实例号）" },
            },
            execute: (a) => impl.skein_start({ defId: String(a.defId), params: parseJson(a.params) }),
        },
        skein_status: {
            description: "查看工作流实例当前状态",
            args: { instanceId: { type: "string", required: true } },
            execute: (a) => impl.skein_status({ instanceId: String(a.instanceId) }),
        },
        skein_advance: {
            description: "推进工作流到下一步（须满足当前步完成标准 CC）",
            args: {
                instanceId: { type: "string", required: true },
                step: { type: "string", required: true },
                evidence: { type: "string", description: "完成证据 JSON（可选，如 {\"ok\":true}）" },
            },
            execute: (a) => impl.skein_advance({
                instanceId: String(a.instanceId),
                step: String(a.step),
                evidence: parseJson(a.evidence),
            }),
        },
        skein_pause: {
            description: "暂停工作流实例",
            args: { instanceId: { type: "string", required: true }, reason: { type: "string" } },
            execute: (a) => impl.skein_pause({ instanceId: String(a.instanceId), reason: a.reason }),
        },
        skein_resume: {
            description: "恢复已暂停的工作流实例",
            args: { instanceId: { type: "string", required: true } },
            execute: (a) => impl.skein_resume({ instanceId: String(a.instanceId) }),
        },
        skein_cancel: {
            description: "取消工作流实例",
            args: { instanceId: { type: "string", required: true }, reason: { type: "string" } },
            execute: (a) => impl.skein_cancel({ instanceId: String(a.instanceId), reason: a.reason }),
        },
        skein_validate: {
            description: "静态校验工作流定义（悬空/不可达/环等）",
            args: { defId: { type: "string", required: true } },
            execute: (a) => impl.skein_validate({ defId: String(a.defId) }),
        },
    };
}
