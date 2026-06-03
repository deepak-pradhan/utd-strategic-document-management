import { toStringArray, type SdmDocument, type ScannerLike } from "./report";

interface DocumentEntry {
  thing_id: string;
  file_path: string;
  frontmatter: Record<string, unknown>;
}

export interface UTDMetadataService {
  listThings(filter: Record<string, unknown>): DocumentEntry[];
  getRelations(thingId: string): { depends_on?: string[]; enables?: string[]; related_to?: string[] } | null;
  getAllThingIds(): Set<string>;
}

export class ObsidianScanner implements ScannerLike {
  constructor(private readonly api: UTDMetadataService) {}

  scan(): { documents: SdmDocument[]; errors: string[] } {
    // Mirror the dashboard's filter (is_active: true) so the exported report's
    // document set matches what the live dashboard shows.
    const entries = this.api.listThings({ thing_type: "strategic_documentation", is_active: true });
    const documents: SdmDocument[] = entries.map((e) => {
      const r = this.api.getRelations(e.thing_id) ?? {};
      return {
        thing_id: e.thing_id,
        file_path: e.file_path,
        frontmatter: e.frontmatter,
        relations: {
          depends_on: toStringArray(r.depends_on),
          enables: toStringArray(r.enables),
          related_to: toStringArray(r.related_to),
        },
      };
    });
    return { documents, errors: [] };
  }
}
