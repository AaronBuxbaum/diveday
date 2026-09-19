// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSection } from "@/components/editor/EditorSection";
import { UnsavedChangesGuard, UnsavedChangesNote } from "./UnsavedChangesGuard";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.useRealTimers();
});
beforeEach(() => window.sessionStorage.clear());

const KEY = "course-draft:c-1";

function Editor({ subhead = "", version = "7" }: { subhead?: string; version?: string }) {
  return (
    <UnsavedChangesGuard storageKey={KEY}>
      <form>
        <input type="hidden" name="expectedVersion" value={version} readOnly />
        <label htmlFor="subhead">Subhead</label>
        <input id="subhead" name="subhead" defaultValue={subhead} />
        <label htmlFor="live">Live</label>
        <input id="live" name="live" type="checkbox" />
        {/* No sections: this fixture is the guard on its own, so the note falls
            back to the sentence it has always said. The sectioned reading is
            the describe block at the foot of this file. */}
        <UnsavedChangesNote
          unsavedLabel="Unsaved changes"
          restoredLabel="Put back"
          sections={[]}
          countSentences={[]}
        />
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
  it("says it is listening once mounted, so a spec can type after hydration", () => {
    // The dirty flag is a React handler; a keystroke before hydration is a
    // native event nobody hears. The attribute is the signal the e2e suite
    // waits on before it fills a box (e2e/courses.spec.ts).
    const { container } = render(<Editor />);
    expect(container.querySelector('[data-hydrated="true"]')).not.toBeNull();
  });

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
  it("never writes the row version back into the form", () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify([
        { name: "expectedVersion", index: 0, value: "7", checked: false },
        { name: "subhead", index: 0, value: "Edited", checked: false },
      ]),
    );
    const { container } = render(<Editor />);
    expect(container.querySelector<HTMLInputElement>("[name=expectedVersion]")?.value).toBe("7");
    expect(screen.getByLabelText("Subhead")).toHaveValue("Edited");
  });

  /**
   * It *is* stored, though, which is the one thing that tells a returning page
   * whether the save it is coming back from landed. See `liveDraft`.
   */
  it("remembers which version of the row the draft was typed against", () => {
    vi.useFakeTimers();
    render(<Editor />);
    fireEvent.input(screen.getByLabelText("Subhead"), { target: { value: "More" } });
    vi.advanceTimersByTime(600);
    const stored = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as Array<{
      name: string;
      value: string;
    }>;
    expect(stored.find((field) => field.name === "expectedVersion")?.value).toBe("7");
  });

  /**
   * **The bug this pair of tests exists for.**
   *
   * The draft used to be deleted on submit, which assumed every save lands.
   * This editor refuses a half-filled FAQ pair and comes straight back to the
   * same page, so a writer who typed a question, pressed Save and was told it
   * needed an answer found the question gone — the exact loss the two-box FAQ
   * was built to prevent. It reached `main` and failed one Playwright shard
   * roughly one run in two, because `onSubmit` cleared the debounce timer
   * without nulling the handle and the unmount flush then wrote the draft back
   * by accident; whether the work survived came down to whether the writer had
   * paused for half a second before pressing Save.
   */
  it("keeps the draft across a submit, so a refused save comes back to it", () => {
    vi.useFakeTimers();
    const { unmount } = render(<Editor />);
    fireEvent.input(screen.getByLabelText("Subhead"), { target: { value: "Half a pair" } });
    // The debounce has already fired: this is the case that lost the work,
    // because the unmount flush then had no pending timer to rescue it with.
    vi.advanceTimersByTime(600);
    fireEvent.submit(screen.getByLabelText("Subhead").closest("form") as HTMLFormElement);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    unmount();

    // The refusal renders this page again, against the same row version.
    render(<Editor version="7" />);
    expect(screen.getByLabelText("Subhead")).toHaveValue("Half a pair");
    expect(screen.getByText("Put back")).toBeTruthy();
  });

  it("drops the draft once the row says the save landed", () => {
    vi.useFakeTimers();
    const { unmount } = render(<Editor />);
    fireEvent.input(screen.getByLabelText("Subhead"), { target: { value: "Saved copy" } });
    vi.advanceTimersByTime(600);
    fireEvent.submit(screen.getByLabelText("Subhead").closest("form") as HTMLFormElement);
    unmount();

    // A save that landed moves the row on, and the page comes back holding it.
    render(<Editor subhead="Saved copy" version="8" />);
    expect(screen.queryByText("Put back")).toBeNull();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
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

  it("flushes what was posted on submit, and stops saying it is unsaved", () => {
    vi.useFakeTimers();
    render(<Editor />);
    fireEvent.input(screen.getByLabelText("Subhead"), { target: { value: "First" } });
    // Typed again inside the debounce, so the only way the second value reaches
    // storage is the submit flushing it.
    fireEvent.input(screen.getByLabelText("Subhead"), { target: { value: "Posted" } });
    fireEvent.submit(screen.getByLabelText("Subhead").closest("form") as HTMLFormElement);

    const stored = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as Array<{
      name: string;
      value: string;
    }>;
    expect(stored.find((field) => field.name === "subhead")?.value).toBe("Posted");
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

const SECTIONS = [
  { id: "pitch", unsavedSentence: "Unsaved changes in The pitch" },
  { id: "pricing", unsavedSentence: "Unsaved changes in Pricing" },
];
const COUNTS = ["Unsaved changes in 1 section", "Unsaved changes in 2 sections"];

function SectionedEditor() {
  return (
    <UnsavedChangesGuard storageKey={KEY}>
      <form>
        <EditorSection id="pitch" label="The pitch">
          <label htmlFor="subhead">Subhead</label>
          <input id="subhead" name="subhead" defaultValue="" />
        </EditorSection>
        <EditorSection id="pricing" label="Pricing">
          <label htmlFor="price">Price</label>
          <input id="price" name="price" defaultValue="" />
        </EditorSection>
        <UnsavedChangesNote
          unsavedLabel="Unsaved changes"
          restoredLabel="Put back"
          sections={SECTIONS}
          countSentences={COUNTS}
        />
      </form>
    </UnsavedChangesGuard>
  );
}

/**
 * ADR 20260827-the-shops-shelves, decision 2: on a form this tall the one Save
 * has to name the section it would be saving. "Unsaved changes" was true and
 * useless — the section it meant was four screens away.
 */
describe("UnsavedChangesNote on a sectioned editor", () => {
  it("names the one section that holds the edit, then counts them", () => {
    render(<SectionedEditor />);
    expect(screen.queryByText(/^Unsaved changes/)).toBeNull();

    fireEvent.input(screen.getByLabelText("Price"), { target: { value: "595" } });
    expect(screen.getByText("Unsaved changes in Pricing")).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText("Subhead"), { target: { value: "Three days" } });
    expect(screen.getByText("Unsaved changes in 2 sections")).toBeInTheDocument();
  });

  /**
   * `restore()` writes into the boxes and dispatches `input` on each, so a
   * restored draft looks exactly like typing to the section tracker. The
   * restored sentence still wins: "these are your own words, put back" is the
   * fact the writer has no other way to learn.
   */
  it("still says a draft was put back, rather than naming the sections it filled", () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify([{ name: "subhead", index: 0, value: "Rewritten", checked: false }]),
    );
    render(<SectionedEditor />);
    expect(screen.getByText("Put back")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes in The pitch")).toBeNull();
  });
});
