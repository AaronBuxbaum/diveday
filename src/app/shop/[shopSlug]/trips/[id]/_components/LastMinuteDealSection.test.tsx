// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CertificationSummary } from "@/db/self-declared-cards";
import type { CertRequirementSource } from "@/lib/readiness";
import { type LastMinuteDealRecipient, LastMinuteDealSection } from "./LastMinuteDealSection";

afterEach(cleanup);

function profile(
  level: CertificationSummary["level"],
  selfDeclared = false,
): CertificationSummary | null {
  if (!level) return null;
  return {
    level,
    levelSelfDeclared: selfDeclared,
    noCertificationDeclared: false,
    nitrox: false,
    nitroxSelfDeclared: false,
  };
}

/** The joiner who answered "I'm not certified yet" — an answer, not a rung. */
function uncertified(): CertificationSummary {
  return {
    level: null,
    levelSelfDeclared: false,
    noCertificationDeclared: true,
    nitrox: false,
    nitroxSelfDeclared: false,
  };
}

function recipient(
  fullName: string,
  level: CertificationSummary["level"],
  selfDeclared = false,
): LastMinuteDealRecipient {
  return { personId: `p-${fullName}`, fullName, certification: profile(level, selfDeclared) };
}

function requires(minimumCertificationLevel: CertRequirementSource["minimumCertificationLevel"]) {
  return { minimumCertificationLevel, requiredSpecialties: [], requiresNitrox: false };
}

function renderSection(
  recipients: LastMinuteDealRecipient[],
  requirement: CertRequirementSource | null,
) {
  return render(
    <LastMinuteDealSection
      shopSlug="blue-mantis"
      recipients={recipients}
      requirement={requirement}
      openSeats={4}
      cancelled={false}
      promos={[]}
      timezone="America/New_York"
      locale="en-US"
      sendAction={() => {}}
    />,
  );
}

/**
 * **What a staffer can see at the moment they decide to send.**
 *
 * Nothing filters this blast — that is the decision, argued in ADR
 * 20260814-self-declared-cards — so the entire safeguard is that the levels are
 * legible *before* the button. A dive-domain review found the panel defeating
 * its own purpose: the list rendered after `SubmitButton`, unbounded, with the
 * trip's own bar nowhere on the screen. These are the four properties that
 * stop it going back.
 */
describe("LastMinuteDealSection recipient review", () => {
  it("puts the recipient list ahead of the send button in DOM order", () => {
    const { container } = renderSection([recipient("Ravi Menon", "open_water")], requires(null));

    const list = container.querySelector("ul");
    const send = screen.getByRole("button", { name: /Send to/ });
    expect(list).not.toBeNull();
    // Reading order, not visual order: a screen reader has to meet the people
    // before it meets the control, so an `order-*` class would not do.
    expect(
      // biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
      list!.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("states what the departure requires, above the list", () => {
    const { container } = renderSection(
      [recipient("Ravi Menon", "open_water")],
      requires("advanced_open_water"),
    );

    const requirement = screen.getByText("This departure requires Advanced Open Water or higher.");
    const list = container.querySelector("ul");
    expect(
      // biome-ignore lint/style/noNonNullAssertion: the list always renders when there is somebody to send to.
      requirement.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says nothing about a requirement when the departure has none", () => {
    const { container } = renderSection([recipient("Ravi Menon", "open_water")], requires(null));

    // No empty scaffolding: a departure that demands nothing gets no sentence
    // about its demands, and the summary says the useful thing instead.
    expect(container.textContent).not.toContain("This departure requires");
    expect(container.textContent).toContain(
      "This departure asks for no certification level, so nobody on this list is below it.",
    );
  });

  it("does not read as an all-clear on a departure gated by cards rather than a level", () => {
    // Only the ladder orders, so a Deep-and-nitrox charter has no minimum level
    // and `below` is 0 — while `decideTripAdmission` will refuse every one of
    // these recipients at checkout. The sentence has to name what it cannot see.
    const { container } = renderSection([recipient("Ravi Menon", "open_water")], {
      minimumCertificationLevel: null,
      requiredSpecialties: ["deep"],
      requiresNitrox: true,
    });

    expect(container.textContent).toContain("this list can't tell you who holds those cards");
    // And it no longer claims nobody is below, which was the all-clear half of
    // the same sentence — a claim this fold can now contradict on its own, as
    // soon as one recipient says they hold no card at all.
    expect(container.textContent).not.toContain("nobody on this list is below it");
  });

  /**
   * **The one name a card-gated departure can place.** A Deep-and-nitrox
   * charter with no minimum level typed used to render the caveat sentence and
   * nothing else — so the joiner who had *said* they hold no card sat unmarked,
   * unlifted, and possibly below the ten-name cap on the departure a shop is
   * most exposed on (2026-08-15 `dive-domain-expert` review).
   */
  it("marks the uncertified joiner on a departure gated by cards rather than a level", () => {
    const { container } = renderSection(
      [
        ...Array.from({ length: 11 }, (_, index) => recipient(`Diver ${index}`, "instructor")),
        { personId: "p-dee", fullName: "Dee Ferrer", certification: uncertified() },
      ],
      { minimumCertificationLevel: null, requiredSpecialties: ["deep"], requiresNitrox: true },
    );

    const rows = container.querySelectorAll("li");
    expect(rows[0]?.textContent).toContain("Dee Ferrer");
    expect(rows[0]?.textContent).toContain("below this departure's minimum");
    // Both sentences, in that order: the name it can place, then the honest
    // limit of what it can say about everybody else.
    expect(container.textContent).toContain("1 of 12 is below this departure's requirement.");
    expect(container.textContent).toContain("this list can't tell you who holds those cards");
  });

  it("summarizes who is below the bar and who said nothing", () => {
    const { container } = renderSection(
      [
        recipient("Hana Kobayashi", "advanced_open_water"),
        recipient("Ravi Menon", "open_water"),
        recipient("Tess Alvarez", "open_water", true),
        recipient("Amara Osei", null),
      ],
      requires("advanced_open_water"),
    );

    // One paragraph, two whole ICU sentences — never a concatenation, and with
    // the space between them that a run-together "requirement.1 said" loses.
    expect(container.textContent).toContain(
      "2 of 4 are below this departure's requirement. 1 said nothing about their level.",
    );
  });

  /**
   * **"Not certified yet" is an answer, and the panel has to hear it as one.**
   *
   * Before the stamp existed, an uncertified joiner picked "Rather not say" and
   * landed in the *silent* count — indistinguishable from a certified regular
   * who skipped an optional question, and quieter on this screen than an Open
   * Water diver's verified card. So the shop read a clean list and mailed a
   * Discover Scuba customer a certified two-tank charter.
   *
   * Nothing about this filters, reorders the mail, or disables the button; the
   * ordering is the preview's own, exactly as it is for anyone else below the
   * bar (ADR 20260814-self-declared-cards, decision 4).
   */
  it("counts a diver who said they hold no card as below the bar, not as silence", () => {
    const { container } = renderSection(
      [
        recipient("Hana Kobayashi", "advanced_open_water"),
        { personId: "p-dee", fullName: "Dee Ferrer", certification: uncertified() },
        recipient("Amara Osei", null),
      ],
      requires("advanced_open_water"),
    );

    expect(container.textContent).toContain("1 of 3 is below this departure's requirement.");
    // The joiner who genuinely said nothing is still counted separately, and
    // there is exactly one of them.
    expect(container.textContent).toContain("1 said nothing about their level.");
    const rows = container.querySelectorAll("li");
    // Lifted to the top of the capped preview, like every other name that
    // should give a staffer pause.
    expect(rows[0]?.textContent).toContain("Dee Ferrer");
    expect(rows[0]?.textContent).toContain(
      "Not certified yet — diver's word · below this departure's minimum",
    );
    // Nobody has seen anything, so the row wears the same tone a claim does.
    expect(rows[0]?.querySelector("span:last-child")?.className).toContain("text-warning");
  });

  it("still says nothing about a bar the departure does not set, for an uncertified joiner", () => {
    const { container } = renderSection(
      [{ personId: "p-dee", fullName: "Dee Ferrer", certification: uncertified() }],
      requires(null),
    );

    // A departure that asks for no level has no bar for anyone to be under —
    // the answer is still stated on the row, and it is still not a refusal.
    expect(container.textContent).toContain("Not certified yet — diver's word");
    expect(container.textContent).not.toContain("below this departure's minimum");
  });

  it("answers with nobody rather than a zero when the whole list clears the bar", () => {
    const { container } = renderSection(
      [recipient("Hana Kobayashi", "advanced_open_water")],
      requires("advanced_open_water"),
    );

    expect(container.textContent).toContain(
      "Nobody on this list is below this departure's requirement.",
    );
    expect(container.textContent).not.toContain("said nothing about their level");
  });

  it("says on the row itself that a diver ranks below the departure's level", () => {
    const { container } = renderSection(
      [
        // A card the shop has verified, one rung under the bar: calm, muted,
        // and until this line existed the quietest thing on a screen whose
        // warm rows meant something else entirely.
        recipient("Ravi Menon", "open_water"),
        recipient("Tess Alvarez", "open_water", true),
        recipient("Hana Kobayashi", "advanced_open_water"),
      ],
      requires("advanced_open_water"),
    );

    const rows = container.querySelectorAll("li");
    expect(rows[0]?.textContent).toContain("Open Water · below this departure's minimum");
    // The claim keeps its own mark and gains the second one; the two facts are
    // separate and both are words.
    expect(rows[1]?.textContent).toContain(
      "Open Water — diver's word, no card · below this departure's minimum",
    );
    // Nobody who clears the bar is marked.
    expect(rows[2]?.textContent).not.toContain("below this departure's minimum");
  });

  it("marks nothing on the row when the departure asks for no level", () => {
    const { container } = renderSection([recipient("Ravi Menon", "open_water")], requires(null));

    expect(container.textContent).not.toContain("below this departure's minimum");
  });

  it("keeps the warning tone meaning only that nobody has seen the card", () => {
    const { container } = renderSection(
      [recipient("Ravi Menon", "open_water"), recipient("Tess Alvarez", "open_water", true)],
      requires("advanced_open_water"),
    );

    const tones = [...container.querySelectorAll("li span:last-child")].map(
      (span) => span.className,
    );
    // Both are below the bar. Only the unverified one is warm — a second
    // reason to turn a row warm would make the mark mean "unverified, or
    // under-certified, or both" (ADR 20260814-self-declared-cards).
    expect(tones[0]).toContain("text-muted");
    expect(tones[1]).toContain("text-warning");
  });

  it("caps the drawn list, counts the rest, and never hides someone below the bar", () => {
    const many = [
      ...Array.from({ length: 11 }, (_, index) => recipient(`Instructor ${index}`, "instructor")),
      // Last in send order, and the one name that should stop this send.
      recipient("Ravi Menon", "open_water"),
    ];

    const { container } = renderSection(many, requires("rescue"));

    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(10);
    expect(rows[0]?.textContent).toContain("Ravi Menon");
    expect(container.textContent).toContain(
      "2 more aren't shown — anyone below the requirement is listed first.",
    );
    // The send is untouched by the cap: the button still offers everybody.
    expect(screen.getByRole("button", { name: "Send to 12 divers" })).toBeDefined();
  });
});
