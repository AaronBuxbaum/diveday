// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { routeSource } from "@/test/route-source";
import { BoatTabSheet } from "./BoatTabSheet";
import { DiverRollCall } from "./DiverRollCall";
import { boardedAt, diver, diverContext, notBackAt, t } from "./diver-roll-call-test-fixtures";

/**
 * **The Boat tab on paper is one sheet** (issue #2745). The live manifest
 * prints the packet's manifest paper (`ManifestPaper`) for the checkpoint on
 * screen, drawn print-only under the screen, and nothing of the screen.
 * Adversarial on what a safety sheet must never do: lose a diver who did not
 * come back, lose the checkpoint it was printed at, lose the dive the crew
 * logged, or carry a control.
 */

afterEach(cleanup);

const SHOP = { name: "Blue Mantis Divers", brandColor: null };

function renderSheet(diveLog: { heading: string; line: string } | null) {
  return render(
    <BoatTabSheet
      shop={SHOP}
      shopSlug="blue-mantis"
      name={t("trips.surfaces.manifest")}
      printed="Printed Sep 11, 2026 · 8:40 AM EDT"
      departure={["Two-Tank Reef"]}
      diveLog={diveLog}
    >
      <DiverRollCall
        context={diverContext({
          checkpoint: "after_dive_1",
          isDeparture: false,
          timezone: "America/New_York",
          paper: true,
          idPrefix: "t1-sheet",
          divers: [
            diver({ bookingId: "b-1", fullName: "Meera Iyer", rollCall: boardedAt() }),
            diver({ bookingId: "b-2", fullName: "Theo Lind", rollCall: notBackAt() }),
          ],
        })}
      />
    </BoatTabSheet>,
  );
}

describe("the Boat tab's sheet", () => {
  it("is shown only to the printer, as a sheet of the shop's paper", () => {
    const { container } = renderSheet(null);
    const frame = container.querySelector(".paper-sheet-frame");
    expect(frame?.hasAttribute("data-paper-print-only")).toBe(true);
    expect(frame?.querySelector(".paper-sheet")).not.toBeNull();
    expect(container.textContent).toContain("Blue Mantis Divers");
    expect(container.textContent).toContain(t("trips.surfaces.manifest"));
    expect(container.textContent).toContain("Printed Sep 11, 2026");
  });

  it("keeps a diver who did not come back, by name and in words, in manifest order", () => {
    const { container } = renderSheet(null);
    const rows = within(container).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Meera Iyer");
    expect(rows[1]).toHaveTextContent("Theo Lind");
    expect(rows[1]).toHaveTextContent(t("manifest.notBackAboardActive"));
    expect(rows[1]).toHaveTextContent("Keiko Tanaka");
  });

  it("states the dive the crew logged at this checkpoint", () => {
    const { container } = renderSheet({
      heading: "Dive log",
      line: "Dive 1 · Molasses Reef · 18 m · in 9:02, out 9:48",
    });
    expect(container.textContent).toContain("Dive log");
    expect(container.textContent).toContain("Dive 1 · Molasses Reef · 18 m · in 9:02, out 9:48");
  });

  it("leaves the screen's row ids to the screen, so the count panel's links still land", () => {
    // Both reviewers: the sheet's rows took `diver-row-b-2` first, and tapping
    // a missing diver's name in the count panel scrolled to the hidden sheet.
    const sheet = renderSheet(null);
    const screen = render(
      <div className="boat-mode">
        <DiverRollCall
          context={diverContext({
            checkpoint: "after_dive_1",
            isDeparture: false,
            timezone: "America/New_York",
            divers: [diver({ bookingId: "b-2", fullName: "Theo Lind", rollCall: notBackAt() })],
          })}
        />
      </div>,
    );
    const target = document.getElementById("diver-row-b-2");
    expect(target?.closest("[data-paper-print-only]")).toBeNull();
    expect(screen.container.contains(target)).toBe(true);
    expect(sheet.container.querySelector("#diver-row-b-2")).toBeNull();
  });

  it("names the departure in its body, not only in a page margin some browsers never draw", () => {
    const { container } = render(
      <BoatTabSheet
        shop={SHOP}
        shopSlug="blue-mantis"
        name="Manifest"
        printed="Printed"
        departure={["Two-Tank Reef", "Sep 11, 2026 · 8:00 AM EDT", "Reef Runner · After dive 1"]}
        diveLog={null}
      >
        <p>roster</p>
      </BoatTabSheet>,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Two-Tank Reef");
    expect(container.textContent).toContain("Sep 11, 2026 · 8:00 AM EDT");
    expect(container.textContent).toContain("Reef Runner · After dive 1");
  });

  it("prints the status lines above the roster, and none at the dock", () => {
    const lines = ["1 of 2 people back aboard after dive 1", "Dive 1 not marked."];
    const { container } = render(
      <BoatTabSheet
        shop={SHOP}
        shopSlug="blue-mantis"
        name="Manifest"
        printed="Printed"
        departure={[]}
        status={lines}
        diveLog={null}
      >
        <p>roster</p>
      </BoatTabSheet>,
    );
    const text = container.textContent ?? "";
    for (const line of lines) expect(text).toContain(line);
    expect(text.indexOf(lines[0] ?? "")).toBeLessThan(text.indexOf("roster"));
    const dock = renderSheet(null);
    expect(dock.container.textContent).not.toContain("back aboard after dive");
  });

  it("carries no control", () => {
    const { container } = renderSheet({ heading: "Dive log", line: "Dive 1" });
    expect(
      container.querySelectorAll("button, select, textarea, input, form, a, details, dialog"),
    ).toHaveLength(0);
  });
});

/**
 * The page wires the sheet to the same view the screen reads, so paper is the
 * checkpoint the captain is looking at, and the screen no longer carries the
 * print-only copies the sheet now holds.
 */
describe("the Boat tab's wiring", () => {
  const PAGE = routeSource(import.meta.dirname, "../page.tsx");
  const PAPER = routeSource(import.meta.dirname, "BoatTabPaper.tsx");

  it("prints ManifestPaper from the page's own view, inside the sheet", () => {
    expect(PAGE).toMatch(
      /<BoatTabPaper[\s\S]*cancelled, manifest[\s\S]*rollCall, boatPaper, stage/,
    );
    expect(PAGE.indexOf("<BoatTabPaper")).toBeLessThan(PAGE.indexOf('<div className="boat-mode">'));
    // The screen's own roll call, only its ids moved off the screen's.
    expect(PAPER).toContain("divers: { ...rollCall.divers, idPrefix: sheetIds }");
    expect(PAPER).toContain("crew: { ...rollCall.crew, idPrefix: sheetIds }");
    expect(PAPER).toContain("<ManifestPaper");
  });

  it("draws no print-only copy on the screen", () => {
    const screen = PAGE.slice(PAGE.indexOf('<div className="boat-mode">'));
    expect(screen).not.toContain("<PrintedSoulsOnBoard");
    expect(screen).not.toContain("<PrintedBoatPaper");
  });
});
