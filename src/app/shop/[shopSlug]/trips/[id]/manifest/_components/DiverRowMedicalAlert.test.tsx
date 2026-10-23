// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetRevealedMedicalAlerts,
  type MedicalAlertResult,
} from "@/components/MedicalAlertReveal";
import type { TripManifest } from "@/lib/manifests";
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
// rostered themselves cannot read it (H-153 amendment).
const CREW = [{ fullName: "Keiko Tanaka" }] as TripManifest["crew"];

type BindShow = (bookingId: string) => () => Promise<MedicalAlertResult>;

function renderPanel(
  showMedicalAlert: BindShow | undefined,
  overrides: Parameters<typeof diver>[0] = {},
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
