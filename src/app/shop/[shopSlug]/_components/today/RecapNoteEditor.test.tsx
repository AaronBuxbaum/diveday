// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { RecapNoteEditor } from "./RecapNoteEditor";

afterEach(cleanup);

const t = staffTranslator("en-US");

/**
 * The e2e fleet reaches this component only through `seed-evening`, which
 * moves a day's departures behind the frozen `DIVEDAY_CLOCK` (one
 * process-wide instant at 09:30 shop-local, so nothing seeded is `ended`
 * otherwise). These are the assertions that would need a browser to hold
 * otherwise.
 */
describe("the settled station's post-trip recap note", () => {
  it("states the note it already holds at rest, so a closed row still answers 'is there one?'", () => {
    render(
      <RecapNoteEditor
        action={vi.fn()}
        shoutout="Eagle ray on the second dive!"
        saved={false}
        t={t}
      />,
    );
    // Twice: once as the summary's quiet line, once as the textarea's value.
    expect(screen.getAllByText("Eagle ray on the second dive!")).not.toHaveLength(0);
    expect(screen.getByRole("textbox", { name: "Post-trip recap note" })).toHaveValue(
      "Eagle ray on the second dive!",
    );
  });

  it("says so plainly when there is no note, rather than showing an empty line", () => {
    render(<RecapNoteEditor action={vi.fn()} shoutout={null} saved={false} t={t} />);
    expect(screen.getByText("No note yet — recaps go out without one.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Post-trip recap note" })).toHaveValue("");
  });

  it("stays closed until it is opened — the departures list is a reconciliation, not a form", () => {
    const { container } = render(
      <RecapNoteEditor action={vi.fn()} shoutout={null} saved={false} t={t} />,
    );
    expect(container.querySelector("details")?.open).toBe(false);
  });

  it("re-opens with its confirmation after a save, so the outcome is never hidden behind a caret", () => {
    // The same rule `EditDisclosure` records: a form whose result lands inside
    // a closed disclosure is a form the staffer cannot see worked.
    const { container } = render(
      <RecapNoteEditor action={vi.fn()} shoutout="Thanks for diving with us." saved t={t} />,
    );
    expect(container.querySelector("details")?.open).toBe(true);
    expect(
      screen.getByText(/Recap note saved — it rides along on every diver's recap\./),
    ).toBeInTheDocument();
  });

  it("renders the recap send controls under the post-trip disclosure", () => {
    render(
      <RecapNoteEditor
        action={vi.fn()}
        shoutout={null}
        saved={false}
        t={t}
        tripId="trip-123"
        recapSendAction={vi.fn()}
        toggleRecapAutoSendPauseAction={vi.fn()}
        recapAutoSendAt={new Date("2026-08-16T16:00:00.000Z")}
        recapAutoSendPaused={false}
        recapNowMs={new Date("2026-08-16T12:00:00.000Z").getTime()}
      />,
    );
    expect(screen.getByText("Recap")).toBeInTheDocument();
    expect(screen.getByText(/Automatic recap sending begins in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause automatic sending" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send recap now" })).toBeInTheDocument();
  });

  it("says the recap is waiting to send exactly once, open or closed", () => {
    // The station always passes `recapStatusSummary` — the same
    // status text the summary row and "Recap sending"'s own line would
    // otherwise both say. Closed, only the summary row's line is visible;
    // open, "Recap sending" (with the live countdown and Send/Pause) is the
    // one place saying it — the plain paragraph in between is gone.
    render(
      <RecapNoteEditor
        action={vi.fn()}
        shoutout={null}
        saved
        t={t}
        tripId="trip-123"
        recapSendAction={vi.fn()}
        toggleRecapAutoSendPauseAction={vi.fn()}
        recapAutoSendAt={new Date("2026-08-16T16:00:00.000Z")}
        recapAutoSendPaused={false}
        recapNowMs={new Date("2026-08-16T12:00:00.000Z").getTime()}
        recapStatusSummary="This recap will go out automatically in about 1 hour."
      />,
    );
    expect(
      screen.getAllByText("This recap will go out automatically in about 1 hour."),
    ).toHaveLength(1);
  });

  it("locks the note and photo controls after the recap is sent", () => {
    render(
      <RecapNoteEditor
        action={vi.fn()}
        shoutout="Thanks for diving with us."
        saved={false}
        t={t}
        recapSentAt={new Date("2026-08-16T16:00:00.000Z")}
        recapSentAtLabel="4:00 PM"
        photos={[
          {
            id: "photo-1",
            imageUrl: "https://img.example/photo.jpg",
            caption: null,
            diverName: "Rae R.",
            bookingId: "booking-1",
          },
        ]}
        deletePhotoAction={vi.fn()}
        uploadCrewPhotoAction={vi.fn()}
        deleteCrewPhotoAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Post-trip recap note" })).toBeDisabled();
    expect(
      screen.getAllByText("This recap was sent at 4:00 PM. The note and photos are now locked.")[0],
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload photo" })).not.toBeInTheDocument();
  });
});
