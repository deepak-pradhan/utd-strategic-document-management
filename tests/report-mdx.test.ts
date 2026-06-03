import { describe, it, expect } from "vitest";
import { reportToMDX } from "../src/report-mdx";
import { buildGovernanceReport, type SdmDocument } from "../src/report";

const NOW = "2026-06-03T00:00:00.000Z";
const docs: SdmDocument[] = [
  { thing_id: "a", file_path: "a.md", frontmatter: { doc_type: "strategy", lifecycle_state: "approved" }, relations: { depends_on: [], enables: [], related_to: [] } },
];

describe("reportToMDX", () => {
  const mdx = reportToMDX(buildGovernanceReport(docs, { now: NOW, scanErrors: [] }));
  it("has YAML frontmatter and an exported data const", () => {
    expect(mdx.startsWith("---\n")).toBe(true);
    expect(mdx).toContain("export const governanceData =");
  });
  it("embeds valid JSON in the export", () => {
    const m = mdx.match(/export const governanceData = (\{[\s\S]*?\});/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1]).summary.total_documents).toBe(1);
  });
  it("lists orphan ids, not just the count", () => {
    const orphanMdx = reportToMDX(buildGovernanceReport(
      [{ thing_id: "lonely", file_path: "l.md", frontmatter: {}, relations: { depends_on: [], enables: [], related_to: [] } }],
      { now: NOW, scanErrors: [] },
    ));
    expect(orphanMdx).toContain("## Orphans");
    expect(orphanMdx).toContain("lonely");
  });
});
