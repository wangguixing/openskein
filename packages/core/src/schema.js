export const CURRENT_SCHEMA = 1;
/** 历史迁移表：目前无旧版本；未来破坏性变更逐条追加 */
const MIGRATIONS = [];
/** 把任意版本的 Definition 升级到 CURRENT_SCHEMA */
export function migrate(input) {
    let def = input;
    const applied = [];
    let cur = typeof def.schema === "number" ? def.schema : 0;
    while (cur < CURRENT_SCHEMA) {
        const step = MIGRATIONS.find((m) => m.from === cur);
        if (!step)
            throw new Error(`缺少 schema ${cur} → ${cur + 1} 的迁移`);
        def = step.run(def);
        def.schema = step.to;
        applied.push(step.name);
        cur = step.to;
    }
    return { def: def, changed: applied.length > 0, applied };
}
