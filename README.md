# Strategic Document Management

A layer on top of UTD (Unique Thing Definition) that gives every business document a stable identity, lifecycle, owner, and quality gate — so organizations stop losing track of which document is current, who owns it, and what depends on it.

## Problem

Documents in most organizations are scattered across folders, shared drives, wikis, and chat threads. There is no shared identity layer: no stable ID, no lifecycle state, no owner, no way to know if a document is still current or stale. Teams waste time hunting for the right version, acting on outdated information, or duplicating work someone already completed.

## Solution

Strategic Document Management builds on UTD's identity layer (ThingIDs, lifecycle states, provenance, relations) and adds document-specific workflows:

- **Stable identity.** Every document gets a UTD ThingID — a permanent, machine-readable address that survives renames and moves.
- **Lifecycle tracking.** Documents move through states (draft → review → approved → operational → archived) with timestamps and ownership at each transition.
- **Quality gates.** Required fields, approval workflows, and content checks ensure documents meet organizational standards before being acted on.
- **Dependency visibility.** Who depends on this document? What decisions does it enable? What must be updated if it changes?
- **Staleness detection.** Automatically surface documents past their review date or lacking required metadata.
- **Batch audit.** Validate an entire knowledge base — every document, in every folder — for compliance, completeness, and freshness in one operation.

## Foundation: UTD Manager

This project depends on UTD Manager for:

| Capability | Provided by |
|---|---|
| Stable digital identity (ThingID) | UTD Manager |
| Lifecycle state tracking | UTD Manager |
| Relations and dependency graph | UTD Manager |
| Provenance (authors, dates) | UTD Manager |
| Public metadata API | UTD Manager |
| Batch validation engine | UTD Manager |
| Obsidian integration | UTD Manager |

Strategic Document Management adds the document-type-specific workflows, quality rules, and UX that turn identity metadata into operational document governance.

## Initial scope

1. **Document type classification** — strategy docs, policies, proposals, reports, meeting notes, decisions
2. **Lifecycle dashboard** — view all documents by state, owner, domain; spot bottlenecks
3. **Review workflow** — documents approaching review date surface in a prioritized queue
4. **Dependency impact analysis** — "if I change this, what else breaks?"
5. **Orphan detection** — documents with no relations, no owner, or no recent activity
6. **Quality score** — a 0–100 composite of completeness, freshness, and relation health

## Architecture

```
UTD Manager (identity + metadata layer)
    │
    ▼
Strategic Document Management (workflows + quality + UX)
    │
    ├── Document types & classification rules
    ├── Lifecycle state machine (with guard conditions)
    ├── Quality scoring engine
    ├── Review queue & staleness detection
    ├── Dependency impact analyzer
    └── Dashboard views (by state, owner, domain, risk)
```

## See also

- [UTD Manager](https://github.com/deepak-pradhan/utd) — identity and metadata foundation
- [UTD Specification](https://github.com/deepak-pradhan/utd/docs/UTD_SPEC.md) — schema reference
- [POTENTIAL_USES.md](https://github.com/deepak-pradhan/utd/POTENTIAL_USES.md) — full business and personal use case catalog
