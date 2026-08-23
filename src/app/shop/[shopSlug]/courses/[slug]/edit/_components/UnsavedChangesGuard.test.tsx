// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsavedChangesGuard, UnsavedChangesNote } from "./UnsavedChangesGuard";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.useRealTimers();
});
beforeEach(() => window.sessionStorage.clear());

const KEY = "course-draft:c-1";

function Editor({ subhead = "" }: { subhead?: string }) {
  return (
    <UnsavedChangesGuard storageKey={KEY}>
      <form>
        <input type="hidden" name="expectedVersion" value="7" readOnly />
        <label htmlFor="subhead">Subhead</label>
        <input id="subhead" name="subhead" defaultValue={subhead} />
        <label htmlFor="live">Live</label>
        <input id="live" name="live" type="checkbox" />
        <UnsavedChangesNote unsavedLabel="Unsaved changes" restoredLabel="Put back" />
      </form>
    </UnsavedChangesGuard>
  );
}

/**
 * The measurement behind all of this (issue #815): under Cache Components a
 * navigated-away page is *hidden*, not unmounted, so one hop away and back
 * keeps the draft on its own. Four hops does not — Activity holds three
 * routes — and neither does closing the tab. These are the two protections
 * that cover what the framework does not.
 */
describe("UnsavedChangesGuard", () => {
  it("says nothing until something is typed", () => {
    render(<Editor subhead="Become a certified diver" />);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("names the unsaved state the moment the form is dirty", () => {
    render(<Editor />);
    fireEvent.input(screen.getByLabelText("Subhead"), { target: { value: "Half a thought" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("writes the draft after the writer stops typing, not on every keystroke", () => {
    vi.useFakeTimers();
    render(<Editor />);
    const subhead = screen.getByLabelText("Subhead");
    fireEvent.input(subhead, { target: { value: "One" } });
    fireEvent.input(subhead, { target: { value: "One two" } });
    expect(window.sessionStorage.getItem(KEY)).toBeNull();

    vi.advanceTimersByTime(600);
    const stored = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as Array<{
      name: string;
      value: string;
    }>;
    expect(stored.find((field) => field.name === "subhead")?.value).toBe("One two");
  });

  it("puts a draft back on mount, and says it did", () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify([
        { name: "subhead", index: 0, value: "Rewritten but never saved", checked: false },
        { name: "live", index: 0, value: "on", checked: true },
      ]),
    );
    render(<Editor subhead="Become a certified diver" />);

    expect((screen.getByLabelText("Subhead") as HTMLInputElement).value).toBe(
      "Rewritten but never saved",
    );
    expect((screen.getByLabelText("Live") as HTMLInputElement).checked).toBe(true);
    // A form that quietly differs from the row it claims to be editing is
    // worse than one that lost the edit — the writer has no reason to look.
    expect(screen.getByText("Put back")).toBeInTheDocument();
  });

  /**
   * The one field a draft must never carry. It is this render's
   * optimistic-concurrency token, and an old one aims the save at a generation
   * of the row somebody else has since replaced (issue #820).
   */
  it("never restores the row version, and never stores it either", () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify([
        { name: "expectedVersion", index: 0, value: "2", checked: false },
        { name: "subhead", index: 0, value: "Edited", checked: false },
      ]),
    );
    const { container } = render(<Editor />);
    expect(container.querySelector<HTMLInputElement>("[name=expectedVersion]")?.value).toBe("7");

    fireEvent.input(screen.getByLabelText("Subhead"), { target: { value: "More" } });
    vi.advanceTimersByTime(600);
    const stored = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as Array<{
      name: string;
    }>;
    expect(stored.some((field) => field.name === "expectedVersion")).toBe(false);
  });

  it("says nothing, and stores nothing, for a draft that matches what is already there", () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify([
        { name: "subhead", index: 0, value: "Become a certified diver", checked: false },
      ]),
    );
    render(<Editor subhead="Become a certified diver" />);
    expect(screen.queryByText("Put back")).toBeNull();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("drops the draft once the form is submitted", () => {
    vi.useFakeTimers();
    render(<Editor />);
    fireEvent.input(screen.getByLabelText("Subhead"), { target: { value: "Saved copy" } });
    vi.advanceTimersByTime(600);
    expect(window.sessionStorage.getItem(KEY)).not.toBeNull();

    fireEvent.submit(screen.getByLabelText("Subhead").closest("form") as HTMLFormElement);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  /**
   * React runs an effect's cleanup when Activity *hides* a page, not only when
   * it unmounts one. Cancelling the pending write there dropped exactly the
   * keystrokes this exists to keep, for any writer who typed and tapped a nav
   * tab inside the half-second debounce.
   */
  it("flushes a pending draft when the page goes away, rather than cancelling it", () => {
    vi.useFakeTimers();
    const { unmount } = render(<Editor />);
    fireEvent.input(screen.getByLabelText("Subhead"), { target: { value: "Typed, then gone" } });
    expect(window.sessionStorage.getItem(KEY)).toBeNull();

    unmount();
    const stored = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as Array<{
      name: string;
      value: string;
    }>;
    expect(stored.find((field) => field.name === "subhead")?.value).toBe("Typed, then gone");
  });

  it("survives storage that refuses to answer", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    // A draft is a courtesy; it never breaks the editor it is protecting.
    expect(() => render(<Editor subhead="Still here" />)).not.toThrow();
    expect((screen.getByLabelText("Subhead") as HTMLInputElement).value).toBe("Still here");
    getItem.mockRestore();
  });

  it("ignores a draft that is not a list of fields", () => {
    window.sessionStorage.setItem(KEY, "{ not json");
    render(<Editor subhead="Untouched" />);
    expect((screen.getByLabelText("Subhead") as HTMLInputElement).value).toBe("Untouched");
  });
});
