# Spec: Governance Report Export Formats for Strategic Document Management

**Date:** 2026-06-03
**Status:** Approved (design)
**Repo:** `obsidian-strategic-document-management`

## Goal

Add export of a consolidated **Governance Report** in four formats — **JSON, Markdown, HTML, MDX** — available both as in-Obsidian dashboard exports and via a headless CLI. Mirrors the proven architecture of the sibling `utd-batch-quality-assurance` plugin (pure builder + per-format serializers + filesystem scanner + CLI + Obsidian export buttons) for consistency across the 3IT plugin family.

## Why this adds value

SDM produces governance data — quality scores, lifecycle states, a review queue, and dependency/orphan/cycle analysis — but today its only output is an in-Obsidian dashboard. Governance data needs to be shared and acted on *outside* the tool:

- **JSON** — programmatic use, CI gates, feeding other systems.
- **Markdown** — team channels, repos, human review.
- **HTML** — a self-contained, shareable governance scorecard for stakeholders who don't use Obsidian (board reviews, compliance).
- **MDX** — embedding governance dashboards in docs sites (Docusaurus/Astro).

## Non-goals

- Not a shared cross-repo reporting package (deferred; the two plugins' reports differ structurally — `Finding[]` vs governance metrics). Tracked as future synergy in batch-QA's `COMPARISON.md`.
- Not per-view exports — one consolidated report, not separate scorecard/queue/impact documents.
- No new governance *analysis* — exports surface what the existing pure modules already compute.

## Architecture

Layering mirrors batch-QA. New files under `src/`:

| Module | Responsibility | Obsidian-free |
|---|---|---|
| `report.ts` | `buildGovernanceReport(docs) → GovernanceReport`; `reportToJSON`, `reportToMarkdown` | yes |
| `report-html.ts` | `reportToHTML` — self-contained dashboard (inline CSS, no JS) | yes |
| `report-mdx.ts` | `reportToMDX` — YAML frontmatter + `export const governanceData` + tables | yes |
| `filesystem-scanner.ts` | `FileSystemScanner` — parses `.md` frontmatter **and relations** via `gray-matter`; surfaces unreadable dirs as errors | yes |
| `obsidian-scanner.ts` | wraps `metadataService.listThings` + `getRelations`; extracted from `StrategicDocumentView` so the live view and export share one path | no (uses `app`) |
| `cli.ts` | arg parsing, scan → build → serialize → stdout/file, exit codes | yes |

### Source-agnostic scanner contract

Both scanners satisfy one contract, so the report builder never knows the source:

```ts
interface SdmDocument {
  thing_id: string;
  file_path: string;
  frontmatter: Record<string, unknown>;
  relations: { depends_on: string[]; enables: string[]; related_to: string[] };
}

interface ScannerLike {
  scan(): { documents: SdmDocument[]; errors: string[] };
}
```

- **Obsidian scanner:** `listThings({ thing_type: "strategic_documentation" })` + `getRelations(id)` per document.
- **FileSystemScanner (CLI):** `gray-matter` parse of each `.md`; relations read from the frontmatter `depends_on` / `enables` / `related_to` arrays (since UTD Manager's API is not running headless).

This is the specific lesson carried over from batch-QA: define the contract interface up front so the `Auditor`/builder accepts both real and fake/CLI sources without `as any`.

## Data model

`GovernanceReport` is fully serializable — no `onClick` callbacks or DOM nodes (unlike the view's `DashboardData`):

```ts
interface GovernanceReport {
  id: string;            // e.g. SDM_GOV_20260603T120000Z
  timestamp: string;     // ISO 8601
  vault_path: string;
  duration_ms: number;
  summary: {
    total_documents: number;
    lifecycle: { by_state: Record<string, number> };   // draft/review/approved/operational/archived
    quality: { high: number; medium: number; low: number; average: number };
    review_queue: { overdue: number; approaching: number; due_soon: number; missing_review_date: number };
    dependencies: { orphan_count: number; cycle_count: number };
  };
  documents: GovernanceDocument[];
  cycles: string[][];    // each inner array = one circular depends_on chain of thing_ids
  orphans: string[];     // thing_ids flagged by DependencyAnalyzer.findOrphans (no inbound/outbound relations)
  scan_errors: string[]; // unparseable YAML, unreadable dirs — never silently dropped
}

interface GovernanceDocument {
  thing_id: string;
  file_path: string;
  title: string;
  document_type: string;        // strategy | policy | proposal | report | meeting_note | decision | project
  lifecycle_state: string;
  owner: string;
  quality_score: number;        // 0–100
  quality_dimensions: { completeness: number; freshness: number; relation_health: number; activity: number };
  review_status: "overdue" | "approaching" | "due_soon" | "missing_review_date" | "ok";
  days_until_review: number | null;
  is_orphan: boolean;
}
```

`buildGovernanceReport` composes the existing pure APIs — `QualityScorer.score`, `ReviewQueueBuilder.build`, `DependencyAnalyzer.analyzeAll` / `.findCycles` / `.findOrphans` — plus a lifecycle-state tally. It does not reimplement any scoring logic.

## CLI

Built to `dist/cli.js` via a new `build:cli` esbuild script; exposed as the `utd-sdm` bin.

```
utd-sdm <vault-path> [options]
  --format json|markdown|html|mdx   Output format (default: json)
  --output <path>                   Write to a file instead of stdout
  --html                            Shorthand for --format html
  --min-score <n>                   Quality gate threshold (default: 60)
  --ci                              Exit 1 if ANY gate trips (see below)
  --include <glob>                  Only include matching files (repeatable)
  --exclude <glob>                  Exclude matching files (repeatable)
  --open                            Open the HTML report in a browser (implies --format html)
  --verbose                         Print progress to stderr
```

### `--ci` gate (all-on)

`--ci` exits 1 if **any** of the following hold (gates are not individually toggleable; only `--min-score` is configurable):

1. `summary.dependencies.cycle_count > 0`
2. `summary.review_queue.overdue > 0`
3. any `document.quality_score < min-score` (default 60)
4. `summary.dependencies.orphan_count > 0`

Before exiting non-zero, the CLI prints which gate(s) tripped (and the offending counts/ids) to stderr. With no documents, all gates pass (exit 0).

No Obsidian runtime needed — the CLI uses `FileSystemScanner` + `gray-matter`.

## Obsidian integration

- Extract the document+relations fetch out of `StrategicDocumentView` into `obsidian-scanner.ts`; the view and the export commands both use it.
- Add four export buttons to the dashboard and four commands — "Export Governance Report as JSON / Markdown / HTML / MDX" — mirroring batch-QA's audit-view. Exported files are written into the vault and opened.

## Testing

- `tests/report.test.ts` — `buildGovernanceReport` + all four serializers, using a `makeDoc()` fixture helper; assert structure/content, not exact DOM trees.
- `tests/filesystem-scanner.test.ts` — temp-vault scan including relations read from frontmatter, and the **unreadable-directory-surfaces-an-error** case (applied from day one, not after a production bug).
- `tests/e2e.test.ts` — run the CLI against `/projects/sandbox/utd-test-vault` (12 docs across 7 types, with the known `sd-006-hippa-policy` ↔ `sd-007-soc2-policy` cycle); assert each `--ci` gate's exit code (cycle, overdue, low-quality, orphan) and exit 0 on a clean subset.
- View export: light. SDM already ships `jsdom` and `tests/mocks/obsidian.ts`; reuse them if the buttons are tested. The serialization logic itself is pure and covered above.

## Dependencies & tooling

- Add `gray-matter` (runtime dependency).
- Add `build:cli` script (esbuild bundle → `dist/cli.js`, `--platform=node`, `--external:obsidian`, node shebang banner) and a `bin: { "utd-sdm": "./dist/cli.js" }` entry in `package.json`.
- `dist/` is gitignored.

## Edge cases & error handling

- **Empty vault** → report with `total_documents: 0`, zeroed summary, `quality.average: 0`, empty `documents`/`cycles`/`orphans`; `--ci` exits 0.
- **Unparseable YAML / unreadable directory** → recorded in `scan_errors`, never silently swallowed (carried over from the batch-QA `filesystem-scanner` fix).
- **Missing relations in frontmatter (CLI)** → treated as empty relation arrays; the document may surface as an orphan, which is correct.
- **Document missing a review date** → `review_status: "missing_review_date"`, `days_until_review: null`.

## Out of scope / future

- Shared cross-repo `quality-report` package (see batch-QA `COMPARISON.md` synergy section).
- Per-view granular exports.
- Configurable/toggleable individual CI gates beyond `--min-score`.
