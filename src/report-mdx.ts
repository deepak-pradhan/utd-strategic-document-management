import type { GovernanceReport } from "./report";

function escCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
export function reportToMDX(report: GovernanceReport): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push("---");
  lines.push(`id: "${report.id}"`);
  lines.push(`timestamp: "${report.timestamp}"`);
  lines.push(`total_documents: ${s.total_documents}`);
  lines.push(`average_quality: ${s.quality.average}`);
  lines.push("---");
  lines.push("");
  lines.push(`export const governanceData = ${JSON.stringify(report)};`);
  lines.push("");
  lines.push("# Governance Report");
  lines.push("");
  lines.push(`**${s.total_documents} documents** · avg quality ${s.quality.average} · `
    + `${s.review_queue.overdue} overdue · ${s.dependencies.cycle_count} cycles · ${s.dependencies.orphan_count} orphans`);
  lines.push("");
  lines.push("## Documents");
  lines.push("");
  lines.push("| ID | Type | State | Quality | Review |");
  lines.push("|---|---|---|---|---|");
  for (const d of report.documents) {
    lines.push(`| ${escCell(d.thing_id)} | ${escCell(d.document_type)} | ${escCell(d.lifecycle_state)} | ${d.quality_score} | ${escCell(d.review_status)} |`);
  }
  if (report.cycles.length) {
    lines.push(""); lines.push("## Dependency cycles"); lines.push("");
    for (const c of report.cycles) lines.push(`- ${c.map(escCell).join(" → ")}`);
  }
  if (report.orphans.length) {
    lines.push(""); lines.push("## Orphans"); lines.push("");
    for (const o of report.orphans) lines.push(`- ${escCell(o)}`);
  }
  return lines.join("\n") + "\n";
}
