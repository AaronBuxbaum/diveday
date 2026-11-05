// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { OfflineManifestSheet } from "./ManifestSheet";
import { controls, diver, savedCopy } from "./section-fixtures";
import { OfflineTripScreen } from "./TripScreen";
import { offlineTripView } from "./trip-view";

vi.mock("@/lib/offline-manifest-store", () => ({
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
}));

/**
 * **The saved copy's paper** (issue #2745). The sheet a crew boards from when
 * a phone is the only copy, so every case asks what reaches paper: every
 * person aboard, how old the list is, nothing a pen could mistake for a box,
 * and never the words a medical alert or a held seat keeps off a printed page.
 */

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PRINTED_AT = new Date("2026-08-01T12:30:00.000Z");
const ALERT_WORDS = "Type 1 diabetic, insulin pump; glucose gel in the blue bag";

function copyWith(mutate: (copy: OfflineManifestEnvelope) => void): OfflineManifestEnvelope {
  const copy = savedCopy();
  mutate(copy);
  return copy;
}

function rosterOf(copy: OfflineManifestEnvelope) {
  const manifest = copy.snapshot.manifests[0];
  if (!manifest) throw new Error("the fixture carries a manifest");
  return manifest;
}

function renderSheet(copy: OfflineManifestEnvelope = savedCopy()) {
  const view = offlineTripView(copy, "departure");
  if (!view) throw new Error("the fixture carries a manifest");
  const onBack = vi.fn();
  render(
    <OfflineManifestSheet
      view={view}
      controls={controls()}
      printedAt={PRINTED_AT}
      onBack={onBack}
      autoPrint={false}
    />,
  );
  const sheet = document.querySelector(".paper-sheet");
  if (!(sheet instanceof HTMLElement)) throw new Error("no sheet rendered");
  return { sheet, onBack };
}

describe("OfflineManifestSheet", () => {
  it("prints every person on the saved roster, in roster order, numbered", () => {
    const copy = copyWith((c) => {
      rosterOf(c).divers.push(diver("b-ana", "Ana Ruiz"));
    });
    const { sheet } = renderSheet(copy);
    const rows = [...sheet.querySelectorAll("[data-sheet-row]")].map((row) =>
      row.getAttribute("data-sheet-row"),
    );
    expect(rows).toEqual(["b-priya", "b-marcus", "b-ana"]);
    expect(within(sheet).getByText("Ana Ruiz").parentElement?.textContent).toContain("03");
    // And the crew, by name: a head count is both halves.
    expect(within(sheet).getByText("Dana Divemaster")).toBeTruthy();
  });

  it("says how old the list is, with its zone, above the first name", () => {
    const { sheet } = renderSheet();
    const text = sheet.textContent ?? "";
    expect(text).toMatch(/Saved .*EDT/);
    expect(text.indexOf("Saved")).toBeLessThan(text.indexOf("Priya Shah"));
    // The fold line: when this paper came out of the printer, zone named.
    expect(sheet.querySelector(".paper-sheet-fold")?.textContent).toMatch(/Printed .*8:30.*EDT/);
  });

  it("carries no control anyone could try to fill in", () => {
    const { sheet } = renderSheet();
    expect(
      sheet.querySelectorAll("button, input, select, textarea, a, details, summary"),
    ).toHaveLength(0);
  });

  it("keeps the blocked diver blocked on paper, in the row's own words", () => {
    const copy = copyWith((c) => {
      const marcus = rosterOf(c).divers[1];
      if (!marcus) throw new Error("fixture");
      marcus.readiness = {
        status: "blocked",
        blockers: [{ code: "waiver_not_sent", text: "Waiver has not been sent" }],
      };
    });
    const { sheet } = renderSheet(copy);
    const row = sheet.querySelector('[data-sheet-row="b-marcus"]');
    expect(row?.textContent).toContain("Waiver has not been sent");
  });

  it("never prints a medical alert's words, even when this phone holds them", () => {
    const copy = copyWith((c) => {
      const priya = rosterOf(c).divers[0];
      if (!priya) throw new Error("fixture");
      priya.medicalAlert = { text: ALERT_WORDS };
      c.medicalAlertsSavedBy = {
        personId: "p-owner",
        name: "Olive Owner",
        savedAt: "2026-08-01T11:00:00.000Z",
      };
    });
    const { sheet } = renderSheet(copy);
    expect(sheet.textContent).not.toContain("insulin");
    expect(sheet.textContent).not.toContain("Olive Owner");
    // The row says an alert exists, and the sheet says where to read it.
    expect(sheet.querySelector('[data-sheet-row="b-priya"]')?.textContent).toContain(
      "Medical alert",
    );
    expect(sheet.textContent).toContain("this sheet leaves off");
  });

  it("prints a held seat's reason and desk contact, never the matched person's particulars", () => {
    const copy = copyWith((c) => {
      const priya = rosterOf(c).divers[0];
      if (!priya) throw new Error("fixture");
      priya.identityWithheld = true;
      priya.emergencyContactName = "Ravi Shah";
      priya.emergencyContactPhone = "+1 305 555 0101";
      priya.medicalAlert = { text: ALERT_WORDS };
      priya.heldEmergencyContact = { name: "Front desk", phone: "+1 305 555 0199" };
    });
    const { sheet } = renderSheet(copy);
    const row = sheet.querySelector('[data-sheet-row="b-priya"]');
    expect(row?.textContent).not.toContain("Ravi Shah");
    expect(row?.textContent).not.toContain("0101");
    expect(row?.textContent).not.toContain("Medical alert");
    expect(row?.textContent).toContain("+1 305 555 0199");
    // No alert line for a row that cannot say it has one.
    expect(sheet.textContent).not.toContain("this sheet leaves off");
  });

  it("prints the emergency reference the copy saved", () => {
    const copy = copyWith((c) => {
      c.snapshot.shop.emergencyReference = {
        lines: [{ label: "Chamber", phone: "+1 305 555 0142" }],
        vessel: "",
        shoreContact: "",
        plan: "",
      };
    });
    const { sheet } = renderSheet(copy);
    expect(sheet.textContent).toContain("+1 305 555 0142");
  });

  it("goes back to the roll call from its own door, which is off the sheet", () => {
    const { sheet, onBack } = renderSheet();
    const back = screen.getByRole("button", { name: "Back to the roll call" });
    expect(sheet.contains(back)).toBe(false);
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("OfflineTripScreen's paper door", () => {
  function renderScreen(copy: OfflineManifestEnvelope) {
    const view = offlineTripView(copy, "departure");
    if (!view) throw new Error("the fixture carries a manifest");
    vi.spyOn(window, "print").mockImplementation(() => {});
    render(
      <OfflineTripScreen
        view={view}
        controls={controls()}
        tripId="trip-1"
        foreignPendingChanges={false}
        noteLossMessage=""
        shellVersionCopy={{ updateBanner: "", refreshButton: "", staleBanner: "" }}
        discardNotice={null}
        reconcile={async () => {}}
      />,
    );
  }

  it("swaps the screen for the sheet, so no roll-call control is on the printed page", () => {
    renderScreen(savedCopy());
    fireEvent.click(screen.getByRole("button", { name: "Print this saved copy" }));
    expect(document.querySelector(".paper-sheet")).not.toBeNull();
    expect(document.querySelector("[data-roll-call-surface]")).toBeNull();
  });

  it("offers no paper for an expired copy, which is not a boarding source", () => {
    renderScreen(
      copyWith((c) => {
        c.snapshot.expiresAt = "2000-01-01T00:00:00.000Z";
      }),
    );
    expect(screen.queryByRole("button", { name: "Print this saved copy" })).toBeNull();
  });
});
