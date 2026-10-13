// types.ts — catalog 资源与引用类型
export type ResourceKind = "skill" | "command" | "agent" | "workflow";

export interface Resource {
  id: string;
  kind: ResourceKind;
  name: string;
  description?: string;
  path: string;
}

export interface Ref {
  from: string;
  refKind: string;
  refName: string;
  usage?: string;
}

export interface RefIssue extends Ref {
  code: string;
  message: string;
}

export interface Catalog {
  resources: Resource[];
  graph: { nodes: string[]; edges: Ref[] };
}

export interface CatalogIssue {
  code: string;
  message: string;
  id?: string;
}
