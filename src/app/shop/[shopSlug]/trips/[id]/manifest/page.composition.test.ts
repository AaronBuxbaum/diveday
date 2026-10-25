import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routeSource } from "@/test/route-source";

/**
 * The manifest is a Server Component over the roll call's reads, so these read
 * its source rather than render it. Only the two wiring invariants stay here;
 * the page's layout is the visual suite's to photograph.
 */
const SOURCE = routeSource(import.meta.dirname, "page.tsx");
const READS = routeSource(import.meta.dirname, "_components/manifest-reads.ts");

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

/**
 * **A cancelled departure nobody counted on reads closed** (#2285): the page
 * reads the writers' own gate and hands the answer to both roll-call lists
 * and the banner, so neither list can draw a control the writer refuses.
 */
describe("a cancelled departure's roll call", () => {
  it("reads the writers' gate and closes both lists and the banner on it", () => {
    expect(READS).toMatch(/cancelledRollCall\(\{[^}]*rollCallOpen/s);
    expect(SOURCE).toContain("    cancelled,\n");
    // One set of props per list, read by the screen and the packet's paper alike.
    expect(SOURCE).toContain('rollCallClosed: cancelled === "closed",');
    expect(SOURCE).toContain("<DiverRollCall context={rollCall.divers} />");
    expect(SOURCE).toContain("<CrewRollCall {...rollCall.crew} />");
    expect(SOURCE).toContain("rollCall={rollCall}");
    const props = readFileSync(
      path.join(import.meta.dirname, "_components/roll-call-props.ts"),
      "utf8",
    );
    expect(props.match(/^ {6}rollCallClosed,$/gm)).toHaveLength(2);
    expect(SOURCE).toContain("<CancelledRollCallBanner state={cancelled}");
  });
});
