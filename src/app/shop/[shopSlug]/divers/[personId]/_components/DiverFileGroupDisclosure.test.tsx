// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";

afterEach(cleanup);

describe("DiverFileGroupDisclosure", () => {
  it("starts closed with the group's fact in the door", () => {
    render(
      <DiverFileGroupDisclosure id="gear" label="Gear and sizes" summary="BCD M · ML long · 38">
        <p>Gear rows</p>
      </DiverFileGroupDisclosure>,
    );

    const details = screen.getByTestId("diver-file-group-gear");
    expect(details).not.toHaveAttribute("open");
    expect(details.querySelector("summary")).toHaveTextContent(/gear and sizes/i);
    expect(screen.getByText("BCD M · ML long · 38")).toHaveClass("tabular-nums");
    expect(screen.getByText("Gear rows")).toBeInTheDocument();
  });

  it("opens a group when its own outcome needs to be seen", () => {
    render(
      <DiverFileGroupDisclosure id="notes" label="Diver notes" summary="1 note" open>
        <p>Note body</p>
      </DiverFileGroupDisclosure>,
    );

    const details = screen.getByTestId("diver-file-group-notes");
    expect(details).toHaveAttribute("open");
    const summary = details.querySelector("summary");
    expect(summary).toHaveTextContent(/diver notes\s*1 note/i);
    expect(summary).toHaveClass("border-y", "group-open/diver-file:border-b-0");
  });

  /**
   * Open, the summary drops its bottom rule and the group's body starts flush
   * under it. The open body is a stacking context of its own (its
   * `::details-content` is translated), so it paints after the summary's ring:
   * the atlas captured the focused header with three sides, the ring's bottom
   * arm surviving only left of the record's `InsetGroup` card's rounded
   * corner. A focused summary paints above what follows it.
   */
  it("paints its focus ring above the body that starts flush under it", () => {
    render(
      <DiverFileGroupDisclosure id="conversation" label="Conversation" summary="2 messages" open>
        <div className="overflow-hidden rounded-panel">Thread</div>
      </DiverFileGroupDisclosure>,
    );

    const summary = screen.getByTestId("diver-file-group-conversation").querySelector("summary");
    expect(summary).toHaveClass("relative", "focus-visible:z-10");
  });

  /**
   * The whole point of this sweep: one grammar. A group is a door at every
   * width, so nothing here may reach for a breakpoint to hide the summary or
   * force the body open — the two classes the retired "legacy" branch used.
   */
  it("is the same door at every width, in every variant", () => {
    render(
      <>
        <DiverFileGroupDisclosure id="notes" label="Diver notes" summary="None">
          <p>Note body</p>
        </DiverFileGroupDisclosure>
        <DiverFileGroupDisclosure id="gear" label="Gear and sizes" summary="Gear details" stacked>
          <p>Gear rows</p>
        </DiverFileGroupDisclosure>
        <DiverFileGroupDisclosure id="support" label="Dive support" summary="None stated" open>
          <p>Support facts</p>
        </DiverFileGroupDisclosure>
      </>,
    );

    for (const id of ["notes", "gear", "support"]) {
      const details = screen.getByTestId(`diver-file-group-${id}`);
      const summary = details.querySelector("summary");
      expect(summary).toHaveClass("border-y", "group-open/diver-file:border-b-0");
      expect(summary).not.toHaveClass("sm:hidden");
      expect(details.querySelector(`#${id}-content`)).not.toHaveClass("sm:!block");
    }

    expect(screen.getByTestId("diver-file-group-notes")).not.toHaveAttribute("open");
    expect(screen.getByTestId("diver-file-group-gear")).not.toHaveAttribute("open");
    expect(screen.getByTestId("diver-file-group-support")).toHaveAttribute("open");
  });

  it("gives the summary a touch floor and one content region", () => {
    render(
      <DiverFileGroupDisclosure
        id="certifications"
        label="Certification records"
        summary="PADI Open Water"
      >
        <p>Certification rows</p>
      </DiverFileGroupDisclosure>,
    );

    const details = screen.getByTestId("diver-file-group-certifications");
    const summary = details.querySelector("summary");
    expect(summary).toHaveTextContent(/certification records\s*padi open water/i);
    expect(summary).toHaveClass("min-h-11");
    expect(summary).not.toHaveClass("max-sm:flex-wrap");
    expect(screen.getByText("PADI Open Water")).toHaveClass("shrink-0");
    expect(summary).toHaveAttribute("aria-controls", "certifications-content");
    expect(details).toHaveClass("group/diver-file");
  });

  /**
   * The row's own label is the group's heading, and it carries the fragment the
   * `?notice=` redirects and the prep panel's `#support` link land on. A second
   * uppercase copy of it inside the body was what made the desktop record read
   * as two headings per group.
   */
  it("makes the row label the group's heading and its fragment target", () => {
    render(
      <DiverFileGroupDisclosure id="waiver" label="Waiver" summary="Signed · Good until Jul 21">
        <p>Waiver rows</p>
      </DiverFileGroupDisclosure>,
    );

    const heading = screen.getByRole("heading", { level: 2, name: "Waiver" });
    expect(heading).toHaveAttribute("id", "waiver");
    expect(heading.closest("summary")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Waiver" })).toBeInTheDocument();
  });

  it("puts a long phone summary on its own wrapped line", () => {
    render(
      <DiverFileGroupDisclosure
        id="gear"
        label="Gear and sizes"
        summary="BCD M · Wetsuit M · Boots 8 · Mask & fins M · Weights 6 kg"
        stacked
      >
        <p>Gear rows</p>
      </DiverFileGroupDisclosure>,
    );

    const summary = screen.getByTestId("diver-file-group-gear").querySelector("summary");
    const label = summary?.querySelector("h2");
    const value = summary?.querySelector("span.text-sm");

    expect(summary).toHaveClass(
      "max-sm:flex-wrap",
      "max-sm:py-2",
      "group-open/diver-file:border-b-0",
    );
    expect(label).toHaveClass("min-w-0", "flex-1");
    expect(value).toHaveClass(
      "min-w-0",
      "max-w-full",
      "max-sm:ms-6",
      "max-sm:basis-full",
      "max-sm:whitespace-normal",
      "max-sm:break-words",
    );
    expect(value).not.toHaveClass("shrink-0");
  });

  /**
   * From `sm` up a stacked fact shares the label's line, and the fact is what
   * gives way. It used to be `sm:shrink-0` beside a `min-w-0 flex-1` label, so
   * a long fact (an unverified card's amber sentence) kept its whole width and
   * the label collapsed to what was left: the pixel probe measured "Certification
   * records" in a 20px box at 640, its words running 71px out under the fact.
   */
  it("keeps the label on one line from sm up and wraps a long fact beside it", () => {
    render(
      <DiverFileGroupDisclosure
        id="certifications"
        label="Certification records"
        summary="PADI Advanced Open Water · self-declared, not yet checked against the card"
        summaryTone="warning"
        stacked
      >
        <p>Certification rows</p>
      </DiverFileGroupDisclosure>,
    );

    const summary = screen.getByTestId("diver-file-group-certifications").querySelector("summary");
    const label = summary?.querySelector("h2");
    const value = summary?.querySelector("span.text-sm");

    expect(label).toHaveClass("flex-1", "sm:min-w-max");
    expect(value).toHaveClass("min-w-0", "sm:text-end");
    expect(value).not.toHaveClass("sm:shrink-0");
  });
});

/**
 * A deep link into a group (`#card-awaiting` from the status ledger's "Verify
 * it") opens the door and lands the viewport on the target. The landing is
 * the part that raced: `open` is immediate, the body's `content-visibility`
 * flips a frame later, and a `scrollIntoView` into a still-skipped subtree is
 * a silent no-op. So the scroll defers until the target reports rendered.
 */
describe("a deep link into a group", () => {
  const originalHash = window.location.hash;
  const frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    frames.length = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.location.hash = originalHash;
  });

  const runFrame = () => {
    const next = frames.shift();
    if (!next) throw new Error("no frame queued");
    next(performance.now());
  };

  it("opens the group and scrolls only once the target is rendered", () => {
    window.location.hash = "#card-awaiting";
    const checkVisibility = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    Element.prototype.checkVisibility = checkVisibility;

    render(
      <DiverFileGroupDisclosure id="certifications" label="Certification records" summary="1 card">
        <div id="card-awaiting" tabIndex={-1}>
          <button type="button">Verify certification record</button>
        </div>
      </DiverFileGroupDisclosure>,
    );

    const details = screen.getByTestId("diver-file-group-certifications") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    const target = document.getElementById("card-awaiting") as HTMLElement;

    // Two frames with the body still skipped: no scroll yet, another frame asked for.
    runFrame();
    runFrame();
    expect(target.scrollIntoView).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);

    // The frame where the body is rendered: one scroll, and focus on the first
    // control inside the target (a `tabindex="-1"` landing is a region, not a
    // control).
    runFrame();
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Verify certification record" }),
    );
    expect(frames).toHaveLength(0);
  });

  it("gives up waiting on a target that never renders, without scrolling to it", () => {
    window.location.hash = "#card-awaiting";
    Element.prototype.checkVisibility = vi.fn(() => false);

    render(
      <DiverFileGroupDisclosure id="certifications" label="Certification records" summary="1 card">
        <div id="card-awaiting" tabIndex={-1} />
      </DiverFileGroupDisclosure>,
    );

    for (let i = 0; i < 61; i += 1) runFrame();
    expect(frames).toHaveLength(0);
    // Bounded: the loop ends by scrolling on the last try rather than spinning.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
