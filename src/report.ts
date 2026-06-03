import { QualityScorer, type RelationData } from "./quality-score";
import { ReviewQueueBuilder, StalenessTier } from "./review-queue";
import { DependencyAnalyzer, type DependencyNode } from "./dependency-analyzer";
import { DocumentClassifier } from "./document-types";

export interface SdmDocument {
  thing_id: string;
  file_path: string;
  frontmatter: Record<string, unknown>;
  relations: { depends_on: string[]; enables: string[]; related_to: string[] };
}
export interface ScannerLike {
  scan(): { documents: SdmDocument[]; errors: string[] };
}
export type ReviewStatus = "overdue" | "approaching" | "due_soon" | "missing_review_date" | "ok";
export interface GovernanceDocument {
  thing_id: string; file_path: string; title: string; document_type: string;
  lifecycle_state: string; owner: string; quality_score: number;
  quality_dimensions: { completeness: number; freshness: number; relation_health: number; activity: number };
  review_status: ReviewStatus; days_until_review: number | null; is_orphan: boolean;
}
export interface GovernanceReport {
  id: string; timestamp: string; vault_path: string; duration_ms: number;
  summary: {
    total_documents: number;
    lifecycle: { by_state: Record<string, number> };
    quality: { high: number; medium: number; low: number; average: number };
    review_queue: { overdue: number; approaching: number; due_soon: number; missing_review_date: number };
    dependencies: { orphan_count: number; cycle_count: number };
  };
  documents: GovernanceDocument[]; cycles: string[][]; orphans: string[]; scan_errors: string[];
}
export interface BuildOptions { now: string; vaultPath?: string; durationMs?: number; scanErrors?: string[] }

const QUALITY_HIGH = 80;
const QUALITY_MEDIUM = 50;
const STALENESS_TO_STATUS: Record<StalenessTier, ReviewStatus> = {
  [StalenessTier.Overdue]: "overdue",
  [StalenessTier.Approaching]: "approaching",
  [StalenessTier.DueSoon]: "due_soon",
  [StalenessTier.MissingReviewDate]: "missing_review_date",
  [StalenessTier.UpToDate]: "ok",
};
function str(v: unknown): string { return typeof v === "string" ? v : ""; }

export function buildGovernanceReport(docs: SdmDocument[], options: BuildOptions): GovernanceReport {
  const knownThingIds = docs.map((d) => d.thing_id);
  const byId = new Map(docs.map((d) => [d.thing_id, d]));
  const queueInputs = docs.map((d) => ({
    thingId: d.thing_id, frontmatter: d.frontmatter,
    relationData: { dependsOn: d.relations.depends_on, enables: d.relations.enables, relatedTo: d.relations.related_to, knownThingIds } as RelationData,
  }));
  const queue = ReviewQueueBuilder.build(queueInputs, { maxDocuments: Math.max(docs.length, 1) });
  const depNodes: DependencyNode[] = docs.map((d) => ({
    thingId: d.thing_id, dependsOn: d.relations.depends_on, enables: d.relations.enables, relatedTo: d.relations.related_to,
    lifecycleState: str(d.frontmatter["lifecycle_state"]), docType: str(d.frontmatter["doc_type"]),
  }));
  const cycles = DependencyAnalyzer.findCycles(depNodes);
  const orphans = DependencyAnalyzer.findOrphans(depNodes).map((n) => n.thingId);
  const orphanSet = new Set(orphans);
  const lifecycleByState: Record<string, number> = {};
  for (const d of docs) { const s = str(d.frontmatter["lifecycle_state"]) || "unknown"; lifecycleByState[s] = (lifecycleByState[s] ?? 0) + 1; }
  let high = 0, medium = 0, low = 0;
  const documents: GovernanceDocument[] = queue.documents.map((q) => {
    const src = byId.get(q.thingId); const fm = q.frontmatter; const total = q.qualityScore.total;
    if (total >= QUALITY_HIGH) high++; else if (total >= QUALITY_MEDIUM) medium++; else low++;
    return {
      thing_id: q.thingId, file_path: src?.file_path ?? "", title: str(fm["title"]) || q.thingId,
      document_type: DocumentClassifier.classify(fm).documentType ?? "unknown",
      lifecycle_state: str(fm["lifecycle_state"]) || "unknown", owner: str(fm["owner"]),
      quality_score: total,
      quality_dimensions: {
        completeness: q.qualityScore.dimensions.completeness.score, freshness: q.qualityScore.dimensions.freshness.score,
        relation_health: q.qualityScore.dimensions.relationHealth.score, activity: q.qualityScore.dimensions.activity.score,
      },
      review_status: STALENESS_TO_STATUS[q.stalenessTier], days_until_review: q.daysUntilReview, is_orphan: orphanSet.has(q.thingId),
    };
  });
  const byTier = queue.summary.byTier;
  return {
    id: `SDM_GOV_${options.now.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`,
    timestamp: options.now, vault_path: options.vaultPath ?? "", duration_ms: options.durationMs ?? 0,
    summary: {
      total_documents: docs.length, lifecycle: { by_state: lifecycleByState },
      quality: { high, medium, low, average: docs.length ? queue.summary.averageQuality : 0 },
      review_queue: {
        overdue: byTier[StalenessTier.Overdue] ?? 0, approaching: byTier[StalenessTier.Approaching] ?? 0,
        due_soon: byTier[StalenessTier.DueSoon] ?? 0, missing_review_date: byTier[StalenessTier.MissingReviewDate] ?? 0,
      },
      dependencies: { orphan_count: orphans.length, cycle_count: cycles.length },
    },
    documents, cycles, orphans, scan_errors: options.scanErrors ?? [],
  };
}

export function reportToJSON(report: GovernanceReport): string { return JSON.stringify(report, null, 2); }

export function reportToMarkdown(report: GovernanceReport): string {
  const s = report.summary; const lines: string[] = [];
  lines.push(`# Governance Report`); lines.push("");
  lines.push(`- **Documents:** ${s.total_documents}`);
  lines.push(`- **Quality:** avg ${s.quality.average} · ${s.quality.high} high / ${s.quality.medium} medium / ${s.quality.low} low`);
  lines.push(`- **Review queue:** ${s.review_queue.overdue} overdue · ${s.review_queue.approaching} approaching · ${s.review_queue.due_soon} due soon · ${s.review_queue.missing_review_date} missing date`);
  lines.push(`- **Dependencies:** ${s.dependencies.cycle_count} cycles · ${s.dependencies.orphan_count} orphans`);
  lines.push(""); lines.push(`## Lifecycle`);
  for (const [state, count] of Object.entries(s.lifecycle.by_state)) lines.push(`- ${state}: ${count}`);
  lines.push(""); lines.push(`## Documents`);
  lines.push(`| ID | Type | State | Quality | Review |`); lines.push(`|---|---|---|---|---|`);
  for (const d of report.documents) lines.push(`| ${d.thing_id} | ${d.document_type} | ${d.lifecycle_state} | ${d.quality_score} | ${d.review_status} |`);
  if (report.cycles.length) { lines.push(""); lines.push(`## Dependency cycles`); for (const c of report.cycles) lines.push(`- ${c.join(" → ")}`); }
  if (report.scan_errors.length) { lines.push(""); lines.push(`## Scan errors`); for (const e of report.scan_errors) lines.push(`- ${e}`); }
  return lines.join("\n") + "\n";
}
