import { describe, it, expect } from "vitest";
import { ObsidianScanner, type UTDMetadataService } from "../src/obsidian-scanner";

function fakeApi(): UTDMetadataService {
  return {
    listThings: () => [
      { thing_id: "a", file_path: "a.md", frontmatter: { doc_type: "strategy" } },
      { thing_id: "b", file_path: "b.md", frontmatter: { doc_type: "policy" } },
    ],
    getRelations: (id: string) => (id === "a" ? { depends_on: ["b"], related_to: ["c"] } : null),
    getAllThingIds: () => new Set(["a", "b"]),
  };
}

describe("ObsidianScanner", () => {
  it("maps API entries + relations into SdmDocuments", () => {
    const { documents, errors } = new ObsidianScanner(fakeApi()).scan();
    expect(errors).toEqual([]);
    expect(documents).toHaveLength(2);
    const a = documents.find((d) => d.thing_id === "a")!;
    expect(a.relations.depends_on).toEqual(["b"]);
    expect(a.relations.related_to).toEqual(["c"]);
    expect(a.relations.enables).toEqual([]);
    const b = documents.find((d) => d.thing_id === "b")!;
    expect(b.relations.depends_on).toEqual([]); // getRelations returned null
  });
});
