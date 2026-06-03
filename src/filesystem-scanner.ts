import * as fs from "fs";
import * as path from "path";
import type { SdmDocument, ScannerLike } from "./report";

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}

export class FileSystemScanner implements ScannerLike {
  constructor(private readonly vaultPath: string = "") {}

  scan(vaultPath: string = this.vaultPath): { documents: SdmDocument[]; errors: string[] } {
    const errors: string[] = [];
    const documents: SdmDocument[] = [];
    if (!fs.existsSync(vaultPath)) {
      return { documents, errors: [`Vault path does not exist: ${vaultPath}`] };
    }
    const matter = require("gray-matter");
    for (const file of this.walk(vaultPath, ".md", errors)) {
      const rel = path.relative(vaultPath, file).replace(/\\/g, "/");
      try {
        const fm = (matter(fs.readFileSync(file, "utf-8")).data || {}) as Record<string, unknown>;
        documents.push({
          thing_id: typeof fm["thing_id"] === "string" ? (fm["thing_id"] as string) : `__missing_${documents.length}`,
          file_path: rel,
          frontmatter: fm,
          relations: {
            depends_on: toStringArray(fm["depends_on"]),
            enables: toStringArray(fm["enables"]),
            related_to: toStringArray(fm["related_to"]),
          },
        });
      } catch (err) {
        errors.push(`Failed to parse ${rel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { documents, errors };
  }

  private walk(dir: string, ext: string, errors: string[]): string[] {
    const out: string[] = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...this.walk(full, ext, errors));
        else if (entry.isFile() && entry.name.endsWith(ext)) out.push(full);
      }
    } catch (err) {
      errors.push(`Cannot read directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return out;
  }
}
