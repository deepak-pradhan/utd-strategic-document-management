import { describe, it, expect } from "vitest";
import { QualityScorer } from "../src/quality-score";

const today = new Date();
const recentDate = new Date(today.getTime() - 3 * 86400000).toISOString();
const oldDate = new Date(today.getTime() - 200 * 86400000).toISOString();

const fullStrategyFm = {
  doc_type: "strategy",
  owner: "alice",
  domain: "growth",
  review_date: recentDate,
  updated_at: recentDate,
};

const emptyFm = {};

const knownIds = ["thing-1", "thing-2", "thing-3", "thing-4"];

describe("QualityScorer.score", () => {
  it("returns max score for fully complete, fresh, connected document", () => {
    const score = QualityScorer.score(fullStrategyFm, {
      dependsOn: ["thing-1", "thing-2"],
      enables: [],
      relatedTo: [],
      knownThingIds: knownIds,
    });
    expect(score.total).toBeGreaterThanOrEqual(90);
  });

  it("returns low score for empty frontmatter", () => {
    const score = QualityScorer.score(emptyFm);
    expect(score.total).toBeLessThan(20);
  });

  it("returns low score for empty frontmatter with no relations", () => {
    const score = QualityScorer.score(emptyFm, {
      dependsOn: [],
      enables: [],
      relatedTo: [],
      knownThingIds: [],
    });
    expect(score.total).toBeLessThan(20);
  });

  it("total is weighted sum of all dimensions", () => {
    const score = QualityScorer.score(fullStrategyFm, {
      dependsOn: ["thing-1"],
      enables: [],
      relatedTo: [],
      knownThingIds: knownIds,
    });
    const sum = (
      score.dimensions.completeness.weighted +
      score.dimensions.freshness.weighted +
      score.dimensions.relationHealth.weighted +
      score.dimensions.activity.weighted
    );
    expect(score.total).toBeCloseTo(Math.round(sum * 100) / 100);
  });
});

describe("QualityScorer.scoreCompleteness", () => {
  it("returns full score when all required fields present", () => {
    const dim = QualityScorer.scoreCompleteness(fullStrategyFm);
    expect(dim.score).toBe(100);
    expect(dim.weighted).toBe(40);
  });

  it("returns partial score when some fields missing", () => {
    const dim = QualityScorer.scoreCompleteness({
      doc_type: "strategy",
      owner: "alice",
    });
    expect(dim.score).toBeCloseTo(33.33, 1);
    expect(dim.weighted).toBeCloseTo(13.33, 1);
    expect(dim.detail).toContain("Missing 2/3 fields");
  });

  it("returns 0 when no doc_type", () => {
    const dim = QualityScorer.scoreCompleteness({ owner: "alice" });
    expect(dim.score).toBe(0);
    expect(dim.weighted).toBe(0);
  });

  it("policy has 4 required fields", () => {
    const dim = QualityScorer.scoreCompleteness({
      doc_type: "policy",
      owner: "alice",
      domain: "compliance",
    });
    expect(dim.score).toBe(50);
  });
});

describe("QualityScorer.scoreFreshness", () => {
  it("returns full score when within review cadence", () => {
    const dim = QualityScorer.scoreFreshness({
      doc_type: "strategy",
      review_date: recentDate,
    });
    expect(dim.score).toBeGreaterThanOrEqual(90);
    expect(dim.weight).toBe(0.3);
  });

  it("returns reduced score when past review date", () => {
    const dim = QualityScorer.scoreFreshness({
      doc_type: "strategy",
      review_date: oldDate,
    });
    expect(dim.score).toBe(0);
  });

  it("uses updated_at when review_date absent", () => {
    const dim = QualityScorer.scoreFreshness({
      doc_type: "strategy",
      updated_at: recentDate,
    });
    expect(dim.score).toBeGreaterThan(50);
    expect(dim.detail).toContain("updated_at");
  });

  it("returns moderate score when no dates at all", () => {
    const dim = QualityScorer.scoreFreshness({ doc_type: "strategy" });
    expect(dim.score).toBe(50);
  });

  it("different cadences produce different scores for same age", () => {
    const sameDate = new Date(today.getTime() - 25 * 86400000).toISOString();
    const dimMeeting = QualityScorer.scoreFreshness({
      doc_type: "meeting_note",
      review_date: sameDate,
    });
    const dimStrategy = QualityScorer.scoreFreshness({
      doc_type: "strategy",
      review_date: sameDate,
    });
    // meeting_note has 30d cadence, strategy has 90d — 25d old is worse for meeting_note
    expect(dimMeeting.score).toBeLessThan(dimStrategy.score);
  });
});

describe("QualityScorer.scoreRelationHealth", () => {
  it("returns full score when all refs resolve", () => {
    const dim = QualityScorer.scoreRelationHealth({
      dependsOn: ["thing-1", "thing-2"],
      enables: ["thing-3"],
      relatedTo: [],
      knownThingIds: knownIds,
    });
    expect(dim.score).toBe(100);
    expect(dim.weighted).toBe(20);
    expect(dim.detail).toContain("All 3 references resolve");
  });

  it("returns partial score when some refs broken", () => {
    const dim = QualityScorer.scoreRelationHealth({
      dependsOn: ["thing-1", "unknown-x"],
      enables: [],
      relatedTo: [],
      knownThingIds: knownIds,
    });
    expect(dim.score).toBe(50);
    expect(dim.detail).toContain("broken");
  });

  it("returns 0 for orphan (no relations)", () => {
    const dim = QualityScorer.scoreRelationHealth({
      dependsOn: [],
      enables: [],
      relatedTo: [],
      knownThingIds: knownIds,
    });
    expect(dim.score).toBe(0);
    expect(dim.detail).toContain("Orphan");
  });

  it("returns 0 when no known IDs provided", () => {
    const dim = QualityScorer.scoreRelationHealth({
      dependsOn: ["thing-1"],
      enables: [],
      relatedTo: [],
      knownThingIds: [],
    });
    expect(dim.score).toBe(0);
  });

  it("deduplicates across relation arrays", () => {
    const dim = QualityScorer.scoreRelationHealth({
      dependsOn: ["thing-1"],
      enables: ["thing-1"],
      relatedTo: ["thing-1"],
      knownThingIds: knownIds,
    });
    expect(dim.score).toBe(100);
    expect(dim.detail).toContain("All 1 references resolve");
  });
});

describe("QualityScorer.scoreActivity", () => {
  it("returns full score when updated within 7 days", () => {
    const dim = QualityScorer.scoreActivity({
      updated_at: recentDate,
    });
    expect(dim.score).toBe(100);
  });

  it("returns 80 when updated within 30 days", () => {
    const past15 = new Date(today.getTime() - 15 * 86400000).toISOString();
    const dim = QualityScorer.scoreActivity({ updated_at: past15 });
    expect(dim.score).toBe(80);
  });

  it("returns 0 when updated over 180 days ago", () => {
    const dim = QualityScorer.scoreActivity({ updated_at: oldDate });
    expect(dim.score).toBe(0);
  });

  it("returns 0 when no updated_at", () => {
    const dim = QualityScorer.scoreActivity({});
    expect(dim.score).toBe(0);
  });
});
