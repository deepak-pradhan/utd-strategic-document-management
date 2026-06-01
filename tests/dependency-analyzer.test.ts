import { describe, it, expect } from "vitest";
import { DependencyAnalyzer, DependencyNode } from "../src/dependency-analyzer";

const makeNode = (overrides: Partial<DependencyNode> = {}): DependencyNode => ({
  thingId: "A",
  dependsOn: [],
  enables: [],
  relatedTo: [],
  lifecycleState: "operational",
  docType: "strategy",
  ...overrides,
});

describe("DependencyAnalyzer.analyze", () => {
  it("finds forward impact: who depends on this", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A" }),
      makeNode({ thingId: "B", dependsOn: ["A"] }),
      makeNode({ thingId: "C", dependsOn: ["A"], enables: ["B"] }),
    ];

    const result = DependencyAnalyzer.analyze("A", nodes);

    expect(result.forwardImpact.direct).toEqual(expect.arrayContaining(["B", "C"]));
    expect(result.forwardImpact.direct).toHaveLength(2);
  });

  it("finds backward impact: what this depends on", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", dependsOn: ["B", "C"] }),
      makeNode({ thingId: "B" }),
      makeNode({ thingId: "C" }),
    ];

    const result = DependencyAnalyzer.analyze("A", nodes);

    expect(result.backwardImpact.direct).toEqual(expect.arrayContaining(["B", "C"]));
    expect(result.backwardImpact.direct).toHaveLength(2);
  });

  it("computes transitive forward impact", () => {
    // A -> B -> C: C depends on B, B depends on A
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A" }),
      makeNode({ thingId: "B", dependsOn: ["A"] }),
      makeNode({ thingId: "C", dependsOn: ["B"] }),
    ];

    const result = DependencyAnalyzer.analyze("A", nodes);

    expect(result.forwardImpact.direct).toContain("B");
    expect(result.forwardImpact.transitive).toContain("C");
    expect(result.forwardImpact.allAffected).toEqual(expect.arrayContaining(["B", "C"]));
  });

  it("computes transitive backward impact", () => {
    // A depends on B, B depends on C
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", dependsOn: ["B"] }),
      makeNode({ thingId: "B", dependsOn: ["C"] }),
      makeNode({ thingId: "C" }),
    ];

    const result = DependencyAnalyzer.analyze("A", nodes);

    expect(result.backwardImpact.direct).toContain("B");
    expect(result.backwardImpact.transitive).toContain("C");
  });

  it("uses all relation types for impact: dependsOn, enables, relatedTo", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A" }),
      makeNode({ thingId: "B", dependsOn: ["A"] }),
      makeNode({ thingId: "C", enables: ["A"] }),
      makeNode({ thingId: "D", relatedTo: ["A"] }),
    ];

    const result = DependencyAnalyzer.analyze("A", nodes);

    expect(result.forwardImpact.direct).toEqual(expect.arrayContaining(["B", "C", "D"]));
    expect(result.forwardImpact.direct).toHaveLength(3);
  });

  it("reports affected document types in forward impact", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", docType: "strategy" }),
      makeNode({ thingId: "B", dependsOn: ["A"], docType: "policy" }),
      makeNode({ thingId: "C", dependsOn: ["A"], docType: "policy" }),
    ];

    const result = DependencyAnalyzer.analyze("A", nodes);

    expect(result.forwardImpact.affectedDocumentTypes["policy"]).toBe(2);
  });

  it("assigns severity based on affected doc types and lifecycle states", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", docType: "meeting_note", lifecycleState: "draft" }),
      makeNode({ thingId: "B", dependsOn: ["A"], docType: "strategy", lifecycleState: "operational" }),
    ];

    const result = DependencyAnalyzer.analyze("A", nodes);

    // strategy(4) + operational(4) = 8 -> critical
    expect(result.forwardImpact.severity).toBe("critical");
  });

  it("assigns none severity when no dependents", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A" }),
      makeNode({ thingId: "B" }),
    ];

    const result = DependencyAnalyzer.analyze("A", nodes);

    expect(result.forwardImpact.severity).toBe("none");
    expect(result.backwardImpact.severity).toBe("none");
  });

  it("computes dependency depth", () => {
    // A -> B -> C -> D
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", dependsOn: ["B"] }),
      makeNode({ thingId: "B", dependsOn: ["C"] }),
      makeNode({ thingId: "C", dependsOn: ["D"] }),
      makeNode({ thingId: "D" }),
    ];

    const result = DependencyAnalyzer.analyze("A", nodes);

    expect(result.backwardImpact.depth).toBe(3);
  });

  it("depth is zero for leaf node", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A" }),
    ];

    expect(DependencyAnalyzer.computeDepth("A", nodes)).toBe(0);
  });
});

describe("DependencyAnalyzer.findCycles", () => {
  it("detects simple cycle", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", dependsOn: ["B"] }),
      makeNode({ thingId: "B", dependsOn: ["A"] }),
    ];

    const cycles = DependencyAnalyzer.findCycles(nodes);

    expect(cycles.length).toBe(1);
    expect(cycles[0]).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("detects 3-node cycle", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", dependsOn: ["B"] }),
      makeNode({ thingId: "B", dependsOn: ["C"] }),
      makeNode({ thingId: "C", dependsOn: ["A"] }),
    ];

    const cycles = DependencyAnalyzer.findCycles(nodes);

    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty when no cycles", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", dependsOn: ["B"] }),
      makeNode({ thingId: "B", dependsOn: ["C"] }),
      makeNode({ thingId: "C" }),
    ];

    const cycles = DependencyAnalyzer.findCycles(nodes);

    expect(cycles).toHaveLength(0);
  });

  it("cycles included in impact analysis", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", dependsOn: ["B"] }),
      makeNode({ thingId: "B", dependsOn: ["A"] }),
    ];

    const result = DependencyAnalyzer.analyze("A", nodes);

    expect(result.cycles).toHaveLength(1);
  });
});

describe("DependencyAnalyzer.findOrphans", () => {
  it("detects nodes with no incoming or outgoing relations", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", dependsOn: ["B"] }),
      makeNode({ thingId: "B" }),
      makeNode({ thingId: "orphan" }),
    ];

    const orphans = DependencyAnalyzer.findOrphans(nodes);

    expect(orphans).toHaveLength(1);
    expect(orphans[0].thingId).toBe("orphan");
  });

  it("returns empty when no orphans (all connected)", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", dependsOn: ["B"] }),
      makeNode({ thingId: "B" }),
    ];

    const orphans = DependencyAnalyzer.findOrphans(nodes);

    expect(orphans).toHaveLength(0);
  });

  it("orphans included in impact analysis", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", dependsOn: ["B"] }),
      makeNode({ thingId: "B" }),
      makeNode({ thingId: "orphan" }),
    ];

    const result = DependencyAnalyzer.analyze("A", nodes);

    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].thingId).toBe("orphan");
  });
});

describe("DependencyAnalyzer.analyzeAll", () => {
  it("analyzes every node in the graph", () => {
    const nodes: DependencyNode[] = [
      makeNode({ thingId: "A", dependsOn: ["B"] }),
      makeNode({ thingId: "B" }),
    ];

    const results = DependencyAnalyzer.analyzeAll(nodes);

    expect(results.size).toBe(2);
    expect(results.get("A")!.backwardImpact.direct).toContain("B");
    expect(results.get("B")!.forwardImpact.direct).toContain("A");
  });
});
