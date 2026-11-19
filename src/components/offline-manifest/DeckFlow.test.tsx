// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RollCallAction,
  RollCallButton,
  type RollCallResult,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { DeckFlow, type DeckPerson } from "./DeckFlow";
import { deckCopy } from "./deck-copy";

afterEach(cleanup);
const copy = deckCopy(offlineManifestTranslator("en-US"));

function setup(outcome: RollCallResult = { ok: true }, attention = false, withHomeNotice = false) {
  const action = vi.fn<RollCallAction>(async () => outcome);
  const people: DeckPerson[] = ["Maya Ruiz", "Jordan Lee"].map((name, index) => ({
    id: `person-${index}`,
    name,
    role: "Guest",
    outstanding: true,
    eventId: `older-event-${index}`,
    observed: "Earlier statement's time",
    record: (
      <RollCallButton
        action={action}
        subject={{ field: "bookingId", id: `person-${index}` }}
        status="boarded"
        label={`Record ${name} aboard`}
        pendingLabel="Saving"
        className=""
        copy={{ errorRefusal: "Save failed", blockedMessage: "Requirements outstanding" }}
      />
    ),
    undo: (
      <RollCallButton
        action={action}
        subject={{ field: "bookingId", id: `person-${index}` }}
        status="cleared"
        retracts={`event-${index}`}
        label={`Undo ${name}`}
        pendingLabel="Saving"
        className=""
        copy={{ errorRefusal: "Save failed", blockedMessage: "Requirements outstanding" }}
      />
    ),
    details: <p>{name} details</p>,
  }));
  const result = render(
    <DeckFlow
      people={people}
      copy={copy}
      checkpoint="After dive 1"
      progress="0 of 2"
      complete={false}
      timeZone="America/New_York"
      locale="en-US"
      attention={attention ? <p>Missing-person report</p> : undefined}
      homeNotice={withHomeNotice ? <p role="status">Pending roll-call warning</p> : undefined}
    />,
  );
  return { action, ...result };
}

describe("Deck individual recording", () => {
  it("shows the pending warning on home without crowding the recording receipt", async () => {
    setup({ ok: true }, false, true);
    expect(screen.getByText("Pending roll-call warning")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Record Maya Ruiz aboard" })),
    );
    expect(screen.queryByText("Pending roll-call warning")).toBeNull();
    expect(screen.getByRole("button", { name: "Next person" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: copy.home }));
    expect(screen.getByText("Pending roll-call warning")).toBeVisible();
  });
  it("Start, skip, Find and selecting a person never submit evidence", () => {
    const { action } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    expect(screen.getByRole("heading", { name: "Maya Ruiz" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Check later" }));
    expect(screen.getByRole("heading", { name: "Jordan Lee" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Maya" } });
    fireEvent.click(screen.getByRole("button", { name: "Maya Ruiz" }));
    expect(action).not.toHaveBeenCalled();
  });

  it("retains the saved person's receipt; a rapid second tap never records the next person", async () => {
    const { action, container } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    await act(async () => {
      const record = screen.getByRole("button", { name: "Record Maya Ruiz aboard" });
      fireEvent.doubleClick(record);
      fireEvent.click(record);
    });
    await waitFor(() =>
      expect(container.querySelector('[data-deck-screen="receipt"]')).toBeTruthy(),
    );
    expect(screen.getByRole("heading", { name: "Maya Ruiz" })).toBeVisible();
    expect(action).toHaveBeenCalledTimes(1);
    const posted = action.mock.calls[0]?.[1] as unknown as FormData;
    expect(posted.get("bookingId")).toBe("person-0");
    fireEvent.click(screen.getByRole("button", { name: "Next person" }));
    expect(screen.getByRole("heading", { name: "Jordan Lee" })).toBeVisible();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("shows a failed save on the same person and never offers Next as a receipt", async () => {
    const { container } = setup({ ok: false, reason: "error" });
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Record Maya Ruiz aboard" })),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
    expect(container.querySelector('[data-deck-screen="person"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next person" })).toBeNull();
  });

  it("undo targets only the saved person's evidence", async () => {
    const { action } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Record Maya Ruiz aboard" })),
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo Maya Ruiz" })));
    const posted = action.mock.calls[1]?.[1] as unknown as FormData;
    expect(posted.get("bookingId")).toBe("person-0");
    expect(posted.get("status")).toBe("cleared");
    expect(posted.get("retractsEventId")).toBe("event-0");
    expect(screen.getByRole("heading", { name: "Maya Ruiz" })).toBeVisible();
  });

  it("keeps unresolved reports visible and gives review the primary home action", () => {
    const { action } = setup({ ok: true }, true);
    fireEvent.click(screen.getByRole("button", { name: "Review reports" }));
    expect(screen.getByText("Missing-person report")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    expect(screen.getByRole("button", { name: "Needs attention" })).toBeVisible();
    expect(action).not.toHaveBeenCalled();
  });

  it("does not borrow an older statement's timestamp while the matching saved event is loading", async () => {
    setup({ ok: true, eventId: "fresh-event", status: "boarded" });
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Record Maya Ruiz aboard" })),
    );
    expect(screen.getByText("Aboard recorded")).toBeVisible();
    expect(screen.queryByText("Earlier statement's time")).toBeNull();
  });
});
