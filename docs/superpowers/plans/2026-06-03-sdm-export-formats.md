# Governance Report Export Formats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a consolidated Governance Report (lifecycle, quality, review queue, dependency cycles/orphans) from Strategic Document Management in four formats — JSON, Markdown, HTML, MDX — via both in-Obsidian buttons and a headless `utd-sdm` CLI.

**Architecture:** A pure `buildGovernanceReport(SdmDocument[]) → GovernanceReport` composes the existing pure engines (`QualityScorer`, `ReviewQueueBuilder`, `DependencyAnalyzer`, `DocumentClassifier`). Four pure serializers render the report. Two scanners (Obsidian via `metadataService`, CLI via `gray-matter`) satisfy one `ScannerLike` contract so the builder is source-agnostic. A `cli.ts` wires scan → build → serialize → stdout/file/exit-code.

**Tech Stack:** TypeScript, esbuild, Vitest, gray-matter. `obsidian` is externalized (types only). Existing modules: `quality-score`, `review-queue`, `dependency-analyzer`, `document-types`, `lifecycle`.

---

## Reference: existing APIs this plan calls

```ts
// quality-score.ts
QualityScorer.score(frontmatter: Record<string,unknown>, relationData?: RelationData): QualityScore
interface RelationData { dependsOn: string[]; enables: string[]; relatedTo: string[]; knownThingIds: string[] }
interface QualityScore { total: number; dimensions: { completeness: DimensionScore; freshness: DimensionScore; relationHealth: DimensionScore; activity: DimensionScore } }
interface DimensionScore { score: number; weight: number; weighted: number; detail: string }

// review-queue.ts
ReviewQueueBuilder.build(docs: { thingId: string; frontmatter: Record<string,unknown>; relationData?: RelationData }[], options?: { approachingDays?; dueSoonDays?; maxDocuments? }): ReviewQueue
enum StalenessTier { MissingReviewDate="missing_review_date", Overdue="overdue", Approaching="approaching", DueSoon="due_soon", UpToDate="up_to_date" }
interface QueuedDocument { thingId; frontmatter; qualityScore: QualityScore; stalenessTier: StalenessTier; daysUntilReview: number|null; priority: number }
interface ReviewQueue { documents: QueuedDocument[]; summary: { total; byTier: Record<StalenessTier,number>; byDocumentType: Record<string,number>; averageQuality: number } }

// dependency-analyzer.ts
DependencyAnalyzer.findCycles(nodes: DependencyNode[]): string[][]
DependencyAnalyzer.findOrphans(nodes: DependencyNode[]): DependencyNode[]
interface DependencyNode { thingId; dependsOn: string[]; enables: string[]; relatedTo: string[]; lifecycleState?: string; docType?: string }

// document-types.ts
DocumentClassifier.classify(frontmatter: Record<string,unknown>): { documentType: DocumentType|null; confidence; matchReason }
```

**Canonical frontmatter keys:** `thing_id`, `title`, `owner`, `doc_type`, `lifecycle_state`, `review_date`, `updated_at`, `depends_on`, `enables`, `related_to`.
**Quality bands (match the dashboard exactly):** `high` ≥ 80, `medium` ≥ 50, else `low`.
**StalenessTier → review_status:** `Overdue`→`"overdue"`, `Approaching`→`"approaching"`, `DueSoon`→`"due_soon"`, `MissingReviewDate`→`"missing_review_date"`, `UpToDate`→`"ok"`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/report.ts` (create) | `SdmDocument`/`ScannerLike` contract, `GovernanceReport`/`GovernanceDocument` types, `buildGovernanceReport`, `reportToJSON`, `reportToMarkdown` |
| `src/report-html.ts` (create) | `reportToHTML` |
| `src/report-mdx.ts` (create) | `reportToMDX` |
| `src/filesystem-scanner.ts` (create) | `FileSystemScanner` (gray-matter) |
| `src/obsidian-scanner.ts` (create) | `ObsidianScanner` (wraps `metadataService`), extracted from the view |
| `src/cli.ts` (create) | CLI entry: parse args, scan, build, serialize, `--ci` exit codes |
| `src/main.ts` (modify) | register four export commands |
| `src/views/StrategicDocumentView.ts` (modify) | add four export buttons; use `ObsidianScanner` |
| `package.json` (modify) | add `gray-matter`, `build:cli`, `bin` |
| `tests/report.test.ts` (create) | builder + JSON/MD serializers |
| `tests/report-html.test.ts` (create) | HTML serializer |
| `tests/report-mdx.test.ts` (create) | MDX serializer |
| `tests/filesystem-scanner.test.ts` (create) | filesystem scan incl. error surfacing |
| `tests/e2e.test.ts` (create) | CLI against the test vault, `--ci` gates |

---

## Task 1: Tooling — gray-matter, build:cli, bin

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the runtime dependency**

Run: `npm install gray-matter`
Expected: `gray-matter` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Add the CLI build script and bin**

In `package.json`, add to `"scripts"`:

```json
"build:cli": "esbuild src/cli.ts --bundle --outfile=dist/cli.js --format=cjs --platform=node --external:obsidian --banner:js='#!/usr/bin/env node'"
```

And add a top-level `"bin"` entry:

```json
"bin": { "utd-sdm": "./dist/cli.js" }
```

- [ ] **Step 3: Ignore the build output**

Confirm `.gitignore` contains `dist/`. If not, add it.

Run: `grep -q '^dist/' .gitignore && echo present || echo "ADD dist/"`
Expected: `present`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: add gray-matter, build:cli script, and utd-sdm bin"
```

---

## Task 2: Report contract, types, and `buildGovernanceReport`

**Files:**
- Create: `src/report.ts`
- Test: `tests/report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/report.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/report.test.ts`
Expected: FAIL — `Cannot find module '../src/report'`.

- [ ] **Step 3: Implement `src/report.ts` (types + builder + JSON/MD)**

```ts
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
  thing_id: string;
  file_path: string;
  title: string;
  document_type: string;
  lifecycle_state: string;
  owner: string;
  quality_score: number;
  quality_dimensions: { completeness: number; freshness: number; relation_health: number; activity: number };
  review_status: ReviewStatus;
  days_until_review: number | null;
  is_orphan: boolean;
}

export interface GovernanceReport {
  id: string;
  timestamp: string;
  vault_path: string;
  duration_ms: number;
  summary: {
    total_documents: number;
    lifecycle: { by_state: Record<string, number> };
    quality: { high: number; medium: number; low: number; average: number };
    review_queue: { overdue: number; approaching: number; due_soon: number; missing_review_date: number };
    dependencies: { orphan_count: number; cycle_count: number };
  };
  documents: GovernanceDocument[];
  cycles: string[][];
  orphans: string[];
  scan_errors: string[];
}

export interface BuildOptions {
  now: string;        // ISO timestamp (injected for deterministic tests)
  vaultPath?: string;
  durationMs?: number;
  scanErrors?: string[];
}

const QUALITY_HIGH = 80;
const QUALITY_MEDIUM = 50;

const STALENESS_TO_STATUS: Record<StalenessTier, ReviewStatus> = {
  [StalenessTier.Overdue]: "overdue",
  [StalenessTier.Approaching]: "approaching",
  [StalenessTier.DueSoon]: "due_soon",
  [StalenessTier.MissingReviewDate]: "missing_review_date",
  [StalenessTier.UpToDate]: "ok",
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function buildGovernanceReport(docs: SdmDocument[], options: BuildOptions): GovernanceReport {
  const knownThingIds = docs.map((d) => d.thing_id);
  const byId = new Map(docs.map((d) => [d.thing_id, d]));

  const queueInputs = docs.map((d) => ({
    thingId: d.thing_id,
    frontmatter: d.frontmatter,
    relationData: {
      dependsOn: d.relations.depends_on,
      enables: d.relations.enables,
      relatedTo: d.relations.related_to,
      knownThingIds,
    } as RelationData,
  }));
  // maxDocuments large so the report includes every document (the queue default truncates to 100).
  const queue = ReviewQueueBuilder.build(queueInputs, { maxDocuments: Math.max(docs.length, 1) });

  const depNodes: DependencyNode[] = docs.map((d) => ({
    thingId: d.thing_id,
    dependsOn: d.relations.depends_on,
    enables: d.relations.enables,
    relatedTo: d.relations.related_to,
    lifecycleState: str(d.frontmatter["lifecycle_state"]),
    docType: str(d.frontmatter["doc_type"]),
  }));
  const cycles = DependencyAnalyzer.findCycles(depNodes);
  const orphans = DependencyAnalyzer.findOrphans(depNodes).map((n) => n.thingId);
  const orphanSet = new Set(orphans);

  const lifecycleByState: Record<string, number> = {};
  for (const d of docs) {
    const state = str(d.frontmatter["lifecycle_state"]) || "unknown";
    lifecycleByState[state] = (lifecycleByState[state] ?? 0) + 1;
  }

  let high = 0, medium = 0, low = 0;
  const documents: GovernanceDocument[] = queue.documents.map((q) => {
    const src = byId.get(q.thingId);
    const fm = q.frontmatter;
    const total = q.qualityScore.total;
    if (total >= QUALITY_HIGH) high++; else if (total >= QUALITY_MEDIUM) medium++; else low++;
    return {
      thing_id: q.thingId,
      file_path: src?.file_path ?? "",
      title: str(fm["title"]) || q.thingId,
      document_type: DocumentClassifier.classify(fm).documentType ?? "unknown",
      lifecycle_state: str(fm["lifecycle_state"]) || "unknown",
      owner: str(fm["owner"]),
      quality_score: total,
      quality_dimensions: {
        completeness: q.qualityScore.dimensions.completeness.score,
        freshness: q.qualityScore.dimensions.freshness.score,
        relation_health: q.qualityScore.dimensions.relationHealth.score,
        activity: q.qualityScore.dimensions.activity.score,
      },
      review_status: STALENESS_TO_STATUS[q.stalenessTier],
      days_until_review: q.daysUntilReview,
      is_orphan: orphanSet.has(q.thingId),
    };
  });

  const byTier = queue.summary.byTier;
  return {
    id: `SDM_GOV_${options.now.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`,
    timestamp: options.now,
    vault_path: options.vaultPath ?? "",
    duration_ms: options.durationMs ?? 0,
    summary: {
      total_documents: docs.length,
      lifecycle: { by_state: lifecycleByState },
      quality: { high, medium, low, average: docs.length ? queue.summary.averageQuality : 0 },
      review_queue: {
        overdue: byTier[StalenessTier.Overdue] ?? 0,
        approaching: byTier[StalenessTier.Approaching] ?? 0,
        due_soon: byTier[StalenessTier.DueSoon] ?? 0,
        missing_review_date: byTier[StalenessTier.MissingReviewDate] ?? 0,
      },
      dependencies: { orphan_count: orphans.length, cycle_count: cycles.length },
    },
    documents,
    cycles,
    orphans,
    scan_errors: options.scanErrors ?? [],
  };
}

export function reportToJSON(report: GovernanceReport): string {
  return JSON.stringify(report, null, 2);
}

export function reportToMarkdown(report: GovernanceReport): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push(`# Governance Report`);
  lines.push("");
  lines.push(`- **Documents:** ${s.total_documents}`);
  lines.push(`- **Quality:** avg ${s.quality.average} · ${s.quality.high} high / ${s.quality.medium} medium / ${s.quality.low} low`);
  lines.push(`- **Review queue:** ${s.review_queue.overdue} overdue · ${s.review_queue.approaching} approaching · ${s.review_queue.due_soon} due soon · ${s.review_queue.missing_review_date} missing date`);
  lines.push(`- **Dependencies:** ${s.dependencies.cycle_count} cycles · ${s.dependencies.orphan_count} orphans`);
  lines.push("");
  lines.push(`## Lifecycle`);
  for (const [state, count] of Object.entries(s.lifecycle.by_state)) lines.push(`- ${state}: ${count}`);
  lines.push("");
  lines.push(`## Documents`);
  lines.push(`| ID | Type | State | Quality | Review |`);
  lines.push(`|---|---|---|---|---|`);
  for (const d of report.documents) {
    lines.push(`| ${d.thing_id} | ${d.document_type} | ${d.lifecycle_state} | ${d.quality_score} | ${d.review_status} |`);
  }
  if (report.cycles.length) {
    lines.push("");
    lines.push(`## Dependency cycles`);
    for (const cycle of report.cycles) lines.push(`- ${cycle.join(" → ")}`);
  }
  if (report.scan_errors.length) {
    lines.push("");
    lines.push(`## Scan errors`);
    for (const e of report.scan_errors) lines.push(`- ${e}`);
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/report.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add JSON/Markdown serializer assertions**

Append to `tests/report.test.ts`:

```ts
describe("serializers", () => {
  const docs: SdmDocument[] = [makeDoc({ thing_id: "a", frontmatter: { doc_type: "strategy", lifecycle_state: "approved" } })];
  const report = buildGovernanceReport(docs, { now: NOW, scanErrors: [] });

  it("reportToJSON round-trips", () => {
    expect(JSON.parse(reportToJSON(report)).summary.total_documents).toBe(1);
  });

  it("reportToMarkdown includes summary and the document row", () => {
    const md = reportToMarkdown(report);
    expect(md).toContain("# Governance Report");
    expect(md).toContain("| a | strategy | approved |");
  });
});
```

- [ ] **Step 6: Run and verify pass**

Run: `npx vitest run tests/report.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/report.ts tests/report.test.ts
git commit -m "feat: GovernanceReport builder + JSON/Markdown serializers"
```

---

## Task 3: HTML serializer

**Files:**
- Create: `src/report-html.ts`
- Test: `tests/report-html.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/report-html.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/report-html.test.ts`
Expected: FAIL — cannot find `../src/report-html`.

- [ ] **Step 3: Implement `src/report-html.ts`**

```ts
import type { GovernanceReport, GovernanceDocument } from "./report";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function qualityColor(score: number): string {
  return score >= 80 ? "#16a34a" : score >= 50 ? "#ea580c" : "#dc2626";
}

function row(d: GovernanceDocument): string {
  return `<tr><td>${esc(d.thing_id)}</td><td>${esc(d.title)}</td><td>${esc(d.document_type)}</td>`
    + `<td>${esc(d.lifecycle_state)}</td>`
    + `<td style="color:${qualityColor(d.quality_score)};font-weight:600">${d.quality_score}</td>`
    + `<td>${esc(d.review_status)}</td></tr>`;
}

export function reportToHTML(report: GovernanceReport): string {
  const s = report.summary;
  const lifecycle = Object.entries(s.lifecycle.by_state)
    .map(([state, n]) => `<li>${esc(state)}: ${n}</li>`).join("");
  const docRows = report.documents.map(row).join("");
  const cycles = report.cycles.length
    ? `<h2>Dependency cycles (${report.cycles.length})</h2><ul>${report.cycles.map((c) => `<li>${c.map(esc).join(" → ")}</li>`).join("")}</ul>`
    : "";
  const errors = report.scan_errors.length
    ? `<h2>Scan errors</h2><ul>${report.scan_errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Governance Report</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#1f2937}
 h1{margin-bottom:4px} .meta{color:#6b7280;font-size:13px}
 .cards{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
 .card{border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;min-width:120px}
 .card .n{font-size:24px;font-weight:700}
 table{border-collapse:collapse;width:100%;margin:8px 0}
 th,td{border:1px solid #e5e7eb;padding:6px 10px;text-align:left;font-size:14px}
 th{background:#f9fafb}
</style></head><body>
<h1>Governance Report</h1>
<div class="meta">${esc(report.id)} · ${esc(report.timestamp)} · ${esc(report.vault_path)} · ${report.duration_ms}ms</div>
<div class="cards">
 <div class="card"><div class="n">${s.total_documents}</div>documents</div>
 <div class="card"><div class="n">${s.quality.average}</div>avg quality</div>
 <div class="card"><div class="n">${s.review_queue.overdue}</div>overdue</div>
 <div class="card"><div class="n">${s.dependencies.cycle_count}</div>cycles</div>
 <div class="card"><div class="n">${s.dependencies.orphan_count}</div>orphans</div>
</div>
<h2>Lifecycle</h2><ul>${lifecycle}</ul>
<h2>Documents</h2>
<table><thead><tr><th>ID</th><th>Title</th><th>Type</th><th>State</th><th>Quality</th><th>Review</th></tr></thead>
<tbody>${docRows}</tbody></table>
${cycles}
${errors}
</body></html>`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/report-html.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/report-html.ts tests/report-html.test.ts
git commit -m "feat: HTML governance report serializer"
```

---

## Task 4: MDX serializer

**Files:**
- Create: `src/report-mdx.ts`
- Test: `tests/report-mdx.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/report-mdx.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/report-mdx.test.ts`
Expected: FAIL — cannot find `../src/report-mdx`.

- [ ] **Step 3: Implement `src/report-mdx.ts`**

```ts
import type { GovernanceReport } from "./report";

function escCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function reportToMDX(report: GovernanceReport): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push("---");
  lines.push(`id: "${report.id}"`);
  lines.push(`timestamp: "${report.timestamp}"`);
  lines.push(`total_documents: ${s.total_documents}`);
  lines.push(`average_quality: ${s.quality.average}`);
  lines.push("---");
  lines.push("");
  lines.push(`export const governanceData = ${JSON.stringify(report)};`);
  lines.push("");
  lines.push("# Governance Report");
  lines.push("");
  lines.push(`**${s.total_documents} documents** · avg quality ${s.quality.average} · `
    + `${s.review_queue.overdue} overdue · ${s.dependencies.cycle_count} cycles · ${s.dependencies.orphan_count} orphans`);
  lines.push("");
  lines.push("## Documents");
  lines.push("");
  lines.push("| ID | Type | State | Quality | Review |");
  lines.push("|---|---|---|---|---|");
  for (const d of report.documents) {
    lines.push(`| ${escCell(d.thing_id)} | ${escCell(d.document_type)} | ${escCell(d.lifecycle_state)} | ${d.quality_score} | ${escCell(d.review_status)} |`);
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/report-mdx.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/report-mdx.ts tests/report-mdx.test.ts
git commit -m "feat: MDX governance report serializer"
```

---

## Task 5: FileSystemScanner (CLI data source)

**Files:**
- Create: `src/filesystem-scanner.ts`
- Test: `tests/filesystem-scanner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/filesystem-scanner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FileSystemScanner } from "../src/filesystem-scanner";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function tempVault(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdm-test-"));
  for (const [p, c] of Object.entries(files)) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, c, "utf-8");
  }
  return dir;
}

describe("FileSystemScanner", () => {
  it("parses frontmatter and relations", () => {
    const vault = tempVault({
      "a.md": "---\nthing_id: a\ndoc_type: strategy\ndepends_on:\n  - b\n---\nbody",
    });
    try {
      const { documents, errors } = new FileSystemScanner().scan(vault);
      expect(errors).toHaveLength(0);
      expect(documents).toHaveLength(1);
      expect(documents[0].thing_id).toBe("a");
      expect(documents[0].relations.depends_on).toEqual(["b"]);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it("surfaces unreadable directories as errors instead of failing silently", () => {
    const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;
    if (runningAsRoot) return;
    const vault = tempVault({ "ok.md": "---\nthing_id: ok\n---\n", "locked/x.md": "---\nthing_id: x\n---\n" });
    const locked = path.join(vault, "locked");
    fs.chmodSync(locked, 0o000);
    try {
      const { documents, errors } = new FileSystemScanner().scan(vault);
      expect(documents.some((d) => d.thing_id === "ok")).toBe(true);
      expect(errors.some((e) => /cannot read directory/i.test(e))).toBe(true);
    } finally {
      fs.chmodSync(locked, 0o755);
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/filesystem-scanner.test.ts`
Expected: FAIL — cannot find `../src/filesystem-scanner`.

- [ ] **Step 3: Implement `src/filesystem-scanner.ts`**

```ts
import * as fs from "fs";
import * as path from "path";
import type { SdmDocument, ScannerLike } from "./report";

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}

export class FileSystemScanner implements ScannerLike {
  constructor(private readonly vaultPath: string = "") {}

  scan(vaultPath: string = this.vaultPath): { documents: SdmDocument[]; errors: string[] } {
    const errors: string[] = [];
    const documents: SdmDocument[] = [];
    if (!fs.existsSync(vaultPath)) {
      return { documents, errors: [`Vault path does not exist: ${vaultPath}`] };
    }
    const matter = require("gray-matter");
    for (const file of this.walk(vaultPath, ".md", errors)) {
      const rel = path.relative(vaultPath, file).replace(/\\/g, "/");
      try {
        const fm = (matter(fs.readFileSync(file, "utf-8")).data || {}) as Record<string, unknown>;
        documents.push({
          thing_id: typeof fm["thing_id"] === "string" ? (fm["thing_id"] as string) : `__missing_${documents.length}`,
          file_path: rel,
          frontmatter: fm,
          relations: {
            depends_on: toStringArray(fm["depends_on"]),
            enables: toStringArray(fm["enables"]),
            related_to: toStringArray(fm["related_to"]),
          },
        });
      } catch (err) {
        errors.push(`Failed to parse ${rel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { documents, errors };
  }

  private walk(dir: string, ext: string, errors: string[]): string[] {
    const out: string[] = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...this.walk(full, ext, errors));
        else if (entry.isFile() && entry.name.endsWith(ext)) out.push(full);
      }
    } catch (err) {
      errors.push(`Cannot read directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return out;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/filesystem-scanner.test.ts`
Expected: PASS (2 tests; the unreadable-dir test is skipped under root).

- [ ] **Step 5: Commit**

```bash
git add src/filesystem-scanner.ts tests/filesystem-scanner.test.ts
git commit -m "feat: FileSystemScanner for headless governance scans"
```

---

## Task 6: ObsidianScanner (extract the view's data path)

**Files:**
- Create: `src/obsidian-scanner.ts`
- Modify: `src/views/StrategicDocumentView.ts`

- [ ] **Step 1: Implement `src/obsidian-scanner.ts`**

```ts
import type { SdmDocument, ScannerLike } from "./report";

interface DocumentEntry {
  thing_id: string;
  file_path: string;
  frontmatter: Record<string, unknown>;
}

export interface UTDMetadataService {
  listThings(filter: Record<string, unknown>): DocumentEntry[];
  getRelations(thingId: string): { depends_on?: string[]; enables?: string[]; related_to?: string[] } | null;
  getAllThingIds(): Set<string>;
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export class ObsidianScanner implements ScannerLike {
  constructor(private readonly api: UTDMetadataService) {}

  scan(): { documents: SdmDocument[]; errors: string[] } {
    const entries = this.api.listThings({ thing_type: "strategic_documentation" });
    const documents: SdmDocument[] = entries.map((e) => {
      const r = this.api.getRelations(e.thing_id) ?? {};
      return {
        thing_id: e.thing_id,
        file_path: e.file_path,
        frontmatter: e.frontmatter,
        relations: {
          depends_on: toStringArray(r.depends_on),
          enables: toStringArray(r.enables),
          related_to: toStringArray(r.related_to),
        },
      };
    });
    return { documents, errors: [] };
  }
}
```

- [ ] **Step 2: Verify the view still compiles using the new scanner type (optional refactor)**

Confirm `src/views/StrategicDocumentView.ts` can import `UTDMetadataService` from `../obsidian-scanner` rather than redefining it. This is a non-behavioral cleanup — do not change the dashboard logic.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/obsidian-scanner.ts src/views/StrategicDocumentView.ts
git commit -m "feat: ObsidianScanner shared by dashboard and export"
```

---

## Task 7: CLI

**Files:**
- Create: `src/cli.ts`
- Test: `tests/e2e.test.ts` (covers the CI gate via the test vault — see Task 8)

- [ ] **Step 1: Implement `src/cli.ts`**

```ts
import * as fs from "fs";
import { FileSystemScanner } from "./filesystem-scanner";
import { buildGovernanceReport, reportToJSON, reportToMarkdown, type GovernanceReport } from "./report";
import { reportToHTML } from "./report-html";
import { reportToMDX } from "./report-mdx";

type Format = "json" | "markdown" | "html" | "mdx";

interface CliArgs {
  vaultPath: string;
  format: Format;
  output?: string;
  ci: boolean;
  minScore: number;
  verbose: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const out: CliArgs = { vaultPath: "", format: "json", ci: false, minScore: 60, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--format") out.format = args[++i] as Format;
    else if (a === "--output") out.output = args[++i];
    else if (a === "--html") out.format = "html";
    else if (a === "--ci") out.ci = true;
    else if (a === "--min-score") out.minScore = Number(args[++i]);
    else if (a === "--verbose") out.verbose = true;
    else if (!a.startsWith("--")) out.vaultPath = a;
  }
  return out;
}

export function serialize(report: GovernanceReport, format: Format): string {
  switch (format) {
    case "json": return reportToJSON(report);
    case "markdown": return reportToMarkdown(report);
    case "html": return reportToHTML(report);
    case "mdx": return reportToMDX(report);
  }
}

/** Returns the list of tripped gates (empty = clean). All gates are always on. */
export function evaluateCiGates(report: GovernanceReport, minScore: number): string[] {
  const failures: string[] = [];
  if (report.summary.dependencies.cycle_count > 0) failures.push(`${report.summary.dependencies.cycle_count} dependency cycle(s)`);
  if (report.summary.review_queue.overdue > 0) failures.push(`${report.summary.review_queue.overdue} overdue review(s)`);
  const lowQuality = report.documents.filter((d) => d.quality_score < minScore);
  if (lowQuality.length) failures.push(`${lowQuality.length} document(s) below quality ${minScore}`);
  if (report.summary.dependencies.orphan_count > 0) failures.push(`${report.summary.dependencies.orphan_count} orphan(s)`);
  return failures;
}

export function run(argv: string[], now: string): number {
  const args = parseArgs(argv);
  if (!args.vaultPath) {
    process.stderr.write("Usage: utd-sdm <vault-path> [--format json|markdown|html|mdx] [--output f] [--ci] [--min-score n] [--verbose]\n");
    return 2;
  }
  const { documents, errors } = new FileSystemScanner().scan(args.vaultPath);
  if (args.verbose) process.stderr.write(`Scanned ${documents.length} documents\n`);
  const report = buildGovernanceReport(documents, { now, vaultPath: args.vaultPath, scanErrors: errors });
  const text = serialize(report, args.format);
  if (args.output) fs.writeFileSync(args.output, text, "utf-8");
  else process.stdout.write(text + "\n");

  if (args.ci) {
    const failures = evaluateCiGates(report, args.minScore);
    if (failures.length) {
      process.stderr.write(`CI gate failed: ${failures.join("; ")}\n`);
      return 1;
    }
  }
  return 0;
}

if (require.main === module) {
  process.exit(run(process.argv, new Date().toISOString()));
}
```

- [ ] **Step 2: Build the CLI**

Run: `npm run build:cli`
Expected: `dist/cli.js` written, no errors.

- [ ] **Step 3: Smoke-test against the test vault**

Run: `node dist/cli.js /projects/sandbox/utd-test-vault --format json | head -c 200`
Expected: JSON beginning with `{ "id": "SDM_GOV_...`.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: utd-sdm CLI with --format/--output/--ci/--min-score"
```

---

## Task 8: e2e tests (CLI + CI gates against the test vault)

**Files:**
- Create: `tests/e2e.test.ts`

- [ ] **Step 1: Write the e2e test**

Create `tests/e2e.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { run, evaluateCiGates, parseArgs } from "../src/cli";
import { FileSystemScanner } from "../src/filesystem-scanner";
import { buildGovernanceReport } from "../src/report";

const VAULT = "/projects/sandbox/utd-test-vault";
const NOW = "2026-06-03T00:00:00.000Z";

describe("CLI", () => {
  it("parses flags", () => {
    const a = parseArgs(["node", "cli", VAULT, "--format", "markdown", "--ci", "--min-score", "70"]);
    expect(a).toMatchObject({ vaultPath: VAULT, format: "markdown", ci: true, minScore: 70 });
  });

  it("exits 2 with no vault path", () => {
    expect(run(["node", "cli"], NOW)).toBe(2);
  });

  it("flags the known hippa<->soc2 cycle via the CI gate", () => {
    const { documents, errors } = new FileSystemScanner().scan(VAULT);
    const report = buildGovernanceReport(documents, { now: NOW, vaultPath: VAULT, scanErrors: errors });
    expect(report.summary.dependencies.cycle_count).toBeGreaterThan(0);
    expect(evaluateCiGates(report, 60).some((f) => /cycle/.test(f))).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify pass**

Run: `npx vitest run tests/e2e.test.ts`
Expected: PASS (3 tests). If the test vault path differs in CI, gate this file behind `fs.existsSync(VAULT)` and `it.skipIf`.

- [ ] **Step 3: Run the whole suite + typecheck + lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e.test.ts
git commit -m "test: e2e CLI + CI-gate coverage against the test vault"
```

---

## Task 9: Obsidian export commands & buttons

**Files:**
- Modify: `src/main.ts`
- Modify: `src/views/StrategicDocumentView.ts`

- [ ] **Step 1: Add an export helper to the view**

In `StrategicDocumentView.ts`, add a private method that builds the report from the live API (via `ObsidianScanner`) and writes a file into the vault:

```ts
private async exportReport(format: "json" | "markdown" | "html" | "mdx"): Promise<void> {
  const api = this.getMetadataService();           // existing accessor used by the dashboard
  if (!api) { new Notice("UTD Manager not available"); return; }
  const { documents, errors } = new ObsidianScanner(api).scan();
  const report = buildGovernanceReport(documents, { now: new Date().toISOString(), scanErrors: errors });
  const text = format === "json" ? reportToJSON(report)
    : format === "markdown" ? reportToMarkdown(report)
    : format === "html" ? reportToHTML(report)
    : reportToMDX(report);
  const ext = format === "markdown" ? "md" : format;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `governance-report-${stamp}.${ext}`;
  try {
    const file = await this.app.vault.create(name, text);
    new Notice(`Exported ${name}`);
    await this.app.workspace.getLeaf(false).openFile(file);
  } catch (err) {
    new Notice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

Add imports at the top of the view: `Notice` from `obsidian`, `ObsidianScanner` from `../obsidian-scanner`, and `buildGovernanceReport, reportToJSON, reportToMarkdown` from `../report`, `reportToHTML` from `../report-html`, `reportToMDX` from `../report-mdx`. Render four buttons (JSON/Markdown/HTML/MDX) in the dashboard header, each calling `this.exportReport(...)`.

- [ ] **Step 2: Register four commands in `main.ts`**

For each format, add (mirroring the existing "Open Strategic Document Dashboard" command):

```ts
this.addCommand({
  id: "export-governance-report-json",
  name: "Export Governance Report as JSON",
  callback: () => this.view?.exportReport("json"),
});
```

Repeat for `markdown`, `html`, `mdx` (unique `id`/`name`, matching `format`). Make `exportReport` accessible to `main.ts` (e.g. a thin `public exportReport` passthrough on the view).

- [ ] **Step 3: Build the plugin and typecheck**

Run: `npm run build && npx tsc --noEmit`
Expected: `main.js` written, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/views/StrategicDocumentView.ts
git commit -m "feat: in-Obsidian governance report export (buttons + commands)"
```

---

## Task 10: Docs

**Files:**
- Modify: `README.md`, `AGENTS.md`

- [ ] **Step 1: Document the CLI and formats in `README.md`**

Add an "Export" section: the four formats, the `utd-sdm` CLI usage block, and the `--ci` gate semantics (cycles / overdue / quality `< --min-score` / orphans, all-on).

- [ ] **Step 2: Update `AGENTS.md` module list**

Add `report.ts`, `report-html.ts`, `report-mdx.ts`, `filesystem-scanner.ts`, `obsidian-scanner.ts`, and `cli.ts` to the module dependency chain, noting the `ScannerLike` contract and that serializers/builder are Obsidian-free.

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document governance report export formats and utd-sdm CLI"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** JSON/MD/HTML/MDX serializers (Tasks 2–4), consolidated `GovernanceReport` (Task 2), source-agnostic `ScannerLike` with both scanners (Tasks 5–6), `utd-sdm` CLI with all-on `--ci` and `--min-score` (Task 7), Obsidian buttons + commands (Task 9), test plan incl. unreadable-dir surfacing (Task 5) and the known cycle (Task 8) — all mapped.
- **Determinism:** `buildGovernanceReport` takes `now` as input (no `Date.now()` inside) so report tests are stable; the CLI/view inject `new Date().toISOString()` at the edge.
- **No truncation:** the report passes `maxDocuments: docs.length` to `ReviewQueueBuilder.build` so every document appears (the queue default is 100).
- **Empty vault:** `quality.average` is forced to 0 when there are no documents.
