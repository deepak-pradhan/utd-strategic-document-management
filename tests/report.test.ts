import { describe, it, expect } from "vitest";
import { buildGovernanceReport, reportToJSON, reportToMarkdown, type SdmDocument } from "../src/report";

function makeDoc(over: Partial<SdmDocument> & { thing_id: string }): SdmDocument {
  return {
    thing_id: over.thing_id,
    file_path: over.file_path ?? `${over.thing_id}.md`,
    frontmatter: over.frontmatter ?? {},
    relations: over.relations ?? { depends_on: [], enables: [], related_to: [] },
  };
}
const NOW = "2026-06-03T00:00:00.000Z";

describe("buildGovernanceReport", () => {
  it("returns a zeroed report for an empty vault", () => {
    const r = buildGovernanceReport([], { now: NOW, scanErrors: [] });
    expect(r.summary.total_documents).toBe(0);
    expect(r.summary.quality.average).toBe(0);
    expect(r.documents).toEqual([]);
    expect(r.cycles).toEqual([]);
    expect(r.orphans).toEqual([]);
  });
  it("scores documents, tallies lifecycle, and buckets quality", () => {
    const docs = [
      makeDoc({ thing_id: "a", frontmatter: { doc_type: "strategy", lifecycle_state: "approved", title: "A", owner: "dp", review_date: "2099-01-01", updated_at: NOW } }),
      makeDoc({ thing_id: "b", frontmatter: { doc_type: "policy", lifecycle_state: "draft" } }),
    ];
    const r = buildGovernanceReport(docs, { now: NOW, scanErrors: [] });
    expect(r.summary.total_documents).toBe(2);
    expect(r.summary.lifecycle.by_state).toMatchObject({ approved: 1, draft: 1 });
    expect(r.documents).toHaveLength(2);
    const a = r.documents.find((d) => d.thing_id === "a")!;
    expect(a.document_type).toBe("strategy");
    expect(typeof a.quality_score).toBe("number");
    expect(["overdue", "approaching", "due_soon", "missing_review_date", "ok"]).toContain(a.review_status);
  });
  it("detects cycles and orphans from relations", () => {
    const docs = [
      makeDoc({ thing_id: "x", relations: { depends_on: ["y"], enables: [], related_to: [] } }),
      makeDoc({ thing_id: "y", relations: { depends_on: ["x"], enables: [], related_to: [] } }),
      makeDoc({ thing_id: "lonely", relations: { depends_on: [], enables: [], related_to: [] } }),
    ];
    const r = buildGovernanceReport(docs, { now: NOW, scanErrors: [] });
    expect(r.summary.dependencies.cycle_count).toBeGreaterThan(0);
    expect(r.orphans).toContain("lonely");
  });
  it("passes scan errors through", () => {
    const r = buildGovernanceReport([], { now: NOW, scanErrors: ["bad.md: unparseable"] });
    expect(r.scan_errors).toEqual(["bad.md: unparseable"]);
  });
});

describe("serializers", () => {
  const docs: SdmDocument[] = [makeDoc({ thing_id: "a", frontmatter: { doc_type: "strategy", lifecycle_state: "approved" } })];
  const report = buildGovernanceReport(docs, { now: NOW, scanErrors: [] });
  it("reportToJSON round-trips", () => { expect(JSON.parse(reportToJSON(report)).summary.total_documents).toBe(1); });
  it("reportToMarkdown includes summary and the document row", () => {
    const md = reportToMarkdown(report);
    expect(md).toContain("# Governance Report");
    expect(md).toContain("| a | strategy | approved |");
  });
});
