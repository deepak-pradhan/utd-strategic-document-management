import { ItemView, Notice, WorkspaceLeaf, type App } from "obsidian";
import { DashboardRenderer, DashboardData, DashboardRow, CanvasAuthStatus } from "./dashboard-renderer";
import { QualityScorer, type RelationData } from "../quality-score";
import { ReviewQueueBuilder, StalenessTier } from "../review-queue";
import { DependencyAnalyzer, DependencyNode } from "../dependency-analyzer";
import { ObsidianScanner } from "../obsidian-scanner";
import { buildGovernanceReport, reportToJSON, reportToMarkdown } from "../report";
import { reportToHTML } from "../report-html";
import { reportToMDX } from "../report-mdx";

export const STRATEGIC_DOCUMENT_VIEW_TYPE = "strategic-document-view";

interface DocumentEntry {
  thing_id: string;
  file_path: string;
  frontmatter: Record<string, unknown>;
}

interface UTDMetadataService {
  listThings(filter: Record<string, unknown>): DocumentEntry[];
  getRelations(thingId: string): { depends_on?: string[]; enables?: string[]; related_to?: string[] } | null;
  getAllThingIds(): Set<string>;
  onDidUpdate(callback: (thingId: string) => void): { dispose(): void };
}

interface CanvasIntelligencePayload {
  canvasName: string | null;
  scores?: {
    completion_percentage?: number;
    overall_grade?: number;
    utd_compliance_score?: number;
  };
  breakdown?: {
    blocks_completed?: number;
    blocks_total?: number;
    quality_metrics?: Record<string, number>;
  };
  nextMilestone?: {
    name: string;
    actions_needed: string[];
  };
  updatedAt?: string;
}

interface CanvasClaudeService {
  isAuthenticated(): boolean;
  fetchIntelligence(file: unknown): Promise<CanvasIntelligencePayload | null>;
  subscribeStatus(callback: (status: CanvasAuthStatus) => void): () => void;
  getStatusSnapshot(): CanvasAuthStatus;
}

function getMetadataService(app: App): UTDMetadataService | null {
  const plugin = (app as any).plugins?.plugins?.["obsidian-utd"];
  if (!plugin?.metadataService) return null;
  return plugin.metadataService as UTDMetadataService;
}

function getCanvasClaudeService(app: App): CanvasClaudeService | null {
  const plugin = (app as any).plugins?.plugins?.["obsidian-utd"];
  if (!plugin?.canvasClaude) return null;
  return plugin.canvasClaude as CanvasClaudeService;
}

function getFileForThingId(app: App, thingId: string): unknown | null {
  const api = getMetadataService(app);
  if (!api) return null;
  const result = (api as any).getThingFile?.(thingId);
  return result ?? null;
}

export class StrategicDocumentView extends ItemView {
  private app: App;
  private documents: DocumentEntry[] = [];
  private canvasIntelCache: Map<string, CanvasIntelligencePayload | null> = new Map();
  private statusUnsubscribe?: () => void;

  constructor(leaf: WorkspaceLeaf, app: App) {
    super(leaf);
    this.app = app;
  }

  getViewType(): string {
    return STRATEGIC_DOCUMENT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Strategic Documents";
  }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("utd-sd-view");

    const canvasService = getCanvasClaudeService(this.app);
    if (canvasService) {
      this.statusUnsubscribe = canvasService.subscribeStatus(() => {
        void this.refreshDashboard();
      });
    }

    await this.refreshDashboard();
  }

  async onClose(): Promise<void> {
    if (this.statusUnsubscribe) {
      this.statusUnsubscribe();
      this.statusUnsubscribe = undefined;
    }
    this.containerEl.empty();
  }

  async refreshDashboard(): Promise<void> {
    this.containerEl.empty();
    this.renderExportHeader();
    const content = this.containerEl.createDiv({ cls: "utd-sd-dashboard-content" });

    const api = getMetadataService(this.app);
    if (!api) {
      content.createDiv({ text: "UTD Manager plugin not available.", cls: "utd-sd-placeholder" });
      return;
    }

    try {
      this.documents = api.listThings({ thing_type: "strategic_documentation", is_active: true });

      this.canvasIntelCache.clear();
      const canvasService = getCanvasClaudeService(this.app);
      if (canvasService?.isAuthenticated()) {
        for (const doc of this.documents) {
          const file = getFileForThingId(this.app, doc.thing_id);
          if (file) {
            try {
              const intel = await canvasService.fetchIntelligence(file);
              this.canvasIntelCache.set(doc.thing_id, intel);
            } catch {
              this.canvasIntelCache.set(doc.thing_id, null);
            }
          }
        }
      }

      const data = this.buildDashboardData(this.documents);
      DashboardRenderer.render(content, data, "lifecycle");
    } catch (err) {
      content.createDiv({
        text: `Failed to load dashboard: ${err instanceof Error ? err.message : String(err)}`,
        cls: "utd-sd-placeholder",
      });
    }
  }

  private renderExportHeader(): void {
    const header = this.containerEl.createDiv({ cls: "utd-sd-export-header" });
    const formats: Array<{ label: string; format: "json" | "markdown" | "html" | "mdx" }> = [
      { label: "Export JSON", format: "json" },
      { label: "Export Markdown", format: "markdown" },
      { label: "Export HTML", format: "html" },
      { label: "Export MDX", format: "mdx" },
    ];
    for (const { label, format } of formats) {
      const btn = header.createEl("button", { text: label, cls: "utd-sd-export-btn" });
      btn.addEventListener("click", () => { void this.exportReport(format); });
    }
  }

  async exportReport(format: "json" | "markdown" | "html" | "mdx"): Promise<void> {
    const api = getMetadataService(this.app);
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

  private buildDashboardData(docs: DocumentEntry[]): DashboardData {
    const byState: Record<string, number> = {};
    let total = 0;

    for (const doc of docs) {
      total++;
      const state = typeof doc.frontmatter.lifecycle_state === "string"
        ? doc.frontmatter.lifecycle_state
        : "unknown";
      byState[state] = (byState[state] || 0) + 1;
    }

    const allThingIds = new Set(docs.map((d) => d.thing_id));
    const api = getMetadataService(this.app);
    if (api?.getAllThingIds) {
      for (const id of api.getAllThingIds()) {
        allThingIds.add(id);
      }
    }

    const docInputs = docs.map((d) => ({
      thingId: d.thing_id,
      frontmatter: d.frontmatter,
    }));

    const queue = ReviewQueueBuilder.build(docInputs, { maxDocuments: 20 });
    const qualityRows: DashboardRow[] = [];
    const impactRows: DashboardRow[] = [];

    let qualitySum = 0;
    let highQuality = 0;
    let mediumQuality = 0;
    let lowQuality = 0;

    const byFilePath = new Map(docs.map((d) => [d.thing_id, d.file_path]));

    for (const doc of docs) {
      const fm = doc.frontmatter;
      const filePath = doc.file_path;
      const docType = typeof fm.doc_type === "string" ? fm.doc_type : "unknown";
      const title = typeof fm.title === "string" ? fm.title : doc.thing_id;

      const relationData: RelationData = {
        dependsOn: ensureArray(fm["depends_on"]),
        enables: ensureArray(fm["enables"]),
        relatedTo: ensureArray(fm["related_to"]),
        knownThingIds: [...allThingIds],
      };

      const qs = QualityScorer.score(fm, relationData);
      qualitySum += qs.total;
      if (qs.total >= 80) highQuality++;
      else if (qs.total >= 50) mediumQuality++;
      else lowQuality++;

      const canvasIntel = this.canvasIntelCache.get(doc.thing_id);
      const canvasScore = canvasIntel?.scores?.completion_percentage ?? null;
      const hasCanvasId = typeof fm.canvas_id === "string" && fm.canvas_id.length > 0;
      const hasCanvasService = getCanvasClaudeService(this.app) !== null;
      const syncedFlag = hasCanvasService ? (hasCanvasId ? true : false) : null;

      const detailParts: string[] = [];
      if (qs.dimensions.completeness.detail) detailParts.push(qs.dimensions.completeness.detail);
      if (qs.dimensions.relationHealth.detail) detailParts.push(qs.dimensions.relationHealth.detail);

      qualityRows.push({
        id: doc.thing_id,
        label: title,
        sublabel: `${docType} · ${fm.lifecycle_state || "unknown"}`,
        badge: `${qs.total}`,
        badgeClass: qs.total >= 80 ? "utd-sd-badge-good" : qs.total >= 50 ? "utd-sd-badge-warn" : "utd-sd-badge-bad",
        onClick: () => this.navigateToFile(filePath),
        canvasScore,
        synced: syncedFlag,
        qualityDetail: detailParts.join(" | "),
      });

      impactRows.push({
        id: doc.thing_id,
        label: title,
        sublabel: `${docType} — view impact analysis`,
        badge: "→",
        badgeClass: "utd-sd-badge-neutral",
        onClick: () => this.navigateToFile(filePath),
      });
    }

    qualityRows.sort((a, b) => parseInt(b.badge) - parseInt(a.badge));

    const tierCounts: Record<StalenessTier, number> = {
      [StalenessTier.MissingReviewDate]: 0,
      [StalenessTier.Overdue]: 0,
      [StalenessTier.Approaching]: 0,
      [StalenessTier.DueSoon]: 0,
      [StalenessTier.UpToDate]: 0,
    };
    for (const doc of queue.documents) {
      tierCounts[doc.stalenessTier]++;
    }

    const queueRows = queue.documents.map((doc) => {
      const filePath = byFilePath.get(doc.thingId) || "";
      const fm = doc.frontmatter;
      const title = typeof fm.title === "string" ? fm.title : doc.thingId;
      const docType = typeof fm.doc_type === "string" ? fm.doc_type : "unknown";

      return {
        id: doc.thingId,
        label: title,
        sublabel: `${docType} · ${doc.daysUntilReview !== null ? this.stalenessLabel(doc.daysUntilReview) : "no review date"}`,
        badge: `${doc.qualityScore.total}`,
        badgeClass: doc.qualityScore.total >= 80 ? "utd-sd-badge-good" : doc.qualityScore.total >= 50 ? "utd-sd-badge-warn" : "utd-sd-badge-bad",
        onClick: () => this.navigateToFile(filePath),
      };
    });

    let orphanCount = 0;
    let cycleCount = 0;
    try {
      const depNodes: DependencyNode[] = docs.map((d) => ({
        thingId: d.thing_id,
        dependsOn: ensureArray(d.frontmatter["depends_on"]),
        enables: ensureArray(d.frontmatter["enables"]),
        relatedTo: ensureArray(d.frontmatter["related_to"]),
        lifecycleState: typeof d.frontmatter.lifecycle_state === "string" ? d.frontmatter.lifecycle_state : "",
        docType: typeof d.frontmatter.doc_type === "string" ? d.frontmatter.doc_type : "",
      }));
      orphanCount = DependencyAnalyzer.findOrphans(depNodes).length;
      cycleCount = DependencyAnalyzer.findCycles(depNodes).length;
    } catch {
      // degrade gracefully if dependency analysis fails
    }

    const canvasAuth: CanvasAuthStatus | undefined = (() => {
      const svc = getCanvasClaudeService(this.app);
      if (!svc) return undefined;
      return svc.getStatusSnapshot();
    })();

    return {
      lifecycle: { byState, total },
      queue: {
        overdue: tierCounts[StalenessTier.Overdue],
        approaching: tierCounts[StalenessTier.Approaching],
        dueSoon: tierCounts[StalenessTier.DueSoon],
        missingReviewDate: tierCounts[StalenessTier.MissingReviewDate],
        rows: queueRows,
      },
      quality: {
        high: highQuality,
        medium: mediumQuality,
        low: lowQuality,
        average: total > 0 ? Math.round((qualitySum / total) * 100) / 100 : 0,
        rows: qualityRows,
      },
      impact: {
        orphanCount,
        cycleCount,
        rows: impactRows,
      },
      canvasAuth,
    };
  }

  private stalenessLabel(daysUntilReview: number | null): string {
    if (daysUntilReview === null) return "no review date";
    if (daysUntilReview < 0) return `${Math.abs(daysUntilReview)}d overdue`;
    if (daysUntilReview <= 7) return `${daysUntilReview}d until review`;
    if (daysUntilReview <= 30) return `${daysUntilReview}d until review`;
    return "up to date";
  }

  private navigateToFile(filePath: string): void {
    if (filePath) {
      this.app.workspace.openLinkText(filePath, "", false);
    }
  }
}

function ensureArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") return [value];
  return [];
}
