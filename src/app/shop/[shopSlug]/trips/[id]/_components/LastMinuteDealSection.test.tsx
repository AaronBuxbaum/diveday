// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("updates the send count when a staffer changes the selected recipients", () => {
    renderSection(
      [recipient("Ravi Menon", "open_water"), recipient("Hana Kobayashi", "open_water")],
      null,
    );

    const send = screen.getByRole("button", { name: "Send to 2 divers" });
    const checkbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(checkbox);

    expect(send).toHaveTextContent("Send to 1 diver");
  });

  it("disables send when no recipients are selected", () => {
    renderSection(
      [recipient("Ravi Menon", "open_water"), recipient("Hana Kobayashi", "open_water")],
      null,
    );

    const send = screen.getByRole("button", { name: "Send to 2 divers" });
    for (const checkbox of screen.getAllByRole("checkbox")) {
      fireEvent.click(checkbox);
    }

    expect(send).toHaveTextContent("Send to 0 divers");
    expect(send).toBeDisabled();
  });

  it("does not repeat the departure requirement above the list", () => {
    const { container } = renderSection(
      [recipient("Ravi Menon", "advanced_open_water")],
      requires("advanced_open_water"),
    );

    expect(container.textContent).not.toContain("This departure requires");
  });

  it("says nothing about a requirement when the departure has none", () => {
    const { container } = renderSection([recipient("Ravi Menon", "open_water")], requires(null));

    // The recipient list is already filtered to people who can receive this
    // deal, so there is no qualification explanation to repeat here.
    expect(container.textContent).not.toContain("This departure requires");
    expect(container.textContent).not.toContain("below this departure's requirement");
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

    expect(container.textContent).not.toContain("This departure requires");
    expect(container.textContent).not.toContain("below this departure's requirement");
  });

  /**
   * **The one name a card-gated departure can place.** A Deep-and-nitrox
   * charter with no minimum level typed used to render the caveat sentence and
   * nothing else — so the joiner who had *said* they hold no card sat unmarked,
   * unlifted, and possibly below the ten-name cap on the departure a shop is
   * most exposed on (2026-08-15 `dive-domain-expert` review).
   */
  it("does not show an uncertified joiner on a departure gated by cards", () => {
    const { container } = renderSection(
      [
        ...Array.from({ length: 11 }, (_, index) => recipient(`Diver ${index}`, "instructor")),
        { personId: "p-dee", fullName: "Dee Ferrer", certification: uncertified() },
      ],
      { minimumCertificationLevel: null, requiredSpecialties: ["deep"], requiresNitrox: true },
    );

    expect(container.textContent).not.toContain("Dee Ferrer");
    expect(container.textContent).not.toContain("below this departure's requirement");
  });

  it("does not show a redundant qualification summary", () => {
    const { container } = renderSection(
      [
        recipient("Hana Kobayashi", "advanced_open_water"),
        recipient("Ravi Menon", "open_water"),
        recipient("Tess Alvarez", "open_water", true),
        recipient("Amara Osei", null),
      ],
      requires("advanced_open_water"),
    );

    expect(container.textContent).not.toContain(
      "Nobody on this list is below this departure's requirement.",
    );
    expect(container.textContent).not.toContain("said nothing about their level");
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

    expect(container.textContent).not.toContain("Dee Ferrer");
    // The unqualified joiners are not shown or included in the send.
    expect(container.textContent).not.toContain("said nothing about their level");
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("still says nothing about a bar the departure does not set, for an uncertified joiner", () => {
    const { container } = renderSection(
      [{ personId: "p-dee", fullName: "Dee Ferrer", certification: uncertified() }],
      requires(null),
    );

    // A departure that asks for no level has no bar for anyone to be under —
    // the answer is still stated on the row, and it is still not a refusal.
    expect(container.textContent).toContain("Not certified yet — unconfirmed");
    expect(container.textContent).not.toContain("below this departure's minimum");
  });

  it("does not show an all-clear qualification sentence", () => {
    const { container } = renderSection(
      [recipient("Hana Kobayashi", "advanced_open_water")],
      requires("advanced_open_water"),
    );

    expect(container.textContent).not.toContain(
      "Nobody on this list is below this departure's requirement.",
    );
    expect(container.textContent).not.toContain("said nothing about their level");
  });

  it("says on the row itself that a diver ranks below the departure's level", () => {
    const { container } = renderSection(
      [recipient("Ravi Menon", "open_water"), recipient("Hana Kobayashi", "advanced_open_water")],
      requires("advanced_open_water"),
    );

    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("Hana Kobayashi");
    expect(container.textContent).not.toContain("Ravi Menon");
  });

  it("marks nothing on the row when the departure asks for no level", () => {
    const { container } = renderSection([recipient("Ravi Menon", "open_water")], requires(null));

    expect(container.textContent).not.toContain("below this departure's minimum");
  });

  it("keeps the warning tone meaning only that nobody has seen the card", () => {
    const { container } = renderSection(
      [
        recipient("Ravi Menon", "advanced_open_water"),
        recipient("Tess Alvarez", "open_water", true),
      ],
      requires("advanced_open_water"),
    );

    const tones = [...container.querySelectorAll("li > span")].map((span) => span.className);
    expect(tones).toHaveLength(1);
    expect(tones[0]).toContain("text-muted");
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
    expect(container.textContent).not.toContain("Ravi Menon");
    expect(container.textContent).toContain("1 more");
    expect(screen.getByRole("button", { name: "Send to 10 divers" })).toBeDefined();
  });
});
