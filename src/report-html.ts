import type { GovernanceReport, GovernanceDocument } from "./report";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function qualityColor(score: number): string {
  return score >= 80 ? "#16a34a" : score >= 50 ? "#ea580c" : "#dc2626";
}
function row(d: GovernanceDocument): string {
  return `<tr><td>${esc(d.thing_id)}</td><td>${esc(d.title)}</td><td>${esc(d.document_type)}</td>`
    + `<td>${esc(d.lifecycle_state)}</td>`
    + `<td style="color:${qualityColor(d.quality_score)};font-weight:600">${d.quality_score}</td>`
    + `<td>${esc(d.review_status)}</td></tr>`;
}
export function reportToHTML(report: GovernanceReport): string {
  const s = report.summary;
  const lifecycle = Object.entries(s.lifecycle.by_state).map(([state, n]) => `<li>${esc(state)}: ${n}</li>`).join("");
  const docRows = report.documents.map(row).join("");
  const cycles = report.cycles.length
    ? `<h2>Dependency cycles (${report.cycles.length})</h2><ul>${report.cycles.map((c) => `<li>${c.map(esc).join(" → ")}</li>`).join("")}</ul>`
    : "";
  const orphans = report.orphans.length
    ? `<h2>Orphans (${report.orphans.length})</h2><ul>${report.orphans.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`
    : "";
  const errors = report.scan_errors.length
    ? `<h2>Scan errors</h2><ul>${report.scan_errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Governance Report</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#1f2937}
 h1{margin-bottom:4px} .meta{color:#6b7280;font-size:13px}
 .cards{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
 .card{border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;min-width:120px}
 .card .n{font-size:24px;font-weight:700}
 table{border-collapse:collapse;width:100%;margin:8px 0}
 th,td{border:1px solid #e5e7eb;padding:6px 10px;text-align:left;font-size:14px}
 th{background:#f9fafb}
</style></head><body>
<h1>Governance Report</h1>
<div class="meta">${esc(report.id)} · ${esc(report.timestamp)} · ${esc(report.vault_path)} · ${report.duration_ms}ms</div>
<div class="cards">
 <div class="card"><div class="n">${s.total_documents}</div>documents</div>
 <div class="card"><div class="n">${s.quality.average}</div>avg quality</div>
 <div class="card"><div class="n">${s.review_queue.overdue}</div>overdue</div>
 <div class="card"><div class="n">${s.dependencies.cycle_count}</div>cycles</div>
 <div class="card"><div class="n">${s.dependencies.orphan_count}</div>orphans</div>
</div>
<h2>Lifecycle</h2><ul>${lifecycle}</ul>
<h2>Documents</h2>
<table><thead><tr><th>ID</th><th>Title</th><th>Type</th><th>State</th><th>Quality</th><th>Review</th></tr></thead>
<tbody>${docRows}</tbody></table>
${cycles}
${orphans}
${errors}
</body></html>`;
}
