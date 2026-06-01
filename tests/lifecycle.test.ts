import { describe, it, expect } from "vitest";
import { LifecycleStateMachine, LifecycleState } from "../src/lifecycle";

const strategyFm = { doc_type: "strategy", owner: "alice", domain: "growth", review_date: "2025-06-01" };

describe("LifecycleStateMachine.canTransition", () => {
  it("allows draft -> under_review", () => {
    expect(LifecycleStateMachine.canTransition(LifecycleState.Draft, LifecycleState.UnderReview)).toBe(true);
  });

  it("allows under_review -> approved", () => {
    expect(LifecycleStateMachine.canTransition(LifecycleState.UnderReview, LifecycleState.Approved)).toBe(true);
  });

  it("allows under_review -> draft", () => {
    expect(LifecycleStateMachine.canTransition(LifecycleState.UnderReview, LifecycleState.Draft)).toBe(true);
  });

  it("allows approved -> operational", () => {
    expect(LifecycleStateMachine.canTransition(LifecycleState.Approved, LifecycleState.Operational)).toBe(true);
  });

  it("allows approved -> under_review", () => {
    expect(LifecycleStateMachine.canTransition(LifecycleState.Approved, LifecycleState.UnderReview)).toBe(true);
  });

  it("allows operational -> archived", () => {
    expect(LifecycleStateMachine.canTransition(LifecycleState.Operational, LifecycleState.Archived)).toBe(true);
  });

  it("allows operational -> under_review", () => {
    expect(LifecycleStateMachine.canTransition(LifecycleState.Operational, LifecycleState.UnderReview)).toBe(true);
  });

  it("rejects archived -> anything", () => {
    for (const state of Object.values(LifecycleState)) {
      expect(LifecycleStateMachine.canTransition(LifecycleState.Archived, state)).toBe(false);
    }
  });

  it("rejects draft -> anything except under_review", () => {
    expect(LifecycleStateMachine.canTransition(LifecycleState.Draft, LifecycleState.Approved)).toBe(false);
    expect(LifecycleStateMachine.canTransition(LifecycleState.Draft, LifecycleState.Operational)).toBe(false);
    expect(LifecycleStateMachine.canTransition(LifecycleState.Draft, LifecycleState.Archived)).toBe(false);
  });

  it("rejects operational -> approved", () => {
    expect(LifecycleStateMachine.canTransition(LifecycleState.Operational, LifecycleState.Approved)).toBe(false);
  });

  it("rejects approved -> draft", () => {
    expect(LifecycleStateMachine.canTransition(LifecycleState.Approved, LifecycleState.Draft)).toBe(false);
  });
});

describe("LifecycleStateMachine.validateTransition", () => {
  it("passes draft -> under_review when required fields present", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.Draft, LifecycleState.UnderReview, strategyFm
    );
    expect(result.allowed).toBe(true);
    expect(result.guardResults[0].guard).toBe("required_fields");
    expect(result.guardResults[0].passed).toBe(true);
  });

  it("fails draft -> under_review when required fields missing", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.Draft, LifecycleState.UnderReview, { doc_type: "strategy" }
    );
    expect(result.allowed).toBe(false);
    expect(result.guardResults[0].passed).toBe(false);
    expect(result.guardResults[0].detail).toContain("Missing required fields");
  });

  it("fails draft -> under_review when doc_type missing", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.Draft, LifecycleState.UnderReview, { owner: "alice" }
    );
    expect(result.allowed).toBe(false);
    expect(result.guardResults[0].detail).toContain("no doc_type");
  });

  it("passes under_review -> approved when reviewed_by present", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.UnderReview, LifecycleState.Approved, { reviewed_by: "bob" }
    );
    expect(result.allowed).toBe(true);
  });

  it("passes under_review -> approved when reviewer metadata present", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.UnderReview, LifecycleState.Approved, {}, { hasReviewer: true }
    );
    expect(result.allowed).toBe(true);
  });

  it("fails under_review -> approved without reviewer", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.UnderReview, LifecycleState.Approved, {}
    );
    expect(result.allowed).toBe(false);
    expect(result.guardResults[0].guard).toBe("reviewer_attribution");
  });

  it("always allows under_review -> draft (rejection)", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.UnderReview, LifecycleState.Draft, {}
    );
    expect(result.allowed).toBe(true);
  });

  it("passes approved -> operational when has parent link", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.Approved, LifecycleState.Operational, {}, { hasParentLink: true }
    );
    expect(result.allowed).toBe(true);
  });

  it("fails approved -> operational without parent link", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.Approved, LifecycleState.Operational, {}
    );
    expect(result.allowed).toBe(false);
    expect(result.guardResults[0].guard).toBe("parent_link");
  });

  it("passes operational -> archived when superseded_by present", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.Operational, LifecycleState.Archived, { superseded_by: "doc-456" }
    );
    expect(result.allowed).toBe(true);
  });

  it("passes operational -> archived when expired", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.Operational, LifecycleState.Archived, {}, { expired: true }
    );
    expect(result.allowed).toBe(true);
  });

  it("fails operational -> archived without reason", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.Operational, LifecycleState.Archived, {}
    );
    expect(result.allowed).toBe(false);
    expect(result.guardResults[0].guard).toBe("archive_reason");
  });

  it("always allows operational -> under_review (periodic review)", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.Operational, LifecycleState.UnderReview, {}
    );
    expect(result.allowed).toBe(true);
  });

  it("always allows approved -> under_review", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.Approved, LifecycleState.UnderReview, {}
    );
    expect(result.allowed).toBe(true);
  });

  it("rejects invalid transition with transition guard", () => {
    const result = LifecycleStateMachine.validateTransition(
      LifecycleState.Draft, LifecycleState.Approved, strategyFm
    );
    expect(result.allowed).toBe(false);
    expect(result.guardResults[0].guard).toBe("valid_transition");
  });
});

describe("LifecycleStateMachine.transition", () => {
  it("returns updated frontmatter on successful transition", () => {
    const { result, updatedFrontmatter } = LifecycleStateMachine.transition(
      LifecycleState.Draft, LifecycleState.UnderReview, strategyFm,
      { timestamp: "2025-06-01T00:00:00Z", actor: "alice", reason: "ready for review" }
    );
    expect(result.allowed).toBe(true);
    expect(updatedFrontmatter.lifecycle_state).toBe(LifecycleState.UnderReview);
    expect(updatedFrontmatter.last_state_change).toBe("2025-06-01T00:00:00Z");
    expect(updatedFrontmatter.last_state_actor).toBe("alice");
    expect(updatedFrontmatter.last_state_reason).toBe("ready for review");
    expect(updatedFrontmatter.owner).toBe("alice");
  });

  it("does not mutate original frontmatter", () => {
    const original = { ...strategyFm };
    LifecycleStateMachine.transition(
      LifecycleState.Draft, LifecycleState.UnderReview, original,
      { timestamp: "2025-06-01T00:00:00Z", actor: "alice", reason: "ready" }
    );
    expect(original.lifecycle_state).toBeUndefined();
  });

  it("returns unchanged frontmatter on failed transition", () => {
    const { result, updatedFrontmatter } = LifecycleStateMachine.transition(
      LifecycleState.Draft, LifecycleState.Approved, strategyFm
    );
    expect(result.allowed).toBe(false);
    expect(updatedFrontmatter).toEqual(strategyFm);
  });
});

describe("LifecycleStateMachine.getStates", () => {
  it("returns 5 lifecycle states", () => {
    expect(LifecycleStateMachine.getStates()).toHaveLength(5);
  });

  it("includes draft, under_review, approved, operational, archived", () => {
    expect(LifecycleStateMachine.getStates()).toEqual(expect.arrayContaining([
      "draft", "under_review", "approved", "operational", "archived",
    ]));
  });
});

describe("LifecycleStateMachine.isValidState", () => {
  it("recognizes valid states", () => {
    expect(LifecycleStateMachine.isValidState("draft")).toBe(true);
    expect(LifecycleStateMachine.isValidState("under_review")).toBe(true);
  });

  it("rejects invalid states", () => {
    expect(LifecycleStateMachine.isValidState("published")).toBe(false);
    expect(LifecycleStateMachine.isValidState("")).toBe(false);
  });
});

describe("LifecycleStateMachine.getAllowedTransitions", () => {
  it("returns correct targets for each state", () => {
    expect(LifecycleStateMachine.getAllowedTransitions(LifecycleState.Draft)).toEqual([LifecycleState.UnderReview]);
    expect(LifecycleStateMachine.getAllowedTransitions(LifecycleState.UnderReview)).toEqual(
      expect.arrayContaining([LifecycleState.Approved, LifecycleState.Draft])
    );
    expect(LifecycleStateMachine.getAllowedTransitions(LifecycleState.Approved)).toEqual(
      expect.arrayContaining([LifecycleState.Operational, LifecycleState.UnderReview])
    );
    expect(LifecycleStateMachine.getAllowedTransitions(LifecycleState.Operational)).toEqual(
      expect.arrayContaining([LifecycleState.Archived, LifecycleState.UnderReview])
    );
    expect(LifecycleStateMachine.getAllowedTransitions(LifecycleState.Archived)).toEqual([]);
  });
});
