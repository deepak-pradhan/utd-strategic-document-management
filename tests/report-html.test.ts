import { describe, it, expect } from "vitest";
import { reportToHTML } from "../src/report-html";
import { buildGovernanceReport, type SdmDocument } from "../src/report";

const NOW = "2026-06-03T00:00:00.000Z";
const docs: SdmDocument[] = [
  { thing_id: "a", file_path: "a.md", frontmatter: { doc_type: "strategy", lifecycle_state: "approved", title: "Alpha" }, relations: { depends_on: [], enables: [], related_to: [] } },
];

describe("reportToHTML", () => {
  const html = reportToHTML(buildGovernanceReport(docs, { now: NOW, scanErrors: [] }));
  it("is a self-contained document", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<style>");
    expect(html).not.toContain("<script");
  });
  it("renders the document and escapes content", () => {
    expect(html).toContain("Alpha");
    expect(reportToHTML(buildGovernanceReport(
      [{ ...docs[0], frontmatter: { ...docs[0].frontmatter, title: "<x>" } }], { now: NOW, scanErrors: [] }
    ))).toContain("&lt;x&gt;");
  });
});
