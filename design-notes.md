# Potential document types

Strategic Document Management classifies documents into types, each with distinct requirements and quality rules. These are candidates for the initial taxonomy:

| Type | Purpose | Required fields | Lifecycle notes |
|---|---|---|---|
| **strategy** | Long-term direction, vision, competitive positioning | owner, domain, review_date | Reviewed quarterly; stale after 6 months |
| **policy** | Rules, standards, compliance requirements | owner, domain, approved_by, effective_date | Archival after superseded; never deleted |
| **proposal** | Pitches, funding requests, initiative plans | owner, domain, decision_date, approver | Transitions to project or archived on decision |
| **report** | Status reports, metrics summaries, analysis | owner, domain, period_start, period_end | Auto-archived after reporting period closes |
| **meeting_note** | Decisions, action items, attendance | owner, meeting_date, attendees | Archived 30 days after meeting |
| **decision** | Record of a binding organizational decision | owner, domain, decided_by, rationale | Immutable after approval; only superseded |
| **project** | Active initiatives with scope and timeline | owner, start_date, target_date, status | Promoted to operational on delivery |

## Quality scoring dimensions

Each document type gets a 0–100 quality score composed of:

| Dimension | Weight | What it measures |
|---|---|---|
| **Completeness** | 40% | Required fields present and valid |
| **Freshness** | 30% | Reviewed within expected cadence; not stale |
| **Relation health** | 20% | Dependencies resolve; no broken refs; no orphans |
| **Activity** | 10% | Recently updated; linked from active documents |

## Lifecycle state machine

```
                    ┌──────────┐
                    │  draft   │
                    └────┬─────┘
                         │ submit for review
                    ┌────▼─────┐
               ┌────│  review  │────┐
               │    └────┬─────┘    │
               │ reject  │ approve  │
               │    ┌────▼──────┐   │
               │    │ approved  │   │
               │    └────┬──────┘   │
               │         │ publish  │
               │    ┌────▼───────┐  │
               └───►│operational │◄─┘
                    └────┬───────┘
                         │ superseded / expired
                    ┌────▼──────┐
                    │ archived  │
                    └───────────┘
```

Transitions:
- `draft → review`: all required fields must be present
- `review → approved`: must have reviewer attribution
- `review → draft`: reviewer rejection with feedback
- `approved → operational`: published and linked from parent/index
- `operational → archived`: superseded by new version or past expiry
- `operational → review`: triggered by periodic review cadence
