import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The manifest is a Server Component over the roll call's reads, so these read
 * its source rather than render it. Only the two wiring invariants stay here;
 * the page's layout is the visual suite's to photograph.
 */
const HERE = import.meta.dirname;
const SOURCE = readFileSync(join(HERE, "page.tsx"), "utf8");

/**
 * **A held seat's particulars stay withheld on every reader** (`held-seat.ts`,
 * `open-checkpoint.ts`). `openCheckpoint` returns the manifest with
 * `withholdHeldSeatParticulars` applied; `departureManifest` is the raw one.
 * The dock desk's found-aboard picker lists seats by name, so it must read
 * the withheld manifest, or a held seat shows the matched person's name
 * instead of the booked-as name (dive-domain review, 2026-10-12).
 */
describe("the dock desk's seat list", () => {
  it("reads the withheld manifest, never the raw departure one", () => {
    const dockDesk = SOURCE.slice(
      SOURCE.indexOf("<DockDesk"),
      SOURCE.indexOf("/>", SOURCE.indexOf("<DockDesk")),
    );
    expect(dockDesk).toContain("seats={manifest.divers}");
    expect(dockDesk).not.toContain("seats={departureManifest.divers}");
  });
});

/**
 * **A stale `?checkpoint=` leaves the address bar** (#2508): the page sends it
 * to the manifest's canonical URL instead of rendering the dock under the
 * stale address. `openCheckpoint` decides; the page only acts on it.
 */
describe("a stale checkpoint in the URL", () => {
  it("redirects to the manifest without it", () => {
    const at = SOURCE.indexOf('"stale" in opened');
    expect(at, "the page reads openCheckpoint's stale answer").toBeGreaterThan(-1);
    const branch = SOURCE.slice(at, SOURCE.indexOf(";", at));
    expect(branch).toContain('redirect(shopPath(shopSlug, "trips", tripId, "manifest"))');
  });
});
