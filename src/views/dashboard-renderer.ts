export type DashboardTab = "lifecycle" | "queue" | "quality" | "impact";

export interface DashboardRow {
  id: string;
  label: string;
  sublabel: string;
  badge: string;
  badgeClass: string;
  onClick: () => void;
  canvasScore?: number | null;
  synced?: boolean | null;
  qualityDetail?: string;
}

export interface CanvasAuthStatus {
  authenticated: boolean;
  lastSyncAt?: number | null;
  lastSyncResult?: string | null;
}

export interface DashboardData {
  lifecycle: {
    byState: Record<string, number>;
    total: number;
  };
  queue: {
    overdue: number;
    approaching: number;
    dueSoon: number;
    missingReviewDate: number;
    rows: DashboardRow[];
  };
  quality: {
    high: number;
    medium: number;
    low: number;
    average: number;
    rows: DashboardRow[];
  };
  impact: {
    orphanCount: number;
    cycleCount: number;
    rows: DashboardRow[];
  };
  canvasAuth?: CanvasAuthStatus;
}

export type DashboardUpdater = (container: HTMLElement, data: DashboardData) => void;

function createTabBar(container: HTMLElement, active: DashboardTab, onSelect: (tab: DashboardTab) => void): Record<DashboardTab, HTMLElement> {
  const tabBar = container.createDiv({ cls: "utd-sd-tabs" });
  const content = container.createDiv({ cls: "utd-sd-content" });

  const tabs: DashboardTab[] = ["lifecycle", "queue", "quality", "impact"];
  const labels: Record<DashboardTab, string> = {
    lifecycle: "Lifecycle",
    queue: "Review Queue",
    quality: "Quality",
    impact: "Impact",
  };

  const sections: Record<DashboardTab, HTMLElement> = {} as Record<DashboardTab, HTMLElement>;

  tabs.forEach((tab) => {
    const btn = tabBar.createEl("button", { text: labels[tab], cls: "utd-sd-tab-btn" });
    if (tab === active) btn.addClass("is-active");
    btn.addEventListener("click", () => onSelect(tab));

    const section = content.createDiv({ cls: "utd-sd-section" });
    if (tab !== active) section.addClass("is-hidden");
    sections[tab] = section;
  });

  return sections;
}

function renderLifecycleTab(section: HTMLElement, data: DashboardData): void {
  section.empty();
  const { byState, total } = data.lifecycle;

  const summary = section.createDiv({ cls: "utd-sd-summary" });
  summary.createEl("div", { text: `Total documents: ${total}` });

  if (data.canvasAuth) {
    const authLabel = data.canvasAuth.authenticated
      ? "Canvas\u2192Claude: Connected"
      : "Canvas\u2192Claude: Not connected";
    summary.createEl("div", { text: authLabel, cls: data.canvasAuth.authenticated ? "utd-sd-canvas-connected" : "utd-sd-canvas-disconnected" });
  }

  const states = ["draft", "under_review", "approved", "operational", "archived"];
  const grid = section.createDiv({ cls: "utd-sd-grid" });

  for (const state of states) {
    const count = byState[state] || 0;
    const item = grid.createDiv({ cls: "utd-sd-grid-item" });
    item.createDiv({ text: state.replace("_", " "), cls: "utd-sd-grid-label" });
    item.createDiv({ text: String(count), cls: "utd-sd-grid-value" });
  }

  if (total === 0) {
    section.createEl("p", { text: "No strategic documents found.", cls: "utd-sd-placeholder" });
  }
}

function renderQueueTab(section: HTMLElement, data: DashboardData): void {
  section.empty();
  const { queue } = data;

  const summary = section.createDiv({ cls: "utd-sd-summary" });
  summary.createEl("div", { text: `Overdue: ${queue.overdue}` });
  summary.createEl("div", { text: `Approaching (≤7d): ${queue.approaching}` });
  summary.createEl("div", { text: `Due Soon (≤30d): ${queue.dueSoon}` });
  summary.createEl("div", { text: `No Review Date: ${queue.missingReviewDate}` });

  if (queue.rows.length === 0) {
    section.createEl("p", { text: "All documents are up to date.", cls: "utd-sd-placeholder" });
    return;
  }

  const list = section.createDiv({ cls: "utd-sd-list" });
  for (const row of queue.rows) {
    const item = list.createDiv({ cls: "utd-sd-list-item" });
    const info = item.createDiv({ cls: "utd-sd-list-info" });
    info.createSpan({ text: row.label, cls: "utd-sd-list-label" });
    info.createSpan({ text: row.sublabel, cls: "utd-sd-list-sublabel" });
    item.createDiv({ text: row.badge, cls: `utd-sd-badge ${row.badgeClass}` });
    item.addEventListener("click", row.onClick);
  }
}

function renderQualityTab(section: HTMLElement, data: DashboardData): void {
  section.empty();
  const { quality } = data;

  const summary = section.createDiv({ cls: "utd-sd-summary" });
  summary.createEl("div", { text: `Average quality: ${quality.average}/100` });
  summary.createEl("div", { text: `High (≥80): ${quality.high}` });
  summary.createEl("div", { text: `Medium (50–79): ${quality.medium}` });
  summary.createEl("div", { text: `Low (<50): ${quality.low}` });

  if (quality.rows.length === 0) {
    section.createEl("p", { text: "No documents scored yet.", cls: "utd-sd-placeholder" });
    return;
  }

  const hasCanvasScores = quality.rows.some((r) => r.canvasScore != null);

  const list = section.createDiv({ cls: "utd-sd-list" });
  for (const row of quality.rows) {
    const item = list.createDiv({ cls: "utd-sd-list-item" });
    const info = item.createDiv({ cls: "utd-sd-list-info" });
    info.createSpan({ text: row.label, cls: "utd-sd-list-label" });
    info.createSpan({ text: row.sublabel, cls: "utd-sd-list-sublabel" });

    const badgeRow = item.createDiv({ cls: "utd-sd-badge-row" });
    badgeRow.createDiv({ text: row.badge, cls: `utd-sd-badge ${row.badgeClass}` });

    if (hasCanvasScores) {
      if (row.canvasScore != null) {
        const csLabel = `Canvas: ${Math.round(row.canvasScore)}%`;
        badgeRow.createDiv({ text: csLabel, cls: "utd-sd-badge utd-sd-badge-canvas" });
      } else {
        badgeRow.createDiv({ text: "Canvas: –", cls: "utd-sd-badge utd-sd-badge-neutral" });
      }
    }

    if (row.synced != null) {
      const syncLabel = row.synced ? "Synced" : "Not synced";
      badgeRow.createDiv({ text: syncLabel, cls: `utd-sd-badge ${row.synced ? "utd-sd-badge-good" : "utd-sd-badge-neutral"}` });
    }

    if (row.qualityDetail) {
      info.createSpan({ text: row.qualityDetail, cls: "utd-sd-quality-detail" });
    }

    item.addEventListener("click", row.onClick);
  }
}

function renderImpactTab(section: HTMLElement, data: DashboardData): void {
  section.empty();
  const { impact } = data;

  const summary = section.createDiv({ cls: "utd-sd-summary" });
  summary.createEl("div", { text: `Orphan documents: ${impact.orphanCount}` });
  summary.createEl("div", { text: `Circular dependencies: ${impact.cycleCount}` });

  if (impact.rows.length === 0) {
    section.createEl("p", { text: "No impact analysis results.", cls: "utd-sd-placeholder" });
    return;
  }

  const list = section.createDiv({ cls: "utd-sd-list" });
  for (const row of impact.rows) {
    const item = list.createDiv({ cls: "utd-sd-list-item" });
    const info = item.createDiv({ cls: "utd-sd-list-info" });
    info.createSpan({ text: row.label, cls: "utd-sd-list-label" });
    info.createSpan({ text: row.sublabel, cls: "utd-sd-list-sublabel" });
    item.createDiv({ text: row.badge, cls: `utd-sd-badge ${row.badgeClass}` });
    item.addEventListener("click", row.onClick);
  }
}

function renderDashboard(container: HTMLElement, data: DashboardData, tab: DashboardTab = "lifecycle"): void {
  container.empty();
  const sections = createTabBar(container, tab, (newTab) => {
    Object.entries(sections).forEach(([key, el]) => {
      el.toggleClass("is-hidden", key !== newTab);
    });
    container.querySelectorAll(".utd-sd-tab-btn").forEach((btn) => btn.removeClass("is-active"));
    const tabBtns = container.querySelectorAll(".utd-sd-tab-btn");
    const idx = tabs.indexOf(newTab);
    if (idx >= 0 && tabBtns[idx]) tabBtns[idx].addClass("is-active");
  });

  renderLifecycleTab(sections.lifecycle, data);
  renderQueueTab(sections.queue, data);
  renderQualityTab(sections.quality, data);
  renderImpactTab(sections.impact, data);
}

const tabs: DashboardTab[] = ["lifecycle", "queue", "quality", "impact"];

export const DashboardRenderer = {
  render: renderDashboard,
};
