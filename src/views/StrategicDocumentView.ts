import { ItemView, WorkspaceLeaf, type App } from "obsidian";
import { DashboardRenderer, DashboardData, DashboardRow } from "./dashboard-renderer";
import { QualityScorer } from "../quality-score";
import { ReviewQueueBuilder, StalenessTier } from "../review-queue";
import { DependencyAnalyzer, DependencyNode } from "../dependency-analyzer";

export const STRATEGIC_DOCUMENT_VIEW_TYPE = "strategic-document-view";

interface DocumentEntry {
  thing_id: string;
  file_path: string;
  frontmatter: Record<string, unknown>;
}

interface UTDMetadataService {
  listThings(filter: Record<string, unknown>): Promise<DocumentEntry[]>;
  getRelations(thingId: string): Promise<{ depends_on?: string[]; enables?: string[]; related_to?: string[] }>;
  onDidUpdate(callback: (thingId: string) => void): void;
}

function getMetadataService(app: App): UTDMetadataService | null {
  const plugin = (app as any).plugins?.plugins?.["obsidian-utd"];
  if (!plugin?.metadataService) return null;
  return plugin.metadataService as UTDMetadataService;
}

export class StrategicDocumentView extends ItemView {
  private app: App;
  private documents: DocumentEntry[] = [];

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
    await this.refreshDashboard();
  }

  async onClose(): Promise<void> {
    this.containerEl.empty();
  }

  async refreshDashboard(): Promise<void> {
    const api = getMetadataService(this.app);
    if (!api) {
      this.containerEl.empty();
      this.containerEl.createDiv({ text: "UTD Manager plugin not available.", cls: "utd-sd-placeholder" });
      return;
    }

    try {
      this.documents = await api.listThings({ thing_type: "strategic_documentation", is_active: true });
      const data = this.buildDashboardData(this.documents);
      DashboardRenderer.render(this.containerEl, data, "lifecycle");
    } catch (err) {
      this.containerEl.empty();
      this.containerEl.createDiv({
        text: `Failed to load dashboard: ${err instanceof Error ? err.message : String(err)}`,
        cls: "utd-sd-placeholder",
      });
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

      const qs = QualityScorer.score(fm);
      qualitySum += qs.total;
      if (qs.total >= 80) highQuality++;
      else if (qs.total >= 50) mediumQuality++;
      else lowQuality++;

      qualityRows.push({
        id: doc.thing_id,
        label: title,
        sublabel: `${docType} · ${fm.lifecycle_state || "unknown"}`,
        badge: `${qs.total}`,
        badgeClass: qs.total >= 80 ? "utd-sd-badge-good" : qs.total >= 50 ? "utd-sd-badge-warn" : "utd-sd-badge-bad",
        onClick: () => this.navigateToFile(filePath),
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
