// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishRelease, type PublishReleaseCopy } from "./PublishRelease";

// `InlineConfirm` keys its disarm-on-revisit effect off `usePathname()`; there
// is no Next router in a unit environment. Same stand-in as its own test.
vi.mock("next/navigation", () => ({ usePathname: () => "/shop/blue-mantis/waivers" }));

afterEach(cleanup);

/**
 * The words the server composes. Values, not keys: this component is handed
 * finished sentences because staff copy never crosses to the client.
 */
const COPY: PublishReleaseCopy = {
  choiceLegend: "This edit is",
  correction: "A correction — wording only",
  correctionDetail: "Every standing signature stays current.",
  material: "A material change",
  materialDetail: "Asks all 27 standing signatures to sign again. 4 divers board within 7 days.",
  action: "Publish",
  confirm: "Publish — 27 sign again",
  pending: "Publishing…",
};

function renderPublish(standingSignatures: boolean) {
  const submitted = vi.fn();
  const view = render(
    // A real `<form>`, because what these tests are about is whether the form
    // can be submitted — `checkValidity()` and the submit button's own `type`
    // are both meaningless outside one.
    <form
      aria-label="release"
      onSubmit={(event) => {
        event.preventDefault();
        submitted();
      }}
    >
      <PublishRelease copy={COPY} standingSignatures={standingSignatures} />
    </form>,
  );
  const form = view.container.querySelector("form");
  if (!form) throw new Error("the form did not render");
  return { form, submitted };
}

/**
 * **The pin: no submit without a choice while signatures stand** (ADR
 * 20260827-people-not-lists, decision 4 — H-54's "two explicit choices").
 *
 * Publishing a version is what makes every signature the shop holds stop
 * counting, and the old surface asked which kind of edit this was by *which of
 * two buttons was tapped*. The answer is now an input the form is invalid
 * without, so there is no path — mis-tap, muscle memory, a stray Enter — that
 * publishes a materiality nobody stated. `actions.authz.test.ts` pins the
 * server half, which is the one that matters for a POST that never met this
 * component at all.
 */
describe("while signatures stand", () => {
  it("cannot be submitted until the edit is called one thing or the other", async () => {
    const { form } = renderPublish(true);

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    // Neither preselected: a default here would be the app answering a legal
    // question on the shop's behalf.
    expect(radios.some((radio) => (radio as HTMLInputElement).checked)).toBe(false);
    for (const radio of radios) expect(radio).toBeRequired();
    expect(form.checkValidity()).toBe(false);

    await userEvent.click(screen.getByRole("radio", { name: /A correction/ }));
    expect(form.checkValidity()).toBe(true);
  });

  it("states what a material publish costs on the option itself", () => {
    renderPublish(true);
    const material = screen.getByRole("radio", { name: /A material change/ });
    // The count is on the thing being chosen, not in a message that appears
    // once the choice has already been made (issue #720).
    expect(material).toHaveAccessibleName(/27 standing signatures/);
    expect(material).toHaveAccessibleName(/4 divers board within 7 days/);
  });

  it("keeps the second deliberate tap on the material path", async () => {
    const { submitted } = renderPublish(true);
    await userEvent.click(screen.getByRole("radio", { name: /A material change/ }));

    // Unarmed it is not a submit at all, so the first tap cannot post.
    const publish = screen.getByRole("button", { name: COPY.action });
    expect(publish).toHaveAttribute("type", "button");
    await userEvent.click(publish);
    expect(submitted).not.toHaveBeenCalled();

    const armed = screen.getByRole("button", { name: COPY.confirm });
    expect(armed).toHaveAttribute("type", "submit");
  });

  /**
   * **The arm has no wall clock, and that is deliberate.**
   *
   * `InlineConfirm`'s `autoResetMs` defaults to off, and this caller keeps the
   * default. It exists for a compact trigger with no visible way out — sign
   * out, in a header menu — whereas this one sits directly under the radio
   * pair, and choosing "a correction" swaps the armed button for a plain
   * Publish. Escape and a blur disarm it too.
   *
   * What a timer cost instead was determinism. `e2e/visual.spec.ts`
   * photographs exactly this state (`waiver-materiality-choice`), and a
   * `setTimeout` runs on the runner's real clock — the e2e fleet freezes
   * `Date`, not timers — so an 8-second arm was racing a two-viewport capture
   * whose own waits are budgeted in tens of seconds. The desktop shot, taken
   * last, could photograph a settled button: two baselines from one commit,
   * and an armed/disarmed diff is the kind a reviewer waves through, which is
   * how a real change to the one danger-toned control on the page would get
   * missed.
   */
  it("holds the armed confirm rather than settling back on a timer", () => {
    vi.useFakeTimers();
    try {
      renderPublish(true);
      fireEvent.click(screen.getByRole("radio", { name: /A material change/ }));
      fireEvent.click(screen.getByRole("button", { name: COPY.action }));
      expect(screen.getByRole("button", { name: COPY.confirm })).toBeInTheDocument();

      // Well past any arm this ever had, and past every budget in `capture()`.
      act(() => {
        vi.advanceTimersByTime(120_000);
      });

      expect(screen.getByRole("button", { name: COPY.confirm })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("spends no ceremony on a wording correction", async () => {
    renderPublish(true);
    await userEvent.click(screen.getByRole("radio", { name: /A correction/ }));
    // One tap: a correction leaves every standing signature current, so there
    // is nothing to warn about and nothing to confirm.
    expect(screen.getByRole("button", { name: COPY.action })).toHaveAttribute("type", "submit");
  });
});

/**
 * Nothing is at risk on a first release, or on one nobody has signed against
 * yet — so there is no choice to make, and the page does not manufacture one.
 */
describe("with nothing signed against the current release", () => {
  it("is one button and no question", () => {
    const { form } = renderPublish(false);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(COPY.choiceLegend)).toBeNull();
    expect(screen.getByRole("button", { name: COPY.action })).toHaveAttribute("type", "submit");
    expect(form.checkValidity()).toBe(true);
  });
});
