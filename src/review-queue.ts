import { QualityScorer, QualityScore, RelationData } from "./quality-score";

export enum StalenessTier {
  MissingReviewDate = "missing_review_date",
  Overdue = "overdue",
  Approaching = "approaching",
  DueSoon = "due_soon",
  UpToDate = "up_to_date",
}

export interface QueuedDocument {
  thingId: string;
  frontmatter: Record<string, unknown>;
  qualityScore: QualityScore;
  stalenessTier: StalenessTier;
  daysUntilReview: number | null;
  priority: number;
}

export interface ReviewQueue {
  documents: QueuedDocument[];
  summary: QueueSummary;
}

export interface QueueSummary {
  total: number;
  byTier: Record<StalenessTier, number>;
  byDocumentType: Record<string, number>;
  averageQuality: number;
}

export interface QueueOptions {
  approachingDays?: number;
  dueSoonDays?: number;
  maxDocuments?: number;
}

const DEFAULT_OPTIONS: Required<QueueOptions> = {
  approachingDays: 7,
  dueSoonDays: 30,
  maxDocuments: 100,
};

const REVIEW_CADENCE_DAYS: Record<string, number> = {
  strategy: 90,
  policy: 365,
  proposal: 30,
  report: 90,
  meeting_note: 30,
  decision: 180,
  project: 90,
};

const DEFAULT_CADENCE_DAYS = 90;

const TIER_PRIORITY: Record<StalenessTier, number> = {
  [StalenessTier.MissingReviewDate]: 0,
  [StalenessTier.Overdue]: 1,
  [StalenessTier.Approaching]: 2,
  [StalenessTier.DueSoon]: 3,
  [StalenessTier.UpToDate]: 4,
};

interface DocumentInput {
  thingId: string;
  frontmatter: Record<string, unknown>;
  relationData?: RelationData;
}

function buildQueue(documents: DocumentInput[], options: QueueOptions = {}): ReviewQueue {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const scored = documents.map((doc) => {
    const qualityScore = QualityScorer.score(doc.frontmatter, doc.relationData);
    const cadenceDays = getCadenceDays(doc.frontmatter);
    const daysUntilReview = computeDaysUntilReview(doc.frontmatter, cadenceDays);
    const stalenessTier = classifyStaleness(daysUntilReview, opts);
    const priority = computePriority(stalenessTier, qualityScore.total);

    return {
      thingId: doc.thingId,
      frontmatter: doc.frontmatter,
      qualityScore,
      stalenessTier,
      daysUntilReview,
      priority,
    };
  });

  scored.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.qualityScore.total - a.qualityScore.total;
  });

  const limited = scored.slice(0, opts.maxDocuments);

  const summary = buildSummary(limited);

  return { documents: limited, summary };
}

function classifyStaleness(daysUntilReview: number | null, opts: Required<QueueOptions>): StalenessTier {
  if (daysUntilReview === null) return StalenessTier.MissingReviewDate;
  if (daysUntilReview < 0) return StalenessTier.Overdue;
  if (daysUntilReview <= opts.approachingDays) return StalenessTier.Approaching;
  if (daysUntilReview <= opts.dueSoonDays) return StalenessTier.DueSoon;
  return StalenessTier.UpToDate;
}

function computePriority(tier: StalenessTier, qualityScore: number): number {
  const base = TIER_PRIORITY[tier] * 1000;
  const qualityPenalty = Math.round((100 - qualityScore) * 10);
  return base + qualityPenalty;
}

function computeDaysUntilReview(
  frontmatter: Record<string, unknown>,
  cadenceDays?: number
): number | null {
  const reviewDate = frontmatter["review_date"];
  if (!reviewDate || typeof reviewDate !== "string") return null;

  const review = new Date(reviewDate);
  const now = new Date();
  if (isNaN(review.getTime())) return null;

  const daysSinceLastReview = Math.floor((now.getTime() - review.getTime()) / 86400000);
  const cadence = cadenceDays ?? getCadenceDays(frontmatter);
  return cadence - daysSinceLastReview;
}

function getCadenceDays(frontmatter: Record<string, unknown>): number {
  const docType = frontmatter["doc_type"];
  if (typeof docType !== "string") return DEFAULT_CADENCE_DAYS;
  return REVIEW_CADENCE_DAYS[docType] || DEFAULT_CADENCE_DAYS;
}

function buildSummary(documents: QueuedDocument[]): QueueSummary {
  const byTier: Record<StalenessTier, number> = {
    [StalenessTier.MissingReviewDate]: 0,
    [StalenessTier.Overdue]: 0,
    [StalenessTier.Approaching]: 0,
    [StalenessTier.DueSoon]: 0,
    [StalenessTier.UpToDate]: 0,
  };

  const byDocumentType: Record<string, number> = {};
  let qualitySum = 0;

  for (const doc of documents) {
    byTier[doc.stalenessTier]++;
    const docType = typeof doc.frontmatter["doc_type"] === "string" ? doc.frontmatter["doc_type"] : "unknown";
    byDocumentType[docType] = (byDocumentType[docType] || 0) + 1;
    qualitySum += doc.qualityScore.total;
  }

  const averageQuality = documents.length > 0
    ? Math.round((qualitySum / documents.length) * 100) / 100
    : 0;

  return { total: documents.length, byTier, byDocumentType, averageQuality };
}

function getStaleDocuments(documents: DocumentInput[], options: QueueOptions = {}): DocumentInput[] {
  const queue = buildQueue(documents, options);
  return queue.documents
    .filter((d) =>
      d.stalenessTier === StalenessTier.Overdue ||
      d.stalenessTier === StalenessTier.MissingReviewDate
    )
    .map((d) => ({
      thingId: d.thingId,
      frontmatter: d.frontmatter,
    }));
}

export const ReviewQueueBuilder = {
  build: buildQueue,
  getStaleDocuments,
  classifyStaleness,
  computeDaysUntilReview,
};
