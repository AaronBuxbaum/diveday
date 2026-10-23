// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MedicalAlertReveal, type MedicalAlertRevealCopy } from "./MedicalAlertReveal";

afterEach(cleanup);

const copy: MedicalAlertRevealCopy = {
  show: "Show the alert",
  showing: "Showing…",
  showHint: "Opening it is noted on their record.",
  failed: "The alert couldn’t be shown. Try again.",
};
const ALERT = "Bee-sting allergy.\nEpiPen in the blue dry bag.";
const UNREADABLE = "Only an owner, a manager or this departure’s crew can read it: Sal Rivera.";

/** Issue #2960: the words are read on purpose, never at rest. */
describe("MedicalAlertReveal", () => {
  it("shows nothing of the alert until the tap, then the diver's words", async () => {
    const show = vi.fn(async () => ({ ok: true as const, text: ALERT }));
    render(<MedicalAlertReveal show={show} unreadable={UNREADABLE} copy={copy} />);
    expect(screen.queryByText(/EpiPen/)).toBeNull();
    expect(show).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: copy.show }));

    await waitFor(() => expect(screen.getByText(/EpiPen in the blue dry bag/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: copy.show })).toBeNull();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("says so when the alert could not be shown", async () => {
    const show = vi.fn(async () => ({ ok: false as const }));
    render(<MedicalAlertReveal show={show} unreadable={UNREADABLE} copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: copy.show }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(copy.failed));
    expect(screen.queryByText(/EpiPen/)).toBeNull();
  });

  it("offers no tap to a reader who may not read it, and names who can", () => {
    render(<MedicalAlertReveal unreadable={UNREADABLE} copy={copy} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(UNREADABLE)).toBeInTheDocument();
  });
});
