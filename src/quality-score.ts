import { DocumentClassifier } from "./document-types";

export interface QualityScore {
  total: number;
  dimensions: {
    completeness: DimensionScore;
    freshness: DimensionScore;
    relationHealth: DimensionScore;
    activity: DimensionScore;
  };
}

export interface DimensionScore {
  score: number;
  weight: number;
  weighted: number;
  detail: string;
}

export interface RelationData {
  dependsOn: string[];
  enables: string[];
  relatedTo: string[];
  /** IDs known to exist in the system — used to detect broken refs */
  knownThingIds: string[];
}

const REVIEW_CADENCE_DAYS: Record<string, number> = {
  strategy: 90,
  policy: 365,
  proposal: 30,
  report: 90,
  meeting_note: 30,
  decision: 180,
  project: 90,
};

const DEFAULT_REVIEW_CADENCE_DAYS = 90;

function scoreCompleteness(frontmatter: Record<string, unknown>): DimensionScore {
  const docType = frontmatter["doc_type"];

  if (typeof docType !== "string") {
    return {
      score: 0,
      weight: 0.4,
      weighted: 0,
      detail: "Cannot score: no doc_type in frontmatter",
    };
  }

  try {
    const validation = DocumentClassifier.validateRequiredFields(docType, frontmatter);
    const required = DocumentClassifier.getRequiredFields(docType);
    const present = required.length - validation.missing.length;
    const score = required.length > 0 ? (present / required.length) * 100 : 100;

    return {
      score: Math.round(score * 100) / 100,
      weight: 0.4,
      weighted: Math.round(score * 0.4 * 100) / 100,
      detail: validation.valid
        ? `All ${required.length} required fields present`
        : `Missing ${validation.missing.length}/${required.length} fields: ${validation.missing.join(", ")}`,
    };
  } catch {
    return {
      score: 0,
      weight: 0.4,
      weighted: 0,
      detail: "Unknown document type",
    };
  }
}

function scoreFreshness(frontmatter: Record<string, unknown>): DimensionScore {
  const docType = frontmatter["doc_type"];
  const cadenceDays = typeof docType === "string"
    ? (REVIEW_CADENCE_DAYS[docType] || DEFAULT_REVIEW_CADENCE_DAYS)
    : DEFAULT_REVIEW_CADENCE_DAYS;

  const reviewDate = frontmatter["review_date"];
  const updatedAt = frontmatter["updated_at"];
  const referenceDate = getLatestDate(reviewDate, updatedAt);

  if (!referenceDate) {
    const score = 50;
    return {
      score,
      weight: 0.3,
      weighted: score * 0.3,
      detail: "No review_date or updated_at — assuming moderate staleness",
    };
  }

  const daysSince = daysBetween(referenceDate, new Date().toISOString());
  const score = freshnessFromDays(daysSince, cadenceDays);

  const status = daysSince <= cadenceDays ? "within cadence" : "past review date";
  return {
    score,
    weight: 0.3,
    weighted: Math.round(score * 0.3 * 100) / 100,
    detail: `${daysSince} days since ${referenceDate === reviewDate ? "review_date" : "updated_at"} (cadence: ${cadenceDays}d) — ${status}`,
  };
}

function scoreRelationHealth(relationData: RelationData): DimensionScore {
  if (relationData.knownThingIds.length === 0) {
    return {
      score: 0,
      weight: 0.2,
      weighted: 0,
      detail: "Cannot score: no known thing IDs provided",
    };
  }

  const allRefs = [...relationData.dependsOn, ...relationData.enables, ...relationData.relatedTo];
  const uniqueRefs = [...new Set(allRefs)];

  if (uniqueRefs.length === 0) {
    const hasNoRelations = true;
    return {
      score: hasNoRelations ? 0 : 100,
      weight: 0.2,
      weighted: 0,
      detail: "Orphan: no relations to any other documents",
    };
  }

  const knownSet = new Set(relationData.knownThingIds);
  const brokenRefs = uniqueRefs.filter((ref) => !knownSet.has(ref));
  const resolved = uniqueRefs.length - brokenRefs.length;
  const score = uniqueRefs.length > 0 ? (resolved / uniqueRefs.length) * 100 : 100;

  const detail = brokenRefs.length === 0
    ? `All ${uniqueRefs.length} references resolve`
    : `${brokenRefs.length}/${uniqueRefs.length} broken references: ${brokenRefs.join(", ")}`;

  return {
    score: Math.round(score * 100) / 100,
    weight: 0.2,
    weighted: Math.round(score * 0.2 * 100) / 100,
    detail,
  };
}

function scoreActivity(frontmatter: Record<string, unknown>): DimensionScore {
  const updatedAt = frontmatter["updated_at"];

  if (!updatedAt || typeof updatedAt !== "string") {
    return {
      score: 0,
      weight: 0.1,
      weighted: 0,
      detail: "No updated_at field — activity unknown",
    };
  }

  const daysSince = daysBetween(updatedAt, new Date().toISOString());

  let score: number;
  if (daysSince <= 7) {
    score = 100;
  } else if (daysSince <= 30) {
    score = 80;
  } else if (daysSince <= 90) {
    score = 50;
  } else if (daysSince <= 180) {
    score = 25;
  } else {
    score = 0;
  }

  return {
    score,
    weight: 0.1,
    weighted: score * 0.1,
    detail: `${daysSince} days since last update`,
  };
}

function scoreDocument(frontmatter: Record<string, unknown>, relationData?: RelationData): QualityScore {
  const completeness = scoreCompleteness(frontmatter);
  const freshness = scoreFreshness(frontmatter);
  const relationHealth = scoreRelationHealth(relationData || { dependsOn: [], enables: [], relatedTo: [], knownThingIds: [] });
  const activity = scoreActivity(frontmatter);

  const total = Math.round(
    (completeness.weighted + freshness.weighted + relationHealth.weighted + activity.weighted) * 100
  ) / 100;

  return {
    total,
    dimensions: {
      completeness,
      freshness,
      relationHealth,
      activity,
    },
  };
}

function freshnessFromDays(daysSince: number, cadenceDays: number): number {
  const ratio = daysSince / cadenceDays;
  if (ratio <= 1) return Math.round((1 - ratio) * 100 * 100) / 100;
  if (ratio <= 2) return Math.round(Math.max(0, (1 - (ratio - 1)) * 50) * 100) / 100;
  return 0;
}

function daysBetween(dateStr: string, nowStr: string): number {
  const date = new Date(dateStr);
  const now = new Date(nowStr);
  if (isNaN(date.getTime()) || isNaN(now.getTime())) return 9999;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
}

function getLatestDate(a: unknown, b: unknown): string | null {
  const sa = typeof a === "string" ? a : null;
  const sb = typeof b === "string" ? b : null;
  if (!sa && !sb) return null;
  if (!sa) return sb;
  if (!sb) return sa;
  return new Date(sa) >= new Date(sb) ? sa : sb;
}

export const QualityScorer = {
  score: scoreDocument,
  scoreCompleteness,
  scoreFreshness,
  scoreRelationHealth,
  scoreActivity,
};
