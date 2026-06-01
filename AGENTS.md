# AGENTS.md — Strategic Document Management

Layers document workflows, quality gates, and governance UX on top of UTD Manager's identity and metadata API. Modules are pure functions (data-in, data-out) — no Obsidian runtime dependency at the module level, so everything is testable without mocks.

## Parent dependency: UTD Manager
`/projects/sandbox/utd` provides the identity layer (ThingIDs, lifecycle states, provenance, relations, batch validation). This project consumes it via `app.plugins.plugins['obsidian-utd'].metadataService`. Read `/projects/sandbox/utd/AGENTS.md` for that project's conventions — this project should follow them (2-space indent, double quotes, camelCase, PascalCase exports, CommonJS output for Obsidian).

## Design source of truth
`design-notes.md` defines the document type taxonomy (strategy, policy, proposal, report, meeting_note, decision, project), quality scoring dimensions (completeness 40%, freshness 30%, relation health 20%, activity 10%), and the lifecycle state machine (draft → review → approved → operational → archived). This file is the spec; implementation must match it.

## Module dependency chain
Modules build from bottom to top. Read them in this order:
1. `src/document-types.ts` — document type enum, definitions, validation (no deps)
2. `src/lifecycle.ts` — state machine with guard conditions (depends on document-types for required-field validation on draft→review)
3. `src/quality-score.ts` — 0–100 composite across 4 dimensions (depends on document-types for completeness)
4. `src/review-queue.ts` — prioritized review queue with staleness detection (depends on quality-score for freshness computation)
5. `src/dependency-analyzer.ts` — impact analysis, cycle detection, orphan detection (no internal deps; consumes relation graph data)
6. `src/views/dashboard-renderer.ts` — pure rendering functions (data-in, DOM-out); no Obsidian runtime dep
7. `src/views/StrategicDocumentView.ts` — Obsidian ItemView that consumes UTD API and delegates to renderer

## Toolchain
- `npm install` / `npm run dev` / `npm run build` / `npm test` / `npm run lint`
- `obsidian` externalized at build time (never bundled)
- Plugins registered in Obsidian's `main.ts` (mirroring UTD Manager's structure)

## Test vault
`/projects/sandbox/utd-test-vault/` contains 12 strategic documents across all 7 doc types. Both plugins are symlinked. Open with Obsidian to test the dashboard live. Documents include:
- High-quality (all fields), low-quality (missing fields/overdue), archived, stale
- Dependency chains (strategy → reports → decisions → projects → policies)
- Known cycle via `sd-006-hippa-policy` ↔ `sd-007-soc2-policy` (depends_on on each other)

## Related repos
- `/projects/sandbox/utd` — UTD Manager plugin
- `/projects/sandbox/utd/AGENTS.md` — UTD conventions this project inherits
- `/projects/sandbox/utd/docs/UTD_SPEC.md` — UTD schema v1.0
- `/projects/sandbox/utd/docs/API.md` — Public API reference
