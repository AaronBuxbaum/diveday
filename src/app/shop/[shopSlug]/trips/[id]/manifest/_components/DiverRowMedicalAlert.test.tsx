// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetRevealedMedicalAlerts,
  type MedicalAlertResult,
} from "@/components/MedicalAlertReveal";
import type { TripManifest } from "@/lib/manifests";
import { DiverRollCall } from "./DiverRollCall";
import { DiverRowPanel } from "./DiverRowPanel";
import { DiverRowPrint } from "./DiverRowPrint";
import { diver, diverContext, renderList, t } from "./diver-roll-call-test-fixtures";
import { diverRowState } from "./diver-row-state";

afterEach(() => {
  cleanup();
  forgetRevealedMedicalAlerts();
});

const ALERT = "Bee-sting allergy. EpiPen in the blue dry bag.";
const UNREADABLE = t("manifest.medicalAlertReaders");
// Named on the crew list, yet not named as a reader: a crew member who
// rostered themselves cannot read it (H-20261023-medical-alert-for-the amendment).
const CREW = [{ fullName: "Keiko Tanaka" }] as TripManifest["crew"];

type BindShow = (bookingId: string) => () => Promise<MedicalAlertResult>;

function renderPanel(
  showMedicalAlert: BindShow | undefined,
  overrides: Parameters<typeof diver>[0] = {},
  emergencyShowMedicalAlert?: BindShow,
) {
  const row = diver({ bookingId: "b-1", medicalAlert: true, ...overrides });
  return render(
    <DiverRowPanel
      context={diverContext({
        checkpoint: "departure",
        isDeparture: true,
        divers: [row],
        crew: CREW,
        showMedicalAlert,
        emergencyShowMedicalAlert,
      })}
      diver={row}
      state={diverRowState(row, "departure", true, "America/New_York")}
      sharedAdvisoryTexts={new Set()}
      bookingNotes={[]}
    />,
  );
}

/** Issue #2960: the chip is for every staffer; the words are behind a recorded tap. */
describe("a medical alert on the manifest", () => {
  it("puts the chip on the row, for every staffer, and never on a seat without one", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [
        diver({ bookingId: "b-1", medicalAlert: true }),
        diver({ bookingId: "b-2", fullName: "Ana Ruiz" }),
      ],
    });
    const rows = within(container).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(t("manifest.medicalAlertChip"));
    expect(rows[1]).not.toHaveTextContent(t("manifest.medicalAlertChip"));
    expect(container).not.toHaveTextContent(ALERT);
  });

  it("puts no chip on a held seat, whose release may be someone else's", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [diver({ bookingId: "b-1", medicalAlert: true, identityWithheld: true })],
    });
    expect(container).not.toHaveTextContent(t("manifest.medicalAlertChip"));
  });

  it("shows the words only after the tap, from the action", async () => {
    const show = vi.fn(async () => ({ ok: true, text: ALERT }) as const);
    const bind = vi.fn((_bookingId: string) => show);
    renderPanel(bind);
    expect(bind).toHaveBeenCalledWith("b-1");
    expect(screen.queryByText(ALERT)).toBeNull();
    expect(screen.getByText(t("manifest.medicalAlertShowHint"))).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("manifest.medicalAlertShow") }));
    });
    expect(show).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(ALERT)).toBeInTheDocument();
    // Staff are told what it is and is not, beside the words.
    expect(screen.getByText(t("manifest.medicalAlertNotReviewed"))).toBeInTheDocument();
  });

  it("keeps the words through closing and reopening the sheet, with no second read", async () => {
    const show = vi.fn(async () => ({ ok: true, text: ALERT }) as const);
    const first = renderPanel(() => show);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("manifest.medicalAlertShow") }));
    });
    expect(await screen.findByText(ALERT)).toBeInTheDocument();
    first.unmount();
    renderPanel(() => show);
    expect(screen.getByText(ALERT)).toBeInTheDocument();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("says there is no signal when the call fails at sea, and never throws to the page", async () => {
    const show = vi.fn(async (): Promise<MedicalAlertResult> => {
      throw new TypeError("Failed to fetch");
    });
    renderPanel(() => show);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("manifest.medicalAlertShow") }));
    });
    expect(await screen.findByText(t("manifest.medicalAlertNoSignal"))).toBeInTheDocument();
    expect(screen.getByText(t("manifest.medicalAlertHeading"))).toBeInTheDocument();
  });

  it("says a refused read failed, and shows nothing", async () => {
    const show = vi.fn(async () => ({ ok: false }) as const);
    renderPanel(() => show);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("manifest.medicalAlertShow") }));
    });
    expect(await screen.findByText(t("manifest.medicalAlertShowFailed"))).toBeInTheDocument();
  });

  it("tells a staffer who may not read it who can and whom to ask, with no button", () => {
    renderPanel(undefined);
    expect(screen.getByText(t("manifest.medicalAlertHeading"))).toBeInTheDocument();
    expect(screen.getByText(UNREADABLE)).toBeInTheDocument();
    expect(UNREADABLE).toContain("Ask one of them");
    expect(screen.queryByText(/Keiko Tanaka/)).toBeNull();
    expect(screen.queryByRole("button", { name: t("manifest.medicalAlertShow") })).toBeNull();
  });

  it("draws no block on a seat without one", () => {
    renderPanel(undefined, { medicalAlert: false });
    expect(screen.queryByText(t("manifest.medicalAlertHeading"))).toBeNull();
  });

  it("prints the fact, never the words", () => {
    const row = diver({ bookingId: "b-1", medicalAlert: true });
    const { container } = render(
      <DiverRowPrint
        diver={row}
        state={diverRowState(row, "departure", true, "America/New_York")}
        checkpoint="departure"
        auditLabel="Boarded"
        teamLabel={null}
        locale="en-US"
        timezone="America/New_York"
        t={t}
      />,
    );
    // The flag, and who can read it in DiveDay.
    expect(container).toHaveTextContent(t("manifest.medicalAlertPrinted"));
    expect(t("manifest.medicalAlertPrinted")).toContain("DiveDay");
    expect(container).not.toHaveTextContent(ALERT);
  });
});

/**
 * Issue #2990: a staffer the crew rule refuses may open the words in an
 * emergency on the day, behind a confirm step, every open recorded.
 */
describe("the emergency read in the reveal sheet", () => {
  const OFFER = t("manifest.medicalAlertEmergencyOffer");
  const CONFIRM = t("manifest.medicalAlertEmergencyConfirm");

  it("offers it under who can read it, and asks before it calls anything", async () => {
    const emergency = vi.fn(async () => ({ ok: true, text: ALERT }) as const);
    const bind = vi.fn((_bookingId: string) => emergency);
    renderPanel(undefined, {}, bind);
    expect(bind).toHaveBeenCalledWith("b-1");
    expect(screen.getByText(UNREADABLE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: OFFER }));
    // The confirm step: for emergencies only, and the owner will see it.
    const body = t("manifest.medicalAlertEmergencyConfirmBody");
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(body).toContain("emergency");
    expect(body).toContain("diver’s record");
    expect(body).toContain("owner will see it");
    // No promise of an email the owner may have turned off (domain review 2, S5).
    expect(body).not.toMatch(/email/i);
    expect(emergency).not.toHaveBeenCalled();
    expect(screen.queryByText(ALERT)).toBeNull();
    // Cancel goes back without a call.
    fireEvent.click(
      screen.getByRole("button", { name: t("manifest.medicalAlertEmergencyCancel") }),
    );
    expect(screen.queryByText(body)).toBeNull();
    expect(emergency).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: OFFER }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: CONFIRM }));
    });
    expect(emergency).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(ALERT)).toBeInTheDocument();
    expect(screen.getByText(t("manifest.medicalAlertNotReviewed"))).toBeInTheDocument();
  });

  it("keeps nothing for the visit: reopening the sheet asks and calls again", async () => {
    const emergency = vi.fn(async () => ({ ok: true, text: ALERT }) as const);
    const first = renderPanel(undefined, {}, () => emergency);
    fireEvent.click(screen.getByRole("button", { name: OFFER }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: CONFIRM }));
    });
    expect(await screen.findByText(ALERT)).toBeInTheDocument();
    first.unmount();
    renderPanel(undefined, {}, () => emergency);
    expect(screen.queryByText(ALERT)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: OFFER }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: CONFIRM }));
    });
    expect(emergency).toHaveBeenCalledTimes(2);
  });

  it("never reads offline: with the radio off it says so and calls nothing", async () => {
    const emergency = vi.fn(async () => ({ ok: true, text: ALERT }) as const);
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      renderPanel(undefined, {}, () => emergency);
      fireEvent.click(screen.getByRole("button", { name: OFFER }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: CONFIRM }));
      });
      expect(
        await screen.findByText(t("manifest.medicalAlertEmergencyNoSignal")),
      ).toBeInTheDocument();
      expect(emergency).not.toHaveBeenCalled();
      expect(screen.queryByText(ALERT)).toBeNull();
    } finally {
      online.mockRestore();
    }
  });

  it("says a refused read can't be opened now and to ask the owner or a manager, never to try again", async () => {
    for (const refusal of [{ ok: false, reason: "closed" }, { ok: false }] as const) {
      const refused = vi.fn(async () => refusal);
      const panel = renderPanel(undefined, {}, () => refused);
      fireEvent.click(screen.getByRole("button", { name: OFFER }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: CONFIRM }));
      });
      const closed = t("manifest.medicalAlertEmergencyClosed");
      expect(await screen.findByText(closed)).toBeInTheDocument();
      expect(closed).toMatch(/owner or a manager/);
      expect(closed).not.toMatch(/try again/i);
      expect(screen.queryByText(ALERT)).toBeNull();
      panel.unmount();
    }
  });

  it("says a read refused as not yet open opens on the day of the trip, never to try again", async () => {
    const early = vi.fn(async () => ({ ok: false, reason: "not_yet" }) as const);
    renderPanel(undefined, {}, () => early);
    fireEvent.click(screen.getByRole("button", { name: OFFER }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: CONFIRM }));
    });
    const notYet = t("manifest.medicalAlertEmergencyNotYet");
    expect(await screen.findByText(notYet)).toBeInTheDocument();
    expect(notYet).toMatch(/day of the trip/);
    expect(notYet).not.toMatch(/try again/i);
    expect(screen.queryByText(ALERT)).toBeNull();
  });

  it("says there is no signal right now when the call fails, points to the sheet, and never throws", async () => {
    const thrown = vi.fn(async (): Promise<MedicalAlertResult> => {
      throw new TypeError("Failed to fetch");
    });
    renderPanel(undefined, {}, () => thrown);
    fireEvent.click(screen.getByRole("button", { name: OFFER }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: CONFIRM }));
    });
    const noSignal = t("manifest.medicalAlertEmergencyNoSignal");
    expect(await screen.findByText(noSignal)).toBeInTheDocument();
    expect(noSignal).toMatch(/^No signal right now\. Try again/);
    expect(noSignal).toMatch(/medical alerts sheet if the shop printed one/);
    // A retry is one tap.
    expect(screen.getByRole("button", { name: CONFIRM })).toBeEnabled();
  });

  it("gives up after 15 seconds on weak signal, and Cancel works while it waits", async () => {
    vi.useFakeTimers();
    try {
      const hangs = vi.fn((): Promise<MedicalAlertResult> => new Promise(() => {}));
      renderPanel(undefined, {}, () => hangs);
      fireEvent.click(screen.getByRole("button", { name: OFFER }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: CONFIRM }));
      });
      expect(hangs).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: t("manifest.medicalAlertShowing") }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: t("manifest.medicalAlertEmergencyCancel") }),
      ).toBeEnabled();
      await act(async () => {
        vi.advanceTimersByTime(14_999);
      });
      expect(screen.queryByText(t("manifest.medicalAlertEmergencyNoSignal"))).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByText(t("manifest.medicalAlertEmergencyNoSignal"))).toBeInTheDocument();
      expect(screen.getByRole("button", { name: CONFIRM })).toBeEnabled();
      expect(
        screen.getByRole("button", { name: t("manifest.medicalAlertEmergencyCancel") }),
      ).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a late answer once the staffer has cancelled", async () => {
    let answer: (result: MedicalAlertResult) => void = () => {};
    const slow = vi.fn(
      () =>
        new Promise<MedicalAlertResult>((resolve) => {
          answer = resolve;
        }),
    );
    renderPanel(undefined, {}, () => slow);
    fireEvent.click(screen.getByRole("button", { name: OFFER }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: CONFIRM }));
    });
    fireEvent.click(
      screen.getByRole("button", { name: t("manifest.medicalAlertEmergencyCancel") }),
    );
    await act(async () => {
      answer({ ok: true, text: ALERT });
    });
    expect(screen.queryByText(ALERT)).toBeNull();
    expect(screen.getByRole("button", { name: OFFER })).toBeEnabled();
  });

  it("is not offered to a reader the crew rule admits, nor where nothing is bound", () => {
    const show = vi.fn(async () => ({ ok: true, text: ALERT }) as const);
    const emergency = vi.fn(async () => ({ ok: true, text: ALERT }) as const);
    const first = renderPanel(
      () => show,
      {},
      () => emergency,
    );
    expect(screen.queryByRole("button", { name: OFFER })).toBeNull();
    expect(
      screen.getByRole("button", { name: t("manifest.medicalAlertShow") }),
    ).toBeInTheDocument();
    first.unmount();
    renderPanel(undefined);
    expect(screen.queryByRole("button", { name: OFFER })).toBeNull();
  });
});

/**
 * Issue #2990: "Print with medical alerts" puts each alert under its row, with
 * one note at the top; every other print carries the flag only.
 */
describe("the manifest printed with the medical alerts", () => {
  const PRINTED_AT = new Date("2026-07-21T11:15:00.000Z");
  function renderSheet(printed?: { texts: Map<string, string> }) {
    return render(
      <DiverRollCall
        context={diverContext({
          checkpoint: "departure",
          isDeparture: true,
          timezone: "America/New_York",
          divers: [
            diver({ bookingId: "b-1", medicalAlert: true }),
            diver({ bookingId: "b-2", fullName: "Ana Ruiz" }),
          ],
          printedMedicalAlerts: printed && {
            texts: printed.texts,
            printedBy: "Dana Owner",
            printedAt: PRINTED_AT,
          },
        })}
      />,
    );
  }

  it("puts the words under the diver's row, the note once at the top, and nothing on another row", () => {
    const { container } = renderSheet({ texts: new Map([["b-1", ALERT]]) });
    const rows = within(container).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(ALERT);
    expect(rows[1]).not.toHaveTextContent(ALERT);
    // The flag line about who can read it in DiveDay gives way to the words.
    expect(rows[0]).not.toHaveTextContent(t("manifest.medicalAlertPrinted"));
    expect(screen.getAllByText(t("manifest.medicalAlertNotReviewed"))).toHaveLength(1);
    expect(screen.getByText(t("manifest.medicalAlertsPrintedKeep"))).toBeInTheDocument();
    // Who printed it, and when, in the shop's zone, and that it is a snapshot from then.
    expect(container).toHaveTextContent(/Printed by Dana Owner, .*7:15.*EDT/);
    expect(container).toHaveTextContent(t("manifest.medicalAlertsPrintedSnapshot"));
    expect(t("manifest.medicalAlertsPrintedSnapshot")).toMatch(/written or changed .*aren’t on/);
  });

  it("lists, at the top, the row number and name of every diver with an alert on the sheet", () => {
    const { container } = render(
      <DiverRollCall
        context={diverContext({
          checkpoint: "departure",
          isDeparture: true,
          timezone: "America/New_York",
          divers: [
            diver({ bookingId: "b-1", fullName: "Ana Ruiz" }),
            diver({ bookingId: "b-2", fullName: "Siobhan Doyle", medicalAlert: true }),
            diver({
              bookingId: "b-3",
              fullName: "Held Seat",
              medicalAlert: true,
              identityWithheld: true,
            }),
            diver({ bookingId: "b-4", fullName: "Kai Mendes", medicalAlert: true }),
          ],
          printedMedicalAlerts: {
            texts: new Map([
              ["b-2", ALERT],
              ["b-3", ALERT],
              ["b-4", "Type 1 diabetic. Glucose gel in the red pouch."],
            ]),
            printedBy: "Dana Owner",
            printedAt: PRINTED_AT,
          },
        })}
      />,
    );
    expect(
      screen.getByText(
        t("manifest.medicalAlertsPrintedOnSheet", { divers: "02 Siobhan Doyle, 04 Kai Mendes" }),
      ),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent("03 Held Seat");
  });

  it("repeats keep-with-the-crew under every alert, so every page with words carries it", () => {
    renderSheet({ texts: new Map([["b-1", ALERT]]) });
    const keep = t("manifest.medicalAlertsPrintedKeepShort");
    expect(screen.getAllByText(keep)).toHaveLength(1);
    expect(keep).toMatch(/keep .*crew.*destroy/i);
  });

  it("carries no words and no note on the default print, and points to the alerts sheet", () => {
    const { container } = renderSheet();
    expect(container).not.toHaveTextContent(ALERT);
    expect(container).not.toHaveTextContent(t("manifest.medicalAlertsPrintedHeading"));
    expect(container).not.toHaveTextContent(t("manifest.medicalAlertsPrintedKeepShort"));
    expect(container).toHaveTextContent(t("manifest.medicalAlertPrinted"));
    expect(t("manifest.medicalAlertPrinted")).toMatch(/any staffer .*emergency during the trip/);
    expect(t("manifest.medicalAlertPrinted")).toMatch(
      /medical alerts sheet .*if the shop printed one/,
    );
  });

  it("prints no words on a held seat, even if handed some", () => {
    const { container } = render(
      <DiverRollCall
        context={diverContext({
          checkpoint: "departure",
          isDeparture: true,
          divers: [diver({ bookingId: "b-1", medicalAlert: true, identityWithheld: true })],
          printedMedicalAlerts: {
            texts: new Map([["b-1", ALERT]]),
            printedBy: "Dana Owner",
            printedAt: PRINTED_AT,
          },
        })}
      />,
    );
    expect(container).not.toHaveTextContent(ALERT);
  });
});
