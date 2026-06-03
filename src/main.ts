import { Plugin, WorkspaceLeaf } from "obsidian";
import { StrategicDocumentView, STRATEGIC_DOCUMENT_VIEW_TYPE } from "./views/StrategicDocumentView";
import type { UTDMetadataService } from "./obsidian-scanner";

export default class StrategicDocumentManagementPlugin extends Plugin {
  private view: StrategicDocumentView | null = null;

  async onload() {
    this.registerView(
      STRATEGIC_DOCUMENT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        this.view = new StrategicDocumentView(leaf, this.app);
        return this.view;
      }
    );

    this.addRibbonIcon("file-stack", "Strategic Documents", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-strategic-document-dashboard",
      name: "Open Strategic Document Dashboard",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "export-governance-report-json",
      name: "Export Governance Report as JSON",
      callback: () => void this.view?.exportReport("json"),
    });

    this.addCommand({
      id: "export-governance-report-markdown",
      name: "Export Governance Report as Markdown",
      callback: () => void this.view?.exportReport("markdown"),
    });

    this.addCommand({
      id: "export-governance-report-html",
      name: "Export Governance Report as HTML",
      callback: () => void this.view?.exportReport("html"),
    });

    this.addCommand({
      id: "export-governance-report-mdx",
      name: "Export Governance Report as MDX",
      callback: () => void this.view?.exportReport("mdx"),
    });

    this.app.workspace.onLayoutReady(() => {
      const api = this.getMetadataService();
      if (api?.onDidUpdate) {
        api.onDidUpdate(() => this.view?.refreshDashboard());
      }
    });
  }

  async onunload() {
    this.view = null;
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(STRATEGIC_DOCUMENT_VIEW_TYPE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: STRATEGIC_DOCUMENT_VIEW_TYPE, active: true });
      }
    }

    if (leaf) workspace.revealLeaf(leaf);
  }

  private getMetadataService(): UTDMetadataService | null {
    // App.plugins is an internal Obsidian API not present in the public typings.
    const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, { metadataService?: UTDMetadataService }> } }).plugins;
    return plugins?.plugins?.["obsidian-utd"]?.metadataService ?? null;
  }
}

export { DocumentClassifier } from "./document-types";
export { LifecycleStateMachine, LifecycleState } from "./lifecycle";
export { QualityScorer } from "./quality-score";
export { ReviewQueueBuilder, StalenessTier } from "./review-queue";
export { DependencyAnalyzer } from "./dependency-analyzer";
export { DashboardRenderer, DashboardData, DashboardRow } from "./views/dashboard-renderer";
export { StrategicDocumentView, STRATEGIC_DOCUMENT_VIEW_TYPE } from "./views/StrategicDocumentView";
