import { describe, it, expect } from "vitest";
import { DocumentClassifier, DocumentType } from "../src/document-types";

describe("DocumentClassifier.getClassify", () => {
  it("classifies by explicit doc_type field", () => {
    const result = DocumentClassifier.classify({ doc_type: "strategy", owner: "alice", domain: "growth" });
    expect(result.documentType).toBe(DocumentType.Strategy);
    expect(result.confidence).toBe(1.0);
    expect(result.matchReason).toContain("doc_type");
  });

  it("returns null for unknown doc_type value", () => {
    const result = DocumentClassifier.classify({ doc_type: "unknown_thing" });
    expect(result.documentType).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("heuristic matches strategy when required fields present", () => {
    const result = DocumentClassifier.classify({ owner: "bob", domain: "finance", review_date: "2025-06-01" });
    expect(result.documentType).toBe(DocumentType.Strategy);
    expect(result.confidence).toBe(1.0);
  });

  it("heuristic matches policy when policy-specific fields present", () => {
    const result = DocumentClassifier.classify({ owner: "carol", domain: "compliance", approved_by: "alice", effective_date: "2025-01-15" });
    expect(result.documentType).toBe(DocumentType.Policy);
    expect(result.confidence).toBe(1.0);
  });

  it("heuristic matches decision when decision-specific fields present", () => {
    const result = DocumentClassifier.classify({ owner: "dave", domain: "engineering", decided_by: "cto", rationale: "cost savings" });
    expect(result.documentType).toBe(DocumentType.Decision);
    expect(result.confidence).toBe(1.0);
  });

  it("heuristic matches project when project-specific fields present", () => {
    const result = DocumentClassifier.classify({ owner: "eve", start_date: "2025-01-01", target_date: "2025-06-01", status: "active" });
    expect(result.documentType).toBe(DocumentType.Project);
    expect(result.confidence).toBe(1.0);
  });

  it("heuristic matches meeting_note when meeting fields present", () => {
    const result = DocumentClassifier.classify({ owner: "frank", meeting_date: "2025-05-20", attendees: ["alice", "bob"] });
    expect(result.documentType).toBe(DocumentType.MeetingNote);
    expect(result.confidence).toBe(1.0);
  });

  it("heuristic matches report when report fields present", () => {
    const result = DocumentClassifier.classify({ owner: "grace", domain: "sales", period_start: "2025-Q1", period_end: "2025-Q2" });
    expect(result.documentType).toBe(DocumentType.Report);
    expect(result.confidence).toBe(1.0);
  });

  it("heuristic matches proposal when proposal fields present", () => {
    const result = DocumentClassifier.classify({ owner: "heidi", domain: "product", decision_date: "2025-07-01", approver: "cto" });
    expect(result.documentType).toBe(DocumentType.Proposal);
    expect(result.confidence).toBe(1.0);
  });

  it("picks highest-scoring type when fields match partially", () => {
    const result = DocumentClassifier.classify({ owner: "ivan", domain: "engineering", review_date: "2025-06-01", start_date: "2025-01-01" });
    // strategy: 3/3 = 1.0, project: 1/4 = 0.25 -> strategy wins
    expect(result.documentType).toBe(DocumentType.Strategy);
    expect(result.confidence).toBe(1.0);
  });

  it("returns null for empty frontmatter", () => {
    const result = DocumentClassifier.classify({});
    expect(result.documentType).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("doc_type takes precedence over heuristic", () => {
    const result = DocumentClassifier.classify({
      doc_type: "policy",
      owner: "jane",
      meeting_date: "2025-05-01",
      attendees: ["bob"],
    });
    expect(result.documentType).toBe(DocumentType.Policy);
    expect(result.confidence).toBe(1.0);
  });
});

describe("DocumentClassifier.validateRequiredFields", () => {
  it("returns valid when all required fields present", () => {
    const result = DocumentClassifier.validateRequiredFields(DocumentType.Strategy, {
      owner: "alice",
      domain: "growth",
      review_date: "2025-06-01",
    });
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("returns invalid with missing fields", () => {
    const result = DocumentClassifier.validateRequiredFields(DocumentType.Strategy, { owner: "alice" });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("domain");
    expect(result.missing).toContain("review_date");
  });

  it("treats empty strings as missing", () => {
    const result = DocumentClassifier.validateRequiredFields(DocumentType.Strategy, {
      owner: "",
      domain: "growth",
      review_date: "2025-06-01",
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("owner");
  });

  it("treats null as missing", () => {
    const result = DocumentClassifier.validateRequiredFields(DocumentType.Strategy, {
      owner: null,
      domain: "growth",
      review_date: "2025-06-01",
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("owner");
  });

  it("all document types have required fields", () => {
    const types = DocumentClassifier.getValidDocumentTypes() as DocumentType[];
    for (const type of types) {
      const fields = DocumentClassifier.getRequiredFields(type);
      expect(fields.length).toBeGreaterThan(0);
    }
  });
});

describe("DocumentClassifier.getAllDefinitions", () => {
  it("returns all 7 document types", () => {
    const defs = DocumentClassifier.getAllDefinitions();
    expect(defs).toHaveLength(7);
    const types = defs.map((d) => d.type);
    expect(types).toEqual(expect.arrayContaining([
      DocumentType.Strategy,
      DocumentType.Policy,
      DocumentType.Proposal,
      DocumentType.Report,
      DocumentType.MeetingNote,
      DocumentType.Decision,
      DocumentType.Project,
    ]));
  });

  it("every definition has purpose, requiredFields, and lifecycleNotes", () => {
    for (const def of DocumentClassifier.getAllDefinitions()) {
      expect(def.purpose).toBeTruthy();
      expect(def.requiredFields.length).toBeGreaterThan(0);
      expect(def.lifecycleNotes).toBeTruthy();
    }
  });
});

describe("DocumentClassifier.getDefinition", () => {
  it("returns definition for each type", () => {
    for (const type of Object.values(DocumentType)) {
      const def = DocumentClassifier.getDefinition(type as DocumentType);
      expect(def.type).toBe(type);
      expect(def.purpose).toBeTruthy();
    }
  });
});
