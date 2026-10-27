// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";

// The device's saved copies, as the reveal's no-signal fallback reads them.
vi.mock("@/lib/offline-manifest-store", () => ({
  loadOfflineManifest: vi.fn(async () => null),
}));
const { loadOfflineManifest } = await import("@/lib/offline-manifest-store");
const { forgetRevealedMedicalAlerts, MedicalAlertReveal } = await import("./MedicalAlertReveal");
type Copy = import("./MedicalAlertReveal").MedicalAlertRevealCopy;

afterEach(() => {
  cleanup();
  forgetRevealedMedicalAlerts();
  vi.mocked(loadOfflineManifest).mockReset();
  vi.mocked(loadOfflineManifest).mockResolvedValue(null);
});

const copy = {
  show: "Show the alert",
  showing: "Showing…",
  showHint: "Opening it is noted on their record.",
  failed: "The alert couldn’t be shown.",
  notReviewed: "Written by the diver. Nobody reviewed it, and it doesn’t change who can dive.",
  noSignal: "No signal, and no copy with the words on this phone.",
  fromSavedCopy: "From the copy {name} saved on this phone.",
} satisfies Copy;
const ALERT = "Bee-sting allergy.\nEpiPen in the blue dry bag.";
const UNREADABLE = "The owner, a manager or crew a manager put on this departure can read it.";
const SEAT = { tripId: "trip-1", bookingId: "booking-1" };

function savedCopyWith(text: string | undefined): OfflineManifestEnvelope {
  return {
    snapshot: {
      manifests: [{ divers: [{ bookingId: "booking-1", medicalAlert: text ? { text } : {} }] }],
    },
    events: [],
    checklistEvents: [],
    ...(text
      ? { medicalAlertsSavedBy: { personId: "p", name: "Yusra Idrissi", savedAt: "" } }
      : {}),
  } as unknown as OfflineManifestEnvelope;
}

/** Issue #2960: the words are read on purpose, never at rest. */
describe("MedicalAlertReveal", () => {
  it("keeps revealed screen-only medical words off paper after Show alert", async () => {
    render(
      <MedicalAlertReveal
        show={async () => ({ ok: true, text: ALERT })}
        unreadable={UNREADABLE}
        copy={copy}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: copy.show }));
    const words = await screen.findByText(/EpiPen in the blue dry bag/);
    expect(words).toBeVisible();
    expect(words.closest('[class~="print:hidden"]')).not.toBeNull();
  });
  it("shows nothing of the alert until the tap, then the diver's words and that nobody reviewed them", async () => {
    const show = vi.fn(async () => ({ ok: true as const, text: ALERT }));
    render(<MedicalAlertReveal show={show} unreadable={UNREADABLE} copy={copy} />);
    expect(screen.queryByText(/EpiPen/)).toBeNull();
    expect(screen.queryByText(copy.notReviewed)).toBeNull();
    expect(show).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: copy.show }));

    await waitFor(() => expect(screen.getByText(/EpiPen in the blue dry bag/)).toBeInTheDocument());
    expect(screen.getByText(copy.notReviewed)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.show })).toBeNull();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("says so when the server refuses", async () => {
    const show = vi.fn(async () => ({ ok: false as const }));
    render(<MedicalAlertReveal show={show} unreadable={UNREADABLE} copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: copy.show }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(copy.failed));
    expect(screen.queryByText(/EpiPen/)).toBeNull();
  });

  it("never throws when the call fails at sea, and says to save the trip before leaving the dock", async () => {
    const show = vi.fn(async (): Promise<{ ok: true; text: string }> => {
      throw new TypeError("Failed to fetch");
    });
    render(<MedicalAlertReveal show={show} unreadable={UNREADABLE} copy={copy} savedCopy={SEAT} />);
    fireEvent.click(screen.getByRole("button", { name: copy.show }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(copy.noSignal));
    expect(loadOfflineManifest).toHaveBeenCalledWith("trip-1");
    // The button stays, for when signal comes back. Found, not got: the alert
    // can paint while the transition still reads "Showing…" on a busy runner.
    expect(await screen.findByRole("button", { name: copy.show })).toBeInTheDocument();
  });

  it("shows the words from a copy saved with them on this phone when the call fails", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(savedCopyWith(ALERT));
    const show = vi.fn(async (): Promise<{ ok: true; text: string }> => {
      throw new TypeError("Failed to fetch");
    });
    render(<MedicalAlertReveal show={show} unreadable={UNREADABLE} copy={copy} savedCopy={SEAT} />);
    fireEvent.click(screen.getByRole("button", { name: copy.show }));
    await waitFor(() => expect(screen.getByText(/EpiPen in the blue dry bag/)).toBeInTheDocument());
    expect(
      screen.getByText("From the copy Yusra Idrissi saved on this phone."),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.notReviewed)).toBeInTheDocument();
  });

  it("goes straight to the saved copy with the radio off, without calling out", async () => {
    vi.mocked(loadOfflineManifest).mockResolvedValue(savedCopyWith(undefined));
    const onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    try {
      const show = vi.fn(async () => ({ ok: true as const, text: ALERT }));
      render(
        <MedicalAlertReveal show={show} unreadable={UNREADABLE} copy={copy} savedCopy={SEAT} />,
      );
      fireEvent.click(screen.getByRole("button", { name: copy.show }));
      // A copy saved without the words is no help: the no-signal line.
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(copy.noSignal));
      expect(show).not.toHaveBeenCalled();
    } finally {
      onLine.mockRestore();
    }
  });

  it("keeps the words through closing and reopening the sheet: no second call, no second read", async () => {
    const show = vi.fn(async () => ({ ok: true as const, text: ALERT }));
    const first = render(
      <MedicalAlertReveal show={show} unreadable={UNREADABLE} copy={copy} keepAs="trip-1:b-1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: copy.show }));
    await waitFor(() => expect(screen.getByText(/EpiPen/)).toBeInTheDocument());
    first.unmount();

    render(
      <MedicalAlertReveal show={show} unreadable={UNREADABLE} copy={copy} keepAs="trip-1:b-1" />,
    );
    expect(screen.getByText(/EpiPen/)).toBeInTheDocument();
    expect(show).toHaveBeenCalledTimes(1);
    // Signing out forgets them.
    cleanup();
    forgetRevealedMedicalAlerts();
    render(
      <MedicalAlertReveal show={show} unreadable={UNREADABLE} copy={copy} keepAs="trip-1:b-1" />,
    );
    expect(screen.queryByText(/EpiPen/)).toBeNull();
  });

  it("offers no tap to a reader who may not read it, and names who can", () => {
    render(<MedicalAlertReveal unreadable={UNREADABLE} copy={copy} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(UNREADABLE)).toBeInTheDocument();
  });
});
