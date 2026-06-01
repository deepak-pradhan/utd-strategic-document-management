export enum DocumentType {
  Strategy = "strategy",
  Policy = "policy",
  Proposal = "proposal",
  Report = "report",
  MeetingNote = "meeting_note",
  Decision = "decision",
  Project = "project",
}

export interface DocumentTypeDefinition {
  type: DocumentType;
  purpose: string;
  requiredFields: string[];
  lifecycleNotes: string;
}

export interface ClassificationResult {
  documentType: DocumentType | null;
  confidence: number;
  matchReason: string;
}

export interface ValidationResult {
  valid: boolean;
  missing: string[];
}

const DOCUMENT_TYPE_DEFINITIONS: Record<DocumentType, DocumentTypeDefinition> = {
  [DocumentType.Strategy]: {
    type: DocumentType.Strategy,
    purpose: "Long-term direction, vision, competitive positioning",
    requiredFields: ["owner", "domain", "review_date"],
    lifecycleNotes: "Reviewed quarterly; stale after 6 months",
  },
  [DocumentType.Policy]: {
    type: DocumentType.Policy,
    purpose: "Rules, standards, compliance requirements",
    requiredFields: ["owner", "domain", "approved_by", "effective_date"],
    lifecycleNotes: "Archival after superseded; never deleted",
  },
  [DocumentType.Proposal]: {
    type: DocumentType.Proposal,
    purpose: "Pitches, funding requests, initiative plans",
    requiredFields: ["owner", "domain", "decision_date", "approver"],
    lifecycleNotes: "Transitions to project or archived on decision",
  },
  [DocumentType.Report]: {
    type: DocumentType.Report,
    purpose: "Status reports, metrics summaries, analysis",
    requiredFields: ["owner", "domain", "period_start", "period_end"],
    lifecycleNotes: "Auto-archived after reporting period closes",
  },
  [DocumentType.MeetingNote]: {
    type: DocumentType.MeetingNote,
    purpose: "Decisions, action items, attendance",
    requiredFields: ["owner", "meeting_date", "attendees"],
    lifecycleNotes: "Archived 30 days after meeting",
  },
  [DocumentType.Decision]: {
    type: DocumentType.Decision,
    purpose: "Record of a binding organizational decision",
    requiredFields: ["owner", "domain", "decided_by", "rationale"],
    lifecycleNotes: "Immutable after approval; only superseded",
  },
  [DocumentType.Project]: {
    type: DocumentType.Project,
    purpose: "Active initiatives with scope and timeline",
    requiredFields: ["owner", "start_date", "target_date", "status"],
    lifecycleNotes: "Promoted to operational on delivery",
  },
};

function getAllDefinitions(): DocumentTypeDefinition[] {
  return Object.values(DOCUMENT_TYPE_DEFINITIONS);
}

function getDefinition(type: DocumentType): DocumentTypeDefinition {
  return DOCUMENT_TYPE_DEFINITIONS[type];
}

function getRequiredFields(type: DocumentType): string[] {
  return DOCUMENT_TYPE_DEFINITIONS[type].requiredFields;
}

function validateRequiredFields(type: DocumentType, frontmatter: Record<string, unknown>): ValidationResult {
  const required = DOCUMENT_TYPE_DEFINITIONS[type].requiredFields;
  const missing = required.filter((field) => {
    const value = frontmatter[field];
    return value === undefined || value === null || value === "";
  });

  return {
    valid: missing.length === 0,
    missing,
  };
}

function classifyDocument(frontmatter: Record<string, unknown>): ClassificationResult {
  const docType = frontmatter["doc_type"];

  if (typeof docType === "string" && isDocumentType(docType)) {
    return {
      documentType: docType as DocumentType,
      confidence: 1.0,
      matchReason: `Explicit doc_type field set to "${docType}"`,
    };
  }

  const scores = getHeuristicScores(frontmatter);

  if (scores.length === 0 || scores[0].score === 0) {
    return {
      documentType: null,
      confidence: 0,
      matchReason: "No doc_type field and no matching field signature found",
    };
  }

  const best = scores[0];
  return {
    documentType: best.type,
    confidence: best.score,
    matchReason: `Heuristic match based on field signature (${best.matchedFields.join(", ")})`,
  };
}

interface HeuristicScore {
  type: DocumentType;
  score: number;
  matchedFields: string[];
}

function getHeuristicScores(frontmatter: Record<string, unknown>): HeuristicScore[] {
  const presentFields = Object.keys(frontmatter).filter((key) => {
    const value = frontmatter[key];
    return value !== undefined && value !== null && value !== "";
  });

  const scores: HeuristicScore[] = getAllDefinitions().map((def) => {
    const matchedFields = def.requiredFields.filter((field) => presentFields.includes(field));
    const score = def.requiredFields.length > 0 ? matchedFields.length / def.requiredFields.length : 0;
    return { type: def.type, score, matchedFields };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores;
}

function isDocumentType(value: string): value is DocumentType {
  return Object.values(DocumentType).includes(value as DocumentType);
}

export function getValidDocumentTypes(): string[] {
  return Object.values(DocumentType);
}

export const DocumentClassifier = {
  classify: classifyDocument,
  getDefinition,
  getRequiredFields,
  validateRequiredFields,
  getAllDefinitions,
  getValidDocumentTypes,
};
