// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { OfflineManifestSheet, SHEET_EXPIRY_CHECK_MS } from "./ManifestSheet";
import { controls, diver, savedCopy } from "./section-fixtures";
import { OfflineTripScreen } from "./TripScreen";
import { offlineTripView } from "./trip-view";

vi.mock("@/lib/offline-manifest-store", () => ({
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
}));

/** The clock every reader here asks, moved by a test to make a copy expire under an open sheet. */
const clock = vi.hoisted(() => ({ now: new Date("2026-08-01T12:30:00.000Z") }));
vi.mock("@/lib/clock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clock")>()),
  nowDate: () => new Date(clock.now),
  nowMs: () => clock.now.getTime(),
}));

/**
 * **The saved copy's paper** (issue #2745). The sheet a crew boards from when
 * a phone is the only copy, so every case asks what reaches paper: every
 * person aboard, how old the list is, nothing a pen could mistake for a box,
 * and never the words a medical alert or a held seat keeps off a printed page.
 */

const OPENED_AT = new Date("2026-08-01T12:30:00.000Z");

beforeEach(() => {
  clock.now = OPENED_AT;
  vi.spyOn(window, "print").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
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
      origin="https://app.diveday.test"
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
    // And when it stops being a boarding source, zone named.
    expect(sheet.querySelector("[data-sheet-expires]")?.textContent).toMatch(
      /Not a boarding source after .*EST/,
    );
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

  it("restates every fact the screen tucks behind Contact & gear, nitrox and riding-only first", () => {
    const copy = copyWith((c) => {
      const [priya, marcus] = rosterOf(c).divers;
      if (!priya || !marcus) throw new Error("fixture");
      priya.nitroxRequested = true;
      priya.dietaryNote = "No shellfish";
      marcus.participantType = "rider";
      marcus.medicalWarnings = { ridingNotClearedOn: "2026-07-30", referredOn: "2026-07-29" };
    });
    const { sheet } = renderSheet(copy);
    const priya = sheet.querySelector('[data-sheet-row="b-priya"]')?.textContent ?? "";
    expect(priya).toContain("Nitrox requested");
    expect(priya).toContain("Rental fit");
    expect(priya).toContain("No shellfish");
    const marcus = sheet.querySelector('[data-sheet-row="b-marcus"]')?.textContent ?? "";
    expect(marcus).toMatch(/not clear this person on Jul\s30/);
    expect(marcus).toMatch(/Referred to a physician on Jul\s29/);
  });

  it("keeps the riding-only sentence on paper after a dive, when a hold takes the status slot", () => {
    const copy = copyWith((c) => {
      const manifest = rosterOf(c);
      const marcus = manifest.divers[1];
      if (!marcus) throw new Error("fixture");
      marcus.participantType = "rider";
      marcus.medicalWarnings = { ridingNotClearedOn: "2026-07-30" };
      marcus.readiness = {
        status: "blocked",
        blockers: [{ code: "medical_review", text: "Medical review open" }],
      };
      marcus.rollCall = {
        state: "boarded",
        occurredAt: "2026-08-01T12:10:00.000Z",
      } as typeof marcus.rollCall;
      c.snapshot.manifests.push({ ...manifest, checkpoint: "after_dive_1" });
    });
    const view = offlineTripView(copy, "after_dive_1");
    if (!view) throw new Error("fixture");
    render(
      <OfflineManifestSheet
        view={view}
        controls={controls()}
        origin={null}
        onBack={() => {}}
        autoPrint={false}
      />,
    );
    const row = document.querySelector('[data-sheet-row="b-marcus"]')?.textContent ?? "";
    expect(row).toMatch(/not clear this person on Jul\s30/);
  });

  it("prints a held seat's gear and medical lines as nothing at all", () => {
    const copy = copyWith((c) => {
      const priya = rosterOf(c).divers[0];
      if (!priya) throw new Error("fixture");
      priya.identityWithheld = true;
      priya.nitroxRequested = true;
      priya.dietaryNote = "No shellfish";
      priya.medicalWarnings = { referredOn: "2026-07-29" };
    });
    const { sheet } = renderSheet(copy);
    const row = sheet.querySelector('[data-sheet-row="b-priya"]')?.textContent ?? "";
    expect(row).not.toContain("Nitrox");
    expect(row).not.toContain("No shellfish");
    expect(row).not.toContain("physician");
  });

  it("prints persons on board, the over-capacity line, and the boat's safety notices", () => {
    const copy = copyWith((c) => {
      const manifest = rosterOf(c);
      manifest.trip.certifiedTotalPersons = 1;
      manifest.divers.forEach((d) => {
        d.rollCall = {
          state: "boarded",
          occurredAt: "2026-08-01T12:10:00.000Z",
        } as typeof d.rollCall;
      });
      c.snapshot.boatSafety = {
        heading: "Boat papers and safety kit",
        lines: [{ text: "Flares expired on Jul 1", tone: "danger" }],
      } as unknown as NonNullable<typeof c.snapshot.boatSafety>;
    });
    const { sheet } = renderSheet(copy);
    expect(sheet.querySelector("[data-sheet-souls]")?.textContent).toBe(
      "Passengers 2 · Crew 1 · Souls on board 3",
    );
    expect(sheet.querySelector("[data-sheet-over-capacity]")).not.toBeNull();
    expect(sheet.textContent).toContain("Flares expired on Jul 1");
  });

  it("gives every person a box to tick at every checkpoint the copy carries", () => {
    const copy = copyWith((c) => {
      const manifest = rosterOf(c);
      c.snapshot.manifests.push({ ...manifest, checkpoint: "after_dive_1" });
    });
    const { sheet } = renderSheet(copy);
    const people = sheet.querySelectorAll("[data-sheet-row], [data-sheet-crew] > li");
    expect(people).toHaveLength(3);
    for (const person of people) {
      const boxes = person.querySelector("[data-sheet-boxes]")?.textContent ?? "";
      expect(boxes).toContain("Before departure");
      expect(boxes).toMatch(/dive 1/i);
    }
  });

  it("drops back to the screen when the copy expires under an open sheet, on a timer", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { onBack } = renderSheet(
      copyWith((c) => {
        c.snapshot.expiresAt = "2026-08-01T12:31:00.000Z";
      }),
    );
    clock.now = new Date("2026-08-01T12:32:00.000Z");
    act(() => {
      vi.advanceTimersByTime(SHEET_EXPIRY_CHECK_MS);
    });
    expect(onBack).toHaveBeenCalled();
  });

  it("refuses the sheet's own Print once the copy has expired", () => {
    const { onBack } = renderSheet(
      copyWith((c) => {
        c.snapshot.expiresAt = "2026-08-01T12:31:00.000Z";
      }),
    );
    clock.now = new Date("2026-08-01T12:32:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(window.print).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });

  it("leaves the sheet at the browser's own print once the copy has expired", () => {
    const { onBack } = renderSheet(
      copyWith((c) => {
        c.snapshot.expiresAt = "2026-08-01T12:31:00.000Z";
      }),
    );
    clock.now = new Date("2026-08-01T12:32:00.000Z");
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(onBack).toHaveBeenCalled();
  });

  it("stamps the fold with the time it printed, not the time the door was pressed", () => {
    const { sheet } = renderSheet();
    clock.now = new Date("2026-08-01T15:05:00.000Z");
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(sheet.querySelector(".paper-sheet-fold")?.textContent).toMatch(/Printed .*11:05.*EDT/);
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
    // Ctrl+P on it prints one line, never the expired roster: the page holds
    // a print-only frame, so on paper it is that frame (`ScreenNotPrinted`).
    const onPaper = document.querySelector(".paper-sheet-frame[data-paper-print-only]");
    expect(onPaper?.textContent).toContain("has no paper manifest");
    expect(
      document.querySelector("[data-roll-call-surface]")?.closest(".paper-sheet-frame"),
    ).toBeNull();
  });

  it("never prints the screen, so an opened panel's medical alert words cannot reach paper", () => {
    renderScreen(
      copyWith((c) => {
        const priya = rosterOf(c).divers[0];
        if (!priya) throw new Error("fixture");
        priya.medicalAlert = { text: ALERT_WORDS };
      }),
    );
    for (const details of document.querySelectorAll("details")) details.open = true;
    const words = screen.getByText(ALERT_WORDS);
    // The page holds a print-only frame, so on paper it is that frame and
    // nothing of the screen: the words sit outside every sheet.
    expect(words.closest(".paper-sheet-frame")).toBeNull();
    // And paper says where the paper manifest is instead.
    const onPaper = document.querySelector(".paper-sheet-frame[data-paper-print-only]");
    expect(onPaper?.textContent).toContain("Print this saved copy");
  });
});
