import { DocumentClassifier } from "./document-types";

export enum LifecycleState {
  Draft = "draft",
  UnderReview = "under_review",
  Approved = "approved",
  Operational = "operational",
  Archived = "archived",
}

export interface TransitionResult {
  allowed: boolean;
  from: LifecycleState;
  to: LifecycleState;
  guardResults: GuardResult[];
}

export interface GuardResult {
  passed: boolean;
  guard: string;
  detail: string;
}

export interface TransitionMetadata {
  timestamp: string;
  actor: string;
  reason: string;
}

const STATE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  [LifecycleState.Draft]: [LifecycleState.UnderReview],
  [LifecycleState.UnderReview]: [LifecycleState.Approved, LifecycleState.Draft],
  [LifecycleState.Approved]: [LifecycleState.Operational, LifecycleState.UnderReview],
  [LifecycleState.Operational]: [LifecycleState.Archived, LifecycleState.UnderReview],
  [LifecycleState.Archived]: [],
};

function getAllowedTransitions(from: LifecycleState): LifecycleState[] {
  return STATE_TRANSITIONS[from] || [];
}

function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return getAllowedTransitions(from).includes(to);
}

function validateTransition(
  from: LifecycleState,
  to: LifecycleState,
  frontmatter: Record<string, unknown>,
  metadata?: { hasReviewer?: boolean; hasParentLink?: boolean; supersededBy?: string; expired?: boolean }
): TransitionResult {
  if (!canTransition(from, to)) {
    return {
      allowed: false,
      from,
      to,
      guardResults: [{
        passed: false,
        guard: "valid_transition",
        detail: `Transition from "${from}" to "${to}" is not allowed`,
      }],
    };
  }

  const guardResults = runGuards(from, to, frontmatter, metadata);
  const allPassed = guardResults.every((g) => g.passed);

  return {
    allowed: allPassed,
    from,
    to,
    guardResults,
  };
}

function runGuards(
  from: LifecycleState,
  to: LifecycleState,
  frontmatter: Record<string, unknown>,
  metadata?: { hasReviewer?: boolean; hasParentLink?: boolean; supersededBy?: string; expired?: boolean }
): GuardResult[] {
  const results: GuardResult[] = [];

  if (from === LifecycleState.Draft && to === LifecycleState.UnderReview) {
    const docType = frontmatter["doc_type"];
    if (typeof docType === "string") {
      const validation = DocumentClassifier.validateRequiredFields(docType, frontmatter);
      results.push({
        passed: validation.valid,
        guard: "required_fields",
        detail: validation.valid
          ? "All required fields present"
          : `Missing required fields: ${validation.missing.join(", ")}`,
      });
    } else {
      results.push({
        passed: false,
        guard: "required_fields",
        detail: "Cannot validate: no doc_type in frontmatter",
      });
    }
  }

  if (from === LifecycleState.UnderReview && to === LifecycleState.Approved) {
    const hasReviewer = metadata?.hasReviewer === true || frontmatter["reviewed_by"] !== undefined;
    results.push({
      passed: hasReviewer,
      guard: "reviewer_attribution",
      detail: hasReviewer
        ? "Reviewer attribution present"
        : "Must have reviewer attribution (reviewed_by field)",
    });
  }

  if (from === LifecycleState.UnderReview && to === LifecycleState.Draft) {
    const hasFeedback = metadata?.reason !== undefined || frontmatter["review_feedback"] !== undefined;
    results.push({
      passed: true,
      guard: "rejection_feedback",
      detail: hasFeedback ? "Rejection feedback provided" : "No rejection feedback recorded",
    });
  }

  if (from === LifecycleState.Approved && to === LifecycleState.Operational) {
    const hasParentLink = metadata?.hasParentLink === true;
    results.push({
      passed: hasParentLink,
      guard: "parent_link",
      detail: hasParentLink
        ? "Document linked from parent/index"
        : "Must be linked from parent or index document",
    });
  }

  if (from === LifecycleState.Operational && to === LifecycleState.Archived) {
    const supersededBy = metadata?.supersededBy || frontmatter["superseded_by"];
    const expired = metadata?.expired === true;
    const hasReason = supersededBy !== undefined || expired;
    results.push({
      passed: hasReason,
      guard: "archive_reason",
      detail: hasReason
        ? "Superseded or expired"
        : "Must be superseded by a new version or past expiry date",
    });
  }

  if (from === LifecycleState.Operational && to === LifecycleState.UnderReview) {
    results.push({
      passed: true,
      guard: "periodic_review",
      detail: "Triggered by periodic review cadence",
    });
  }

  return results;
}

function transition(
  from: LifecycleState,
  to: LifecycleState,
  frontmatter: Record<string, unknown>,
  metadata?: TransitionMetadata & { hasReviewer?: boolean; hasParentLink?: boolean; supersededBy?: string; expired?: boolean }
): { result: TransitionResult; updatedFrontmatter: Record<string, unknown> } {
  const result = validateTransition(from, to, frontmatter, metadata);

  if (!result.allowed) {
    return { result, updatedFrontmatter: { ...frontmatter } };
  }

  const updated = {
    ...frontmatter,
    lifecycle_state: to,
    last_state_change: metadata?.timestamp || new Date().toISOString(),
    last_state_actor: metadata?.actor || "",
    last_state_reason: metadata?.reason || "",
  };

  return { result, updatedFrontmatter: updated };
}

export function getLifecycleStates(): string[] {
  return Object.values(LifecycleState);
}

export function isValidLifecycleState(state: string): state is LifecycleState {
  return Object.values(LifecycleState).includes(state as LifecycleState);
}

export const LifecycleStateMachine = {
  getAllowedTransitions,
  canTransition,
  validateTransition,
  transition,
  getStates: getLifecycleStates,
  isValidState: isValidLifecycleState,
};
