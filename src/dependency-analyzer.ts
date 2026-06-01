export interface DependencyNode {
  thingId: string;
  dependsOn: string[];
  enables: string[];
  relatedTo: string[];
  lifecycleState?: string;
  docType?: string;
}

export interface ImpactResult {
  direct: string[];
  transitive: string[];
  allAffected: string[];
  affectedDocumentTypes: Record<string, number>;
  severity: "critical" | "high" | "medium" | "low" | "none";
  depth: number;
}

export interface ImpactAnalysis {
  forwardImpact: ImpactResult;
  backwardImpact: ImpactResult;
  cycles: string[][];
  orphans: DependencyNode[];
}

interface Adjacency {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

interface NormalizedNode {
  thingId: string;
  allOutgoing: string[];
  lifecycleState: string;
  docType: string;
}

const SEVERITY_DOC_TYPE: Record<string, number> = {
  strategy: 4,
  policy: 4,
  decision: 3,
  proposal: 2,
  project: 2,
  report: 1,
  meeting_note: 1,
};

const SEVERITY_LIFECYCLE: Record<string, number> = {
  operational: 4,
  approved: 3,
  under_review: 2,
  draft: 1,
  archived: 0,
};

function buildNormalized(nodes: DependencyNode[]): NormalizedNode[] {
  return nodes.map((n) => ({
    thingId: n.thingId,
    allOutgoing: [...new Set([...n.dependsOn, ...n.enables, ...n.relatedTo])],
    lifecycleState: n.lifecycleState || "",
    docType: n.docType || "",
  }));
}

function buildAdjacency(nodes: NormalizedNode[]): Adjacency {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const node of nodes) {
    outgoing.set(node.thingId, node.allOutgoing);
  }

  for (const node of nodes) {
    const dependents: string[] = [];
    for (const other of nodes) {
      if (other.allOutgoing.includes(node.thingId)) {
        dependents.push(other.thingId);
      }
    }
    incoming.set(node.thingId, dependents);
  }

  return { outgoing, incoming };
}

function transitiveClosure(
  startId: string,
  directIds: string[],
  adjacency: { outgoing: Map<string, string[]>; incoming: Map<string, string[]> },
  direction: "forward" | "backward"
): string[] {
  const result = new Set<string>();
  const queue = [...directIds];
  const edgeMap = direction === "forward" ? adjacency.incoming : adjacency.outgoing;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const next = edgeMap.get(current) || [];

    for (const id of next) {
      if (id !== startId && !result.has(id)) {
        result.add(id);
        queue.push(id);
      }
    }
  }

  return [...result].filter((id) => !directIds.includes(id));
}

function computeSeverity(
  affectedIds: string[],
  nodes: NormalizedNode[]
): "critical" | "high" | "medium" | "low" | "none" {
  if (affectedIds.length === 0) return "none";

  const nodesById = new Map(nodes.map((n) => [n.thingId, n]));
  let maxSeverity = 0;

  for (const id of affectedIds) {
    const node = nodesById.get(id);
    if (!node) continue;
    const docSeverity = SEVERITY_DOC_TYPE[node.docType] || 0;
    const lifecycleSeverity = SEVERITY_LIFECYCLE[node.lifecycleState] || 0;
    const combined = docSeverity + lifecycleSeverity;
    if (combined > maxSeverity) maxSeverity = combined;
  }

  if (maxSeverity >= 7) return "critical";
  if (maxSeverity >= 5) return "high";
  if (maxSeverity >= 3) return "medium";
  return "low";
}

function buildImpactResult(
  startId: string,
  directIds: string[],
  allTransitive: string[],
  nodes: NormalizedNode[]
): ImpactResult {
  const allAffected = [...directIds, ...allTransitive];
  const nodesById = new Map(nodes.map((n) => [n.thingId, n]));

  const affectedDocumentTypes: Record<string, number> = {};
  for (const id of allAffected) {
    const node = nodesById.get(id);
    if (node && node.docType) {
      affectedDocumentTypes[node.docType] = (affectedDocumentTypes[node.docType] || 0) + 1;
    }
  }

  const depth = computeDepth(startId, nodes);

  return {
    direct: directIds,
    transitive: allTransitive,
    allAffected,
    affectedDocumentTypes,
    severity: computeSeverity(allAffected, nodes),
    depth,
  };
}

function computeDepth(startId: string, nodes: NormalizedNode[]): number {
  const nodesById = new Map(nodes.map((n) => [n.thingId, n]));
  const visited = new Set<string>();

  function dfs(id: string): number {
    if (visited.has(id)) return 0;
    visited.add(id);

    const node = nodesById.get(id);
    if (!node || node.allOutgoing.length === 0) return 0;

    let maxChild = 0;
    for (const dep of node.allOutgoing) {
      if (dep !== id) {
        maxChild = Math.max(maxChild, dfs(dep));
      }
    }
    return 1 + maxChild;
  }

  return dfs(startId);
}

function findCycles(nodes: NormalizedNode[]): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const nodesById = new Map(nodes.map((n) => [n.thingId, n]));

  function dfs(id: string, path: string[]): void {
    if (inStack.has(id)) {
      const cycleStart = path.indexOf(id);
      if (cycleStart >= 0) {
        cycles.push([...path.slice(cycleStart), id]);
      }
      return;
    }

    if (visited.has(id)) return;

    visited.add(id);
    inStack.add(id);
    path.push(id);

    const node = nodesById.get(id);
    if (node) {
      for (const dep of node.allOutgoing) {
        dfs(dep, [...path]);
      }
    }

    inStack.delete(id);
  }

  for (const node of nodes) {
    if (!visited.has(node.thingId)) {
      dfs(node.thingId, []);
    }
  }

  return cycles;
}

function findOrphans(nodes: NormalizedNode[]): DependencyNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.thingId, n]));
  const orphanIds = new Set(nodes.map((n) => n.thingId));

  for (const node of nodes) {
    if (node.allOutgoing.length > 0) {
      orphanIds.delete(node.thingId);
    }
    for (const dep of node.allOutgoing) {
      orphanIds.delete(dep);
    }
  }

  return [...orphanIds].map((id) => {
    const n = nodeMap.get(id)!;
    return {
      thingId: n.thingId,
      dependsOn: [],
      enables: [],
      relatedTo: [],
      lifecycleState: n.lifecycleState,
      docType: n.docType,
    };
  });
}

function analyzeImpact(targetId: string, nodes: DependencyNode[]): ImpactAnalysis {
  const normalized = buildNormalized(nodes);
  const adjacency = buildAdjacency(normalized);

  const backwardDirect = adjacency.outgoing.get(targetId) || [];
  const forwardDirect = adjacency.incoming.get(targetId) || [];

  const backwardTransitive = transitiveClosure(targetId, backwardDirect, adjacency, "backward");
  const forwardTransitive = transitiveClosure(targetId, forwardDirect, adjacency, "forward");

  const forwardImpact = buildImpactResult(targetId, forwardDirect, forwardTransitive, normalized);
  const backwardImpact = buildImpactResult(targetId, backwardDirect, backwardTransitive, normalized);

  const cycles = findCycles(normalized);
  const orphans = findOrphans(normalized);

  return {
    forwardImpact,
    backwardImpact,
    cycles,
    orphans,
  };
}

function analyzeAll(nodes: DependencyNode[]): Map<string, ImpactAnalysis> {
  const results = new Map<string, ImpactAnalysis>();
  for (const node of nodes) {
    results.set(node.thingId, analyzeImpact(node.thingId, nodes));
  }
  return results;
}

export const DependencyAnalyzer = {
  analyze: analyzeImpact,
  analyzeAll,
  findCycles: (nodes: DependencyNode[]) => findCycles(buildNormalized(nodes)),
  findOrphans: (nodes: DependencyNode[]) => findOrphans(buildNormalized(nodes)),
  computeDepth: (nodeId: string, nodes: DependencyNode[]) => computeDepth(nodeId, buildNormalized(nodes)),
};
