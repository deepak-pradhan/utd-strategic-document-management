import { describe, it, expect } from "vitest";
import * as fs from "fs";
import { run, evaluateCiGates, parseArgs } from "../src/cli";
import { FileSystemScanner } from "../src/filesystem-scanner";
import { buildGovernanceReport } from "../src/report";

const VAULT = "/projects/sandbox/utd-test-vault";
const NOW = "2026-06-03T00:00:00.000Z";
const hasVault = fs.existsSync(VAULT);

describe("CLI", () => {
  it("parses flags", () => {
    const a = parseArgs(["node", "cli", VAULT, "--format", "markdown", "--ci", "--min-score", "70"]);
    expect(a).toMatchObject({ vaultPath: VAULT, format: "markdown", ci: true, minScore: 70 });
  });

  it("exits 2 with no vault path", () => {
    expect(run(["node", "cli"], NOW)).toBe(2);
  });

  it.skipIf(!hasVault)("flags the known hippa<->soc2 cycle via the CI gate", () => {
    const { documents, errors } = new FileSystemScanner().scan(VAULT);
    const report = buildGovernanceReport(documents, { now: NOW, vaultPath: VAULT, scanErrors: errors });
    expect(report.summary.dependencies.cycle_count).toBeGreaterThan(0);
    expect(evaluateCiGates(report, 60).some((f) => /cycle/.test(f))).toBe(true);
  });
});
