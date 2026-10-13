// index.ts — @openskein/catalog 公共导出
export { getCatalog, validateCatalog, loadTargets, OPENCODE_DEFAULT_TARGETS } from "./catalog.ts";
export {
  extractRefs,
  validateRefs,
  parseRefsByKind,
  parseWorkflowRefs,
  parseCommandRefs,
  parseAgentRefs,
  parseSkillRefs,
} from "./refs.ts";
export { parseFrontmatter, asString } from "./frontmatter.ts";

export type { Target, CatalogConfig, GetCatalogOptions } from "./catalog.ts";
export type { RawRef } from "./refs.ts";
export type { Catalog, CatalogIssue, Ref, RefIssue, Resource, ResourceKind } from "./types.ts";
