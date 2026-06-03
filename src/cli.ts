import * as fs from "fs";
import { FileSystemScanner } from "./filesystem-scanner";
import { buildGovernanceReport, reportToJSON, reportToMarkdown, type GovernanceReport } from "./report";
import { reportToHTML } from "./report-html";
import { reportToMDX } from "./report-mdx";

type Format = "json" | "markdown" | "html" | "mdx";

interface CliArgs {
  vaultPath: string;
  format: Format;
  output?: string;
  ci: boolean;
  minScore: number;
  verbose: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const out: CliArgs = { vaultPath: "", format: "json", ci: false, minScore: 60, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--format") out.format = args[++i] as Format;
    else if (a === "--output") out.output = args[++i];
    else if (a === "--html") out.format = "html";
    else if (a === "--ci") out.ci = true;
    else if (a === "--min-score") out.minScore = Number(args[++i]);
    else if (a === "--verbose") out.verbose = true;
    else if (!a.startsWith("--")) out.vaultPath = a;
  }
  return out;
}

export function serialize(report: GovernanceReport, format: Format): string {
  switch (format) {
    case "json": return reportToJSON(report);
    case "markdown": return reportToMarkdown(report);
    case "html": return reportToHTML(report);
    case "mdx": return reportToMDX(report);
  }
}

/** Returns the list of tripped gates (empty = clean). All gates are always on. */
export function evaluateCiGates(report: GovernanceReport, minScore: number): string[] {
  const failures: string[] = [];
  if (report.summary.dependencies.cycle_count > 0) failures.push(`${report.summary.dependencies.cycle_count} dependency cycle(s)`);
  if (report.summary.review_queue.overdue > 0) failures.push(`${report.summary.review_queue.overdue} overdue review(s)`);
  const lowQuality = report.documents.filter((d) => d.quality_score < minScore);
  if (lowQuality.length) failures.push(`${lowQuality.length} document(s) below quality ${minScore}`);
  if (report.summary.dependencies.orphan_count > 0) failures.push(`${report.summary.dependencies.orphan_count} orphan(s)`);
  return failures;
}

export function run(argv: string[], now: string): number {
  const args = parseArgs(argv);
  if (!args.vaultPath) {
    process.stderr.write("Usage: utd-sdm <vault-path> [--format json|markdown|html|mdx] [--output f] [--ci] [--min-score n] [--verbose]\n");
    return 2;
  }
  const { documents, errors } = new FileSystemScanner().scan(args.vaultPath);
  if (args.verbose) process.stderr.write(`Scanned ${documents.length} documents\n`);
  const report = buildGovernanceReport(documents, { now, vaultPath: args.vaultPath, scanErrors: errors });
  const text = serialize(report, args.format);
  if (args.output) fs.writeFileSync(args.output, text, "utf-8");
  else process.stdout.write(text + "\n");

  if (args.ci) {
    const failures = evaluateCiGates(report, args.minScore);
    if (failures.length) {
      process.stderr.write(`CI gate failed: ${failures.join("; ")}\n`);
      return 1;
    }
  }
  return 0;
}

if (require.main === module) {
  process.exit(run(process.argv, new Date().toISOString()));
}
