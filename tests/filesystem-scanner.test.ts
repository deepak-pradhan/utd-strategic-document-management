import { describe, it, expect } from "vitest";
import { FileSystemScanner } from "../src/filesystem-scanner";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function tempVault(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdm-test-"));
  for (const [p, c] of Object.entries(files)) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, c, "utf-8");
  }
  return dir;
}

describe("FileSystemScanner", () => {
  it("parses frontmatter and relations", () => {
    const vault = tempVault({
      "a.md": "---\nthing_id: a\ndoc_type: strategy\ndepends_on:\n  - b\n---\nbody",
    });
    try {
      const { documents, errors } = new FileSystemScanner().scan(vault);
      expect(errors).toHaveLength(0);
      expect(documents).toHaveLength(1);
      expect(documents[0].thing_id).toBe("a");
      expect(documents[0].relations.depends_on).toEqual(["b"]);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it("surfaces unreadable directories as errors instead of failing silently", () => {
    const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;
    if (runningAsRoot) return;
    const vault = tempVault({ "ok.md": "---\nthing_id: ok\n---\n", "locked/x.md": "---\nthing_id: x\n---\n" });
    const locked = path.join(vault, "locked");
    fs.chmodSync(locked, 0o000);
    try {
      const { documents, errors } = new FileSystemScanner().scan(vault);
      expect(documents.some((d) => d.thing_id === "ok")).toBe(true);
      expect(errors.some((e) => /cannot read directory/i.test(e))).toBe(true);
    } finally {
      fs.chmodSync(locked, 0o755);
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
