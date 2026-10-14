import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MARINE_LIFE_CATALOG } from "@/db/marine-life-catalog";
import { DIVE_SITE_TEMPLATES } from "./dive-site-templates";
import { type PhotoRecords, renderCredits } from "./photo-records";
import ledger from "./photo-records.json";
import { FOLDERS, type PhotoFolder, refusal } from "./photo-rules";

/**
 * The guard behind `pnpm content:photos`: starting content cannot merge with a
 * photograph nobody vetted, or a subject nobody looked for one for.
 *
 * Every rule here names the command that fixes it, because the person who
 * trips it is usually adding a species or a template and has not met the tool.
 */
const records = ledger as unknown as PhotoRecords;
const PUBLIC = path.join(process.cwd(), "public");
const FIX = "run `pnpm content:photos todo` and follow the loop in scripts/content-photos.ts";

function bundled(folder: PhotoFolder): string[] {
  return readdirSync(path.join(PUBLIC, folder))
    .filter((entry) => entry.endsWith(".jpg"))
    .map((entry) => `${folder}/${entry}`);
}

describe("the photo ledger", () => {
  it("has a record for every bundled photograph, and a photograph for every record", () => {
    const files = [...bundled("marine-life"), ...bundled("dive-sites")];
    const unrecorded = files.filter((file) => !records.photos[file]);
    const missing = Object.keys(records.photos).filter(
      (file) => !existsSync(path.join(PUBLIC, file)),
    );
    expect({ unrecorded, missing, fix: FIX }).toEqual({ unrecorded: [], missing: [], fix: FIX });
  });

  it("holds only photographs that clear today's rules, and that a person looked at", () => {
    const failures = Object.entries(records.photos).flatMap(([file, record]) => {
      const folder = file.split("/")[0] as PhotoFolder;
      const problem = refusal(
        {
          title: record.source,
          licence: record.licence,
          width: record.sourceSize[0],
          height: record.sourceSize[1],
        },
        folder,
      );
      if (problem) return [`${file}: ${problem}`];
      if (!record.reviewed) return [`${file}: never reviewed`];
      return [];
    });
    expect(failures).toEqual([]);
  });

  it("gives every catalog species a vetted photograph", () => {
    const subjects = new Set(Object.values(records.photos).map((record) => record.subject));
    const without = MARINE_LIFE_CATALOG.filter(
      (species) => !subjects.has(`species:${species.slug}`),
    );
    expect(without.map((species) => species.slug)).toEqual([]);
  });

  it("gives every template a vetted cover photograph or a recorded reason it has none", () => {
    const subjects = new Set(Object.values(records.photos).map((record) => record.subject));
    const unaccounted = DIVE_SITE_TEMPLATES.filter(
      ({ slug }) => !subjects.has(`site:${slug}`) && !records.unphotographed[`site:${slug}`],
    ).map(({ slug }) => slug);
    const both = DIVE_SITE_TEMPLATES.filter(
      ({ slug }) => subjects.has(`site:${slug}`) && records.unphotographed[`site:${slug}`],
    ).map(({ slug }) => slug);
    expect({ unaccounted, both }).toEqual({ unaccounted: [], both: [] });
  });

  it("only excuses dive-site subjects from having a photograph", () => {
    expect(Object.keys(records.unphotographed).filter((id) => !id.startsWith("site:"))).toEqual([]);
  });

  it("keeps both folders' credit lists exactly as the ledger renders them", () => {
    for (const folder of Object.keys(FOLDERS) as PhotoFolder[]) {
      const readme = readFileSync(path.join(PUBLIC, folder, "README.md"), "utf8");
      expect(readme, `public/${folder}/README.md: run \`pnpm content:photos readme\``).toBe(
        renderCredits(readme, folder, records),
      );
    }
  });
});
