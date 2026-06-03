import { toStringArray, type SdmDocument, type ScannerLike } from "./report";

export interface DocumentEntry {
  thing_id: string;
  file_path: string;
  frontmatter: Record<string, unknown>;
}

/** The UTD Manager metadata API surface this plugin consumes. Single source of
 *  truth — imported by the dashboard view and the plugin entry. */
export interface UTDMetadataService {
  listThings(filter: Record<string, unknown>): DocumentEntry[];
  getRelations(thingId: string): { depends_on?: string[]; enables?: string[]; related_to?: string[] } | null;
  getAllThingIds(): Set<string>;
  onDidUpdate(callback: (thingId: string) => void): { dispose(): void };
  /** Optional: not provided by every UTD Manager version. */
  getThingFile?(thingId: string): unknown;
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
