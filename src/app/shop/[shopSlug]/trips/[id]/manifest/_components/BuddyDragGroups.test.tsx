// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuddyDragGroups } from "./BuddyDragGroups";

/**
 * Pairing two people by dragging one onto the other, on a phone.
 *
 * The property that matters is that dragging is only ever a second way to
 * drive the form that was already there: it ticks the same two checkboxes a
 * staffer would tick by hand and submits the same form. Anything that made it
 * a second path to the server would need keeping in step with the first, and
 * this is a manifest surface.
 *
 * jsdom implements neither `elementFromPoint` nor pointer capture, so both are
 * stubbed — the drop target is decided by a coordinate lookup in the real
 * thing, and here by whichever chip the test says is under the finger.
 */

const GROUPS = [
  {
    heading: "Divers",
    options: [
      { token: "diver:b1", label: "Marie Tharp" },
      { token: "diver:b2", label: "Sylvia Earle" },
      { token: "diver:b3", label: "Eugenie Clark" },
    ],
  },
  { heading: "Crew", options: [{ token: "crew:p1", label: "Keiko Tanaka" }] },
];

const COPY = {
  hint: "Press and hold someone, then drag them onto their buddy.",
  holding: "Holding {name}.",
  over: "Release to pair {a} with {b}.",
};

/** The chip element for a person, which is what a pointer lands on. */
function chip(label: string): HTMLElement {
  const found = screen.getByText(label).closest("label");
  if (!found) throw new Error(`no chip for ${label}`);
  return found;
}

function checkbox(label: string): HTMLInputElement {
  const input = chip(label).querySelector("input");
  if (!input) throw new Error(`no checkbox for ${label}`);
  return input as HTMLInputElement;
}

/** Whatever the next `elementFromPoint` should answer with. */
let under: Element | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  under = null;
  document.elementFromPoint = () => under;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Press, hold past the threshold, move onto `target`, release. */
function dragOnto(from: string, to: string) {
  const source = chip(from);
  fireEvent.pointerDown(source, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  act(() => vi.advanceTimersByTime(300));
  under = chip(to);
  fireEvent.pointerMove(source, { pointerId: 1, clientX: 90, clientY: 40 });
  fireEvent.pointerUp(source, { pointerId: 1, clientX: 90, clientY: 40 });
}

function renderInForm(onSubmit = vi.fn()) {
  const submit = vi.fn((event: React.FormEvent) => {
    event.preventDefault();
    onSubmit(
      Array.from(
        (event.target as HTMLFormElement).querySelectorAll<HTMLInputElement>(
          'input[name="members"]:checked',
        ),
        (input) => input.value,
      ),
    );
  });
  render(
    // jsdom has no form submission, so `requestSubmit` is stood in for and the
    // handler reports which boxes were ticked when it fired.
    <form onSubmit={submit}>
      <BuddyDragGroups groups={GROUPS} copy={COPY} />
    </form>,
  );
  const form = document.querySelector("form");
  if (form) form.requestSubmit = () => fireEvent.submit(form);
  return { onSubmit };
}

describe("pairing by drag", () => {
  it("ticks exactly the two people involved and submits the builder's own form", () => {
    const { onSubmit } = renderInForm();

    dragOnto("Marie Tharp", "Sylvia Earle");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].sort()).toEqual(["diver:b1", "diver:b2"]);
  });

  it("pairs a diver with a crew member, which is the whole reason crew are offered", () => {
    const { onSubmit } = renderInForm();

    dragOnto("Marie Tharp", "Keiko Tanaka");

    expect(onSubmit.mock.calls[0][0].sort()).toEqual(["crew:p1", "diver:b1"]);
  });

  it("clears anything already ticked, so a drag means the two people it looks like", () => {
    // Otherwise a stray tick from earlier silently joins the team, and a
    // manifest surface must never form a group nobody asked for.
    const { onSubmit } = renderInForm();
    fireEvent.click(checkbox("Eugenie Clark"));
    expect(checkbox("Eugenie Clark").checked).toBe(true);

    dragOnto("Marie Tharp", "Sylvia Earle");

    expect(onSubmit.mock.calls[0][0].sort()).toEqual(["diver:b1", "diver:b2"]);
  });

  it("does nothing when the drop lands on nobody", () => {
    const { onSubmit } = renderInForm();
    const source = chip("Marie Tharp");

    fireEvent.pointerDown(source, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(300));
    under = document.body;
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 300, clientY: 400 });
    fireEvent.pointerUp(source, { pointerId: 1, clientX: 300, clientY: 400 });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not pair someone with themselves", () => {
    const { onSubmit } = renderInForm();
    const source = chip("Marie Tharp");

    fireEvent.pointerDown(source, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(300));
    under = source;
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 12, clientY: 12 });
    fireEvent.pointerUp(source, { pointerId: 1, clientX: 12, clientY: 12 });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("what a drag must not take away", () => {
  it("leaves a quick tap toggling the checkbox, as it always did", () => {
    const { onSubmit } = renderInForm();
    const source = chip("Marie Tharp");

    fireEvent.pointerDown(source, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    // Released before the hold elapses: a tap, not a pick-up.
    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(checkbox("Marie Tharp"));

    expect(checkbox("Marie Tharp").checked).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("gives a finger that moves early back to the page, so the panel still scrolls", () => {
    const { onSubmit } = renderInForm();
    const source = chip("Marie Tharp");

    fireEvent.pointerDown(source, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    // Past the slop before the hold fires — this is a scroll.
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 10, clientY: 90 });
    act(() => vi.advanceTimersByTime(300));
    under = chip("Sylvia Earle");
    fireEvent.pointerUp(source, { pointerId: 1, clientX: 10, clientY: 90 });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps every person a real checkbox in the form", () => {
    renderInForm();
    for (const option of GROUPS.flatMap((group) => group.options)) {
      const input = checkbox(option.label);
      expect(input).toHaveAttribute("name", "members");
      expect(input).toHaveAttribute("value", option.token);
    }
  });
});

describe("what a screen reader hears", () => {
  it("names who is held, and who they are about to be paired with", () => {
    renderInForm();
    const source = chip("Marie Tharp");

    fireEvent.pointerDown(source, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("status")).toHaveTextContent("Holding Marie Tharp.");

    under = chip("Sylvia Earle");
    fireEvent.pointerMove(source, { pointerId: 1, clientX: 90, clientY: 40 });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Release to pair Marie Tharp with Sylvia Earle.",
    );
  });
});
