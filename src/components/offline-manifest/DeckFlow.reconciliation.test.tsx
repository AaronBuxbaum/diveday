// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RollCallAction } from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { RollCallCausalProvider } from "@/app/shop/[shopSlug]/trips/[id]/_components/roll-call-causal-context";
import { diver } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/diver-roll-call-test-fixtures";
import { LiveRollCallConflicts } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/LiveRollCallConflicts";
import { tripManifest } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/manifest-page-test-fixtures";
import { staffTranslator } from "@/i18n/staff-messages";
import type { RollCallCausalContext } from "@/lib/roll-call-causality";
import { OfflineCausalConflicts } from "./CausalConflicts";
import { DeckFlow } from "./DeckFlow";
import { OfflineDeckRollCall } from "./DeckRollCall";
import { deckCopy } from "./deck-copy";
import { controls, savedCopy } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);
const t = staffTranslator("en-US");
const context: RollCallCausalContext = {
  meetingDay: 0,
  conflict: true,
  orderingUnknown: false,
  unknownMeetingDay: false,
  observedEvidenceIds: ["event:aboard", "event:ashore"],
  evidence: [
    {
      id: "event:aboard",
      status: "boarded",
      recordedByName: "Dana",
      occurredAt: "2026-08-01T12:00:00.000Z",
      meetingDay: 0,
      observedEvidenceIds: [],
      note: null,
    },
    {
      id: "event:ashore",
      status: "not_boarded",
      recordedByName: "Lee",
      occurredAt: "2026-08-01T12:01:00.000Z",
      meetingDay: 0,
      observedEvidenceIds: [],
      note: null,
    },
  ],
};

function openReport(differentPersonSelected: boolean) {
  if (differentPersonSelected) {
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    fireEvent.click(screen.getByRole("button", { name: "Marcus Reed" }));
    fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
  } else fireEvent.click(screen.getByRole("button", { name: "Review reports" }));
}

describe("Deck reconciliation receipts", () => {
  for (const differentPersonSelected of [false, true]) {
    const start = differentPersonSelected ? "a different person selected" : "no selected person";
    it(`shows the resolved live person's receipt with ${start}`, async () => {
      const action = vi.fn<RollCallAction>(async () => ({
        ok: true,
        status: "boarded",
        eventId: "saved-priya",
        observedAt: "2026-08-01T12:05:00.000Z",
      }));
      const manifest = tripManifest({
        divers: [diver({ bookingId: "b-priya", fullName: "Priya Shah", rollCallContext: context })],
      });
      const people = ["Priya Shah", "Marcus Reed"].map((name, index) => ({
        id: index ? "b-marcus" : "b-priya",
        name,
        role: "Guest",
        outstanding: true,
        record: null,
        details: null,
      }));
      const { container } = render(
        <RollCallCausalProvider contexts={{ "bookingId:b-priya": context }}>
          <DeckFlow
            people={people}
            copy={deckCopy(t)}
            checkpoint="Departure"
            progress="0 of 2"
            complete={false}
            timeZone="America/New_York"
            locale="en-US"
            attention={
              <LiveRollCallConflicts
                manifest={manifest}
                actions={{ rollCall: action, crewRollCall: action }}
                t={t}
                locale="en-US"
                timeZone="America/New_York"
              />
            }
          />
        </RollCallCausalProvider>,
      );
      openReport(differentPersonSelected);
      await act(async () =>
        fireEvent.click(
          screen.getByRole("button", { name: t("manifest.conflicts.confirmAboard") }),
        ),
      );
      expect(action).toHaveBeenCalledTimes(1);
      expect(action.mock.calls[0]?.[1].get("bookingId")).toBe("b-priya");
      expect(container.querySelector('[data-deck-screen="receipt"]')).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Priya Shah" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Next person" })).toBeVisible();
    });

    it(`shows the resolved saved-copy person's receipt with ${start}`, async () => {
      const envelope = savedCopy();
      envelope.snapshot.manifests[0].divers[0].rollCallContext = context;
      const view = offlineTripView(envelope, "departure");
      if (!view) throw new Error("fixture has a departure");
      const ctx = controls();
      const record = vi.fn(async () => ({
        ok: true as const,
        observedAt: "2026-08-01T12:05:00.000Z",
        eventId: "saved-priya",
        pending: true,
      }));
      ctx.record = record;
      const { container } = render(
        <OfflineDeckRollCall
          view={view}
          controls={ctx}
          details={null}
          attention={<OfflineCausalConflicts view={view} controls={ctx} />}
        />,
      );
      openReport(differentPersonSelected);
      await act(async () =>
        fireEvent.click(
          screen.getByRole("button", { name: t("manifest.conflicts.confirmAboard") }),
        ),
      );
      expect(record).toHaveBeenCalledExactlyOnceWith(
        { bookingId: "b-priya" },
        { status: "boarded", reconcilesEvidence: true },
      );
      expect(container.querySelector('[data-deck-screen="receipt"]')).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Priya Shah" })).toBeVisible();
      expect(screen.getByText("Saved on this device · Pending sync")).toBeVisible();
      expect(screen.getByRole("button", { name: "Next person" })).toBeVisible();
    });
  }
});
