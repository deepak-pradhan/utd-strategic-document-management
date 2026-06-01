import { describe, it, expect } from "vitest";
import { ReviewQueueBuilder, StalenessTier } from "../src/review-queue";

const today = new Date();
const pastDate = (daysAgo: number) => new Date(today.getTime() - daysAgo * 86400000).toISOString();

const recentDate = pastDate(3);

const fullDoc = (id: string, overrides: Record<string, unknown> = {}) => ({
  thingId: id,
  frontmatter: {
    doc_type: "strategy",
    owner: "alice",
    domain: "growth",
    review_date: pastDate(30),
    updated_at: recentDate,
    ...overrides,
  },
});

describe("ReviewQueueBuilder.build", () => {
  it("returns sorted queue with most urgent first", () => {
    const overdue = fullDoc("doc-1", { review_date: pastDate(200) });
    const approaching = fullDoc("doc-2", { review_date: pastDate(85) }); // 90-85=5d left, within 7d approaching
    const fine = fullDoc("doc-3", { review_date: pastDate(30) });

    const queue = ReviewQueueBuilder.build([overdue, fine, approaching]);

    expect(queue.documents[0].thingId).toBe("doc-1"); // overdue
    expect(queue.documents[0].stalenessTier).toBe(StalenessTier.Overdue);
    expect(queue.documents[1].thingId).toBe("doc-2"); // approaching (within 7d)
    expect(queue.documents[1].stalenessTier).toBe(StalenessTier.Approaching);
    expect(queue.documents[2].thingId).toBe("doc-3"); // up to date
  });

  it("places missing_review_date before overdue", () => {
    const noDate = fullDoc("doc-a", { review_date: undefined });
    const overdue = fullDoc("doc-b", { review_date: pastDate(200) });

    const queue = ReviewQueueBuilder.build([overdue, noDate]);

    expect(queue.documents[0].thingId).toBe("doc-a");
    expect(queue.documents[0].stalenessTier).toBe(StalenessTier.MissingReviewDate);
  });

  it("sorts by quality score within same tier", () => {
    const highQuality = fullDoc("doc-hi", {
      review_date: pastDate(200),
      owner: "alice",
      domain: "growth",
    });
    const lowQuality = fullDoc("doc-lo", {
      review_date: pastDate(200),
      owner: undefined,
      domain: undefined,
      updated_at: undefined,
    });

    const queue = ReviewQueueBuilder.build([lowQuality, highQuality]);

    // both overdue, higher quality first within tier
    expect(queue.documents[0].thingId).toBe("doc-hi");
    expect(queue.documents[1].thingId).toBe("doc-lo");
  });

  it("respects maxDocuments limit", () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      fullDoc(`doc-${i}`, { review_date: pastDate(30) })
    );

    const queue = ReviewQueueBuilder.build(docs, { maxDocuments: 3 });
    expect(queue.documents).toHaveLength(3);
    expect(queue.summary.total).toBe(3);
  });

  it("builds correct summary", () => {
    const overdue = fullDoc("a", { review_date: pastDate(200) });
    const approaching = fullDoc("b", { review_date: pastDate(85) });
    const fine = fullDoc("c", { review_date: pastDate(30) });

    const queue = ReviewQueueBuilder.build([overdue, approaching, fine]);

    expect(queue.summary.total).toBe(3);
    expect(queue.summary.byTier[StalenessTier.Overdue]).toBe(1);
    expect(queue.summary.byTier[StalenessTier.Approaching]).toBe(1);
    expect(queue.summary.byTier[StalenessTier.UpToDate]).toBe(1);
    expect(queue.summary.byDocumentType["strategy"]).toBe(3);
    expect(queue.summary.averageQuality).toBeGreaterThan(0);
  });

  it("counts document types correctly in summary", () => {
    const strategy = fullDoc("a", { doc_type: "strategy", review_date: pastDate(30) });
    const policy = fullDoc("b", {
      doc_type: "policy",
      owner: "alice",
      domain: "hr",
      approved_by: "bob",
      effective_date: "2025-01-01",
      review_date: pastDate(30),
    });
    const unknown = fullDoc("c", { doc_type: undefined, review_date: pastDate(30) });

    const queue = ReviewQueueBuilder.build([strategy, policy, unknown]);

    expect(queue.summary.byDocumentType["strategy"]).toBe(1);
    expect(queue.summary.byDocumentType["policy"]).toBe(1);
    expect(queue.summary.byDocumentType["unknown"]).toBe(1);
  });

  it("handles empty input", () => {
    const queue = ReviewQueueBuilder.build([]);
    expect(queue.documents).toHaveLength(0);
    expect(queue.summary.total).toBe(0);
    expect(queue.summary.averageQuality).toBe(0);
  });
});

describe("ReviewQueueBuilder.classifyStaleness", () => {
  it("classifies overdue", () => {
    expect(ReviewQueueBuilder.classifyStaleness(-1, { approachingDays: 7, dueSoonDays: 30 }))
      .toBe(StalenessTier.Overdue);
  });

  it("classifies approaching", () => {
    expect(ReviewQueueBuilder.classifyStaleness(7, { approachingDays: 7, dueSoonDays: 30 }))
      .toBe(StalenessTier.Approaching);
    expect(ReviewQueueBuilder.classifyStaleness(0, { approachingDays: 7, dueSoonDays: 30 }))
      .toBe(StalenessTier.Approaching);
  });

  it("classifies due_soon", () => {
    expect(ReviewQueueBuilder.classifyStaleness(30, { approachingDays: 7, dueSoonDays: 30 }))
      .toBe(StalenessTier.DueSoon);
    expect(ReviewQueueBuilder.classifyStaleness(8, { approachingDays: 7, dueSoonDays: 30 }))
      .toBe(StalenessTier.DueSoon);
  });

  it("classifies up_to_date", () => {
    expect(ReviewQueueBuilder.classifyStaleness(31, { approachingDays: 7, dueSoonDays: 30 }))
      .toBe(StalenessTier.UpToDate);
  });

  it("classifies missing_review_date", () => {
    expect(ReviewQueueBuilder.classifyStaleness(null, { approachingDays: 7, dueSoonDays: 30 }))
      .toBe(StalenessTier.MissingReviewDate);
  });
});

describe("ReviewQueueBuilder.computeDaysUntilReview", () => {
  it("returns positive when within cadence", () => {
    const days = ReviewQueueBuilder.computeDaysUntilReview({
      doc_type: "strategy",
      review_date: pastDate(30),
    });
    // 90 day cadence, reviewed 30 days ago -> 60 days left until next review
    expect(days).toBeGreaterThan(0);
    expect(days).toBe(60);
  });

  it("returns zero exactly at cadence boundary", () => {
    const days = ReviewQueueBuilder.computeDaysUntilReview({
      doc_type: "strategy",
      review_date: pastDate(90),
    });
    expect(days).toBe(0);
  });

  it("returns negative when past cadence", () => {
    const days = ReviewQueueBuilder.computeDaysUntilReview({
      doc_type: "strategy",
      review_date: pastDate(120),
    });
    expect(days).toBeLessThan(0);
  });

  it("returns null when no review_date", () => {
    expect(ReviewQueueBuilder.computeDaysUntilReview({ doc_type: "strategy" })).toBeNull();
  });

  it("returns null for non-string review_date", () => {
    expect(ReviewQueueBuilder.computeDaysUntilReview({
      doc_type: "strategy",
      review_date: 12345,
    })).toBeNull();
  });

  it("returns null for invalid date string", () => {
    expect(ReviewQueueBuilder.computeDaysUntilReview({
      doc_type: "strategy",
      review_date: "not-a-date",
    })).toBeNull();
  });
});

describe("ReviewQueueBuilder.getStaleDocuments", () => {
  it("returns only overdue and missing_review_date documents", () => {
    const overdue = fullDoc("a", { review_date: pastDate(200) });
    const noDate = fullDoc("b", { review_date: undefined });
    const fine = fullDoc("c", { review_date: pastDate(30) });

    const stale = ReviewQueueBuilder.getStaleDocuments([overdue, noDate, fine]);

    expect(stale).toHaveLength(2);
    const ids = stale.map((d) => d.thingId);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });

  it("returns empty when nothing is stale", () => {
    const fine = fullDoc("a", { review_date: pastDate(30) });
    const stale = ReviewQueueBuilder.getStaleDocuments([fine]);
    expect(stale).toHaveLength(0);
  });
});

describe("ReviewQueueBuilder with different document types", () => {
  it("shorter cadence types go overdue faster", () => {
    const meeting = {
      thingId: "m1",
      frontmatter: {
        doc_type: "meeting_note",
        owner: "alice",
        meeting_date: "2025-01-01",
        attendees: ["bob"],
        review_date: pastDate(40),
      },
    };
    const strategy = fullDoc("s1", { review_date: pastDate(40) });

    const queue = ReviewQueueBuilder.build([meeting, strategy]);

    // meeting_note has 30d cadence (40d since = overdue), strategy has 90d (40d since = up_to_date)
    expect(queue.documents[0].thingId).toBe("m1");
    expect(queue.documents[0].stalenessTier).toBe(StalenessTier.Overdue);
    expect(queue.documents[1].stalenessTier).toBe(StalenessTier.UpToDate);
  });
});
